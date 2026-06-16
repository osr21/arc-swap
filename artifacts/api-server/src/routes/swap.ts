import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  formatUnits,
  isAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { db, swapHistoryTable } from "@workspace/db";
import { desc, count, sum } from "drizzle-orm";
import { EstimateSwapBody, ExecuteSwapBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router = Router();

// ── Rate cache ────────────────────────────────────────────────────────────────
// Fetch real-world rates instead of trusting testnet pool prices (which are artificial)

interface RateCache {
  value: number;
  expiresAt: number;
}

const rateCache = new Map<string, RateCache>();
const RATE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getCachedRate(key: string, fetcher: () => Promise<number>): Promise<number> {
  const cached = rateCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  const value = await fetcher();
  rateCache.set(key, { value, expiresAt: Date.now() + RATE_TTL_MS });
  return value;
}

async function fetchUsdToEurRate(): Promise<number> {
  const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=EUR");
  if (!res.ok) throw new Error(`Frankfurter API error: ${res.status}`);
  const data = (await res.json()) as { rates: { EUR: number } };
  return data.rates.EUR;
}

async function fetchBtcUsdRate(): Promise<number> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
  );
  if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);
  const data = (await res.json()) as { bitcoin: { usd: number } };
  return data.bitcoin.usd;
}

async function getSwapRate(tokenIn: string, tokenOut: string): Promise<number> {
  // USDC ↔ EURC: use real USD/EUR forex rate
  if (tokenIn === "USDC" && tokenOut === "EURC") {
    return getCachedRate("USD_EUR", fetchUsdToEurRate);
  }
  if (tokenIn === "EURC" && tokenOut === "USDC") {
    const usdEur = await getCachedRate("USD_EUR", fetchUsdToEurRate);
    return 1 / usdEur; // EUR → USD
  }
  // cirBTC ↔ USDC
  if (tokenIn === "cirBTC" && tokenOut === "USDC") {
    return getCachedRate("BTC_USD", fetchBtcUsdRate);
  }
  if (tokenIn === "USDC" && tokenOut === "cirBTC") {
    const btcUsd = await getCachedRate("BTC_USD", fetchBtcUsdRate);
    return 1 / btcUsd;
  }
  // cirBTC ↔ EURC
  if (tokenIn === "cirBTC" && tokenOut === "EURC") {
    const [btcUsd, usdEur] = await Promise.all([
      getCachedRate("BTC_USD", fetchBtcUsdRate),
      getCachedRate("USD_EUR", fetchUsdToEurRate),
    ]);
    return btcUsd * usdEur;
  }
  if (tokenIn === "EURC" && tokenOut === "cirBTC") {
    const [btcUsd, usdEur] = await Promise.all([
      getCachedRate("BTC_USD", fetchBtcUsdRate),
      getCachedRate("USD_EUR", fetchUsdToEurRate),
    ]);
    return 1 / (btcUsd * usdEur);
  }
  return 1;
}

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
} as const;

const ERC20_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "transferFrom",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const TOKEN_INFO: Record<string, { address: `0x${string}`; decimals: number } | undefined> = {
  USDC: { address: "0x3600000000000000000000000000000000000000", decimals: 6 },
  EURC: { address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", decimals: 6 },
};

const VALID_TOKENS = new Set(["USDC", "EURC", "cirBTC"]);
const MIN_SWAP_AMOUNT = 0.01;
const MAX_SWAP_AMOUNT = 1_000_000;
const PLATFORM_FEE_BPS = 30; // 0.3%

// Only a strict decimal string is accepted — rejects "123abc", "1e5", "Infinity"
const AMOUNT_REGEX = /^\d+(\.\d+)?$/;

const IS_PROD = process.env.NODE_ENV === "production";

function safeErrorMessage(err: unknown): string {
  // Never leak internal details to clients in production
  if (!IS_PROD) return err instanceof Error ? err.message : String(err);
  return "An internal error occurred";
}

function getPrivateKey(): `0x${string}` {
  const key = process.env.WALLET_PRIVATE_KEY;
  if (!key) throw new Error("WALLET_PRIVATE_KEY not configured");
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}

function getWalletClient() {
  const account = privateKeyToAccount(getPrivateKey());
  return createWalletClient({
    chain: arcTestnet,
    transport: http("https://rpc.testnet.arc.network"),
    account,
  });
}

function getPublicClient() {
  return createPublicClient({
    chain: arcTestnet,
    transport: http("https://rpc.testnet.arc.network"),
  });
}

/**
 * Integer-based fee calculation to avoid floating-point precision loss.
 * Works in units of 1e-8 (8 decimal places of precision).
 */
function calcPlatformFee(amountIn: string): { platformFee: string; effectiveAmountIn: string } {
  const PRECISION = 100_000_000; // 1e8 — 8 decimal places
  const amountUnits = Math.round(parseFloat(amountIn) * PRECISION);
  const feeUnits = Math.floor((amountUnits * PLATFORM_FEE_BPS) / 10_000);
  const effectiveUnits = amountUnits - feeUnits;
  return {
    platformFee: (feeUnits / PRECISION).toFixed(8),
    effectiveAmountIn: (effectiveUnits / PRECISION).toFixed(8),
  };
}

function validateSwapInput(tokenIn: unknown, tokenOut: unknown, amountIn: unknown): string | null {
  if (!tokenIn || !tokenOut || !amountIn) return "tokenIn, tokenOut, and amountIn are required";
  if (!VALID_TOKENS.has(tokenIn as string))
    return `Invalid tokenIn. Supported: ${[...VALID_TOKENS].join(", ")}`;
  if (!VALID_TOKENS.has(tokenOut as string))
    return `Invalid tokenOut. Supported: ${[...VALID_TOKENS].join(", ")}`;
  if (tokenIn === tokenOut) return "tokenIn and tokenOut must be different";

  const amountStr = amountIn as string;
  // Strict format check — reject scientific notation, trailing letters, etc.
  if (!AMOUNT_REGEX.test(amountStr)) return "amountIn must be a positive decimal number (e.g. 10.5)";

  const parsed = parseFloat(amountStr);
  if (!isFinite(parsed) || parsed <= 0) return "amountIn must be a positive finite number";
  if (parsed < MIN_SWAP_AMOUNT) return `Minimum swap amount is ${MIN_SWAP_AMOUNT}`;
  if (parsed > MAX_SWAP_AMOUNT) return `Maximum swap amount is ${MAX_SWAP_AMOUNT.toLocaleString()}`;
  return null;
}

function calcPriceImpact(): string {
  // We use real market rates, not AMM pool depth, so there is no price impact.
  return "0.00";
}

const estimateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many quote requests — please wait a moment" },
});

const executeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many swap requests — please wait a minute" },
});

// ── POST /swap/record — record a completed on-chain router swap ───────────────

router.post("/swap/record", async (req, res): Promise<void> => {
  const { tokenIn, tokenOut, amountIn, amountOut, userAddress, txHash } = req.body as {
    tokenIn?: string; tokenOut?: string; amountIn?: string;
    amountOut?: string; userAddress?: string; txHash?: string;
  };
  if (!tokenIn || !tokenOut || !amountIn || !amountOut || !userAddress || !txHash) {
    res.status(400).json({ error: "tokenIn, tokenOut, amountIn, amountOut, userAddress, txHash required" });
    return;
  }
  if (!isAddress(userAddress)) {
    res.status(400).json({ error: "Invalid userAddress" });
    return;
  }
  try {
    await db.insert(swapHistoryTable).values({
      tokenIn, tokenOut, amountIn, amountOut, userAddress,
      transactionHash: txHash,
      status: "router",
    });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Record swap failed");
    res.status(500).json({ error: "Failed to record swap" });
  }
});

// ── Uniswap V2 constant-product amountOut calculation ─────────────────────────

function getAmountOutConstantProduct(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
): bigint {
  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000n + amountInWithFee;
  return numerator / denominator;
}

async function getOnChainEstimate(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
): Promise<{ amountOut: number; rate: number; priceImpact: number } | null> {
  const pairAddress = process.env.UNISWAP_V2_PAIR_USDC_EURC as `0x${string}` | undefined;
  if (!pairAddress || (tokenIn !== "USDC" && tokenIn !== "EURC") || (tokenOut !== "USDC" && tokenOut !== "EURC")) {
    return null; // pool only supports USDC/EURC
  }
  try {
    const PAIR_ABI = [
      { name: "getReserves", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "reserve0", type: "uint112" }, { name: "reserve1", type: "uint112" }, { name: "blockTimestampLast", type: "uint32" }] },
      { name: "token0", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
    ] as const;
    const publicClient = getPublicClient();
    const [reserves, token0] = await Promise.all([
      publicClient.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: "getReserves" }) as Promise<[bigint, bigint, number]>,
      publicClient.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: "token0" }) as Promise<`0x${string}`>,
    ]);
    const USDC_ADDR = "0x3600000000000000000000000000000000000000";
    const isUsdc0 = token0.toLowerCase() === USDC_ADDR.toLowerCase();
    const [reserve0, reserve1] = reserves;
    const usdcReserve = isUsdc0 ? reserve0 : reserve1;
    const eurcReserve = isUsdc0 ? reserve1 : reserve0;

    const reserveIn = tokenIn === "USDC" ? usdcReserve : eurcReserve;
    const reserveOut = tokenIn === "USDC" ? eurcReserve : usdcReserve;
    const amountInRaw = parseUnits(amountIn, 6);
    const amountOutRaw = getAmountOutConstantProduct(amountInRaw, reserveIn, reserveOut);
    const amountOutFloat = parseFloat(formatUnits(amountOutRaw, 6));
    const amountInFloat = parseFloat(amountIn);
    const rate = amountOutFloat / amountInFloat;

    // Price impact: spot price vs execution price
    const spotRate = parseFloat(formatUnits(reserveOut, 6)) / parseFloat(formatUnits(reserveIn, 6));
    const priceImpact = Math.max(0, ((spotRate - rate) / spotRate) * 100);

    return { amountOut: amountOutFloat, rate, priceImpact };
  } catch {
    return null; // fall back to market rate if on-chain read fails
  }
}

// ── Estimate ──────────────────────────────────────────────────────────────────

router.post("/swap/estimate", estimateLimiter, async (req, res): Promise<void> => {
  const parsed = EstimateSwapBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { tokenIn, tokenOut, amountIn } = parsed.data;

  const validErr = validateSwapInput(tokenIn, tokenOut, amountIn);
  if (validErr) {
    res.status(400).json({ error: validErr });
    return;
  }

  try {
    const { platformFee, effectiveAmountIn } = calcPlatformFee(amountIn);

    // Try on-chain pool quote first (real AMM price) — falls back to market rate
    const onChain = await getOnChainEstimate(tokenIn, tokenOut, effectiveAmountIn);
    let estimatedAmountOut: string;
    let rate: string;
    let priceImpact: string;

    if (onChain) {
      const outDecimals = tokenOut === "cirBTC" ? 8 : 6;
      estimatedAmountOut = onChain.amountOut.toFixed(outDecimals);
      rate = onChain.rate.toFixed(outDecimals);
      priceImpact = onChain.priceImpact.toFixed(2);
    } else {
      // Fallback: real-world market rates (used for cirBTC pairs and when pool not deployed)
      const marketRate = await getSwapRate(tokenIn, tokenOut);
      const effectiveFloat = parseFloat(effectiveAmountIn);
      const amountOut = effectiveFloat * marketRate;
      const outDecimals = tokenOut === "cirBTC" ? 8 : 6;
      estimatedAmountOut = amountOut.toFixed(outDecimals);
      rate = marketRate.toFixed(tokenOut === "cirBTC" ? 10 : 6);
      priceImpact = calcPriceImpact();
    }

    res.json({
      tokenIn,
      tokenOut,
      amountIn,
      estimatedAmountOut,
      priceImpact,
      platformFee,
      effectiveAmountIn,
      rate,
    });
  } catch (err: unknown) {
    req.log.error({ err }, "Estimate swap failed");
    res.status(500).json({ error: "Failed to estimate swap", details: safeErrorMessage(err) });
  }
});

// ── Execute ───────────────────────────────────────────────────────────────────

router.post("/swap/execute", executeLimiter, async (req, res): Promise<void> => {
  const parsed = ExecuteSwapBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { tokenIn, tokenOut, amountIn, userAddress } = parsed.data;

  if (!isAddress(userAddress)) {
    res.status(400).json({ error: "Invalid userAddress" });
    return;
  }

  const validErr = validateSwapInput(tokenIn, tokenOut, amountIn);
  if (validErr) {
    res.status(400).json({ error: validErr });
    return;
  }

  try {
    const { platformFee, effectiveAmountIn } = calcPlatformFee(amountIn);
    const publicClient = getPublicClient();
    const walletClient = getWalletClient();
    const backendAccount = privateKeyToAccount(getPrivateKey());

    let swapTxHash: `0x${string}`;
    let amountOut: string;
    let status = "success";

    const tokenInfo = TOKEN_INFO[tokenIn];
    const tokenOutInfo = TOKEN_INFO[tokenOut];

    if (tokenIn !== "cirBTC" && tokenOut !== "cirBTC" && tokenInfo) {
      const amountRaw = parseUnits(amountIn, tokenInfo.decimals);

      // Pre-check: verify allowance before attempting transferFrom
      // This avoids wasting a gas tx when the user's approval is insufficient
      const allowance = await publicClient.readContract({
        address: tokenInfo.address,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [userAddress as `0x${string}`, backendAccount.address],
      });
      if ((allowance as bigint) < amountRaw) {
        res.status(400).json({
          error: "Insufficient token allowance",
          details: "Please approve the required amount before executing the swap",
        });
        return;
      }

      // Step 1: Pull tokens from user → backend wallet
      const pullHash = await walletClient.writeContract({
        address: tokenInfo.address,
        abi: ERC20_ABI,
        functionName: "transferFrom",
        args: [userAddress as `0x${string}`, backendAccount.address, amountRaw],
        account: backendAccount,
      });
      await publicClient.waitForTransactionReceipt({ hash: pullHash });

      // Step 2: Calculate output using real market rates
      // Circle Kit's on-chain swap router reverts on Arc Testnet (no working liquidity pool).
      // We perform a direct peer-to-peer swap: backend sends tokenOut at market rate.
      const marketRate = await getSwapRate(tokenIn, tokenOut);
      const outDecimals = tokenOut === "cirBTC" ? 8 : 6;
      amountOut = (parseFloat(effectiveAmountIn) * marketRate).toFixed(outDecimals);

      // Step 3: Send output tokens to user — refund input on failure
      if (!tokenOutInfo) throw new Error(`Unknown output token: ${tokenOut}`);
      const outRaw = parseUnits(amountOut, tokenOutInfo.decimals);

      let sendHash: `0x${string}`;
      try {
        sendHash = await walletClient.writeContract({
          address: tokenOutInfo.address,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [userAddress as `0x${string}`, outRaw],
          account: backendAccount,
        });
        await publicClient.waitForTransactionReceipt({ hash: sendHash });
      } catch (sendErr) {
        // Send failed — refund the user's original tokens so they aren't lost
        req.log.error({ sendErr }, "Send failed — attempting refund to user");
        try {
          const refundHash = await walletClient.writeContract({
            address: tokenInfo.address,
            abi: ERC20_ABI,
            functionName: "transfer",
            args: [userAddress as `0x${string}`, amountRaw],
            account: backendAccount,
          });
          await publicClient.waitForTransactionReceipt({ hash: refundHash });
          req.log.info({ refundHash }, "Refund sent to user");
        } catch (refundErr) {
          req.log.error({ refundErr }, "Refund also failed — manual intervention required");
        }
        throw sendErr; // bubble up so the response is a 500
      }

      swapTxHash = sendHash;
    } else {
      // cirBTC: simulated on testnet — use live market rate, clearly marked
      const marketRate = await getSwapRate(tokenIn, tokenOut);
      const outDecimals = tokenOut === "cirBTC" ? 8 : 6;
      amountOut = (parseFloat(effectiveAmountIn) * marketRate).toFixed(outDecimals);
      swapTxHash = `0xsimulated${"0".repeat(55)}` as `0x${string}`;
      status = "simulated";
      logger.info({ tokenIn, tokenOut, amountIn }, "cirBTC swap simulated on testnet");
    }

    await db.insert(swapHistoryTable).values({
      tokenIn,
      tokenOut,
      amountIn,
      amountOut,
      userAddress,
      transactionHash: swapTxHash,
      status,
    });

    res.json({
      success: true,
      transactionHash: swapTxHash,
      explorerUrl:
        status === "simulated"
          ? `https://testnet.arcscan.app` // no tx link for simulated
          : `https://testnet.arcscan.app/tx/${swapTxHash}`,
      amountOut,
      fee: platformFee,
    });
  } catch (err: unknown) {
    req.log.error({ err }, "Execute swap failed");
    res.status(500).json({ error: "Swap failed", details: safeErrorMessage(err) });
  }
});

// ── History ───────────────────────────────────────────────────────────────────

router.get("/swap/history", async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(swapHistoryTable)
      .orderBy(desc(swapHistoryTable.createdAt))
      .limit(50);

    res.json(
      rows.map((r) => ({
        id: r.id,
        tokenIn: r.tokenIn,
        tokenOut: r.tokenOut,
        amountIn: r.amountIn,
        amountOut: r.amountOut,
        userAddress: r.userAddress,
        transactionHash: r.transactionHash,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    req.log.error({ err }, "Get swap history failed");
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

// ── Stats ─────────────────────────────────────────────────────────────────────

router.get("/swap/stats", async (req, res): Promise<void> => {
  try {
    // Use SQL aggregation — never pull full table into memory
    const [totals] = await db
      .select({ total: count(), volume: sum(swapHistoryTable.amountIn) })
      .from(swapHistoryTable);

    const pairRows = await db
      .select({
        tokenIn: swapHistoryTable.tokenIn,
        tokenOut: swapHistoryTable.tokenOut,
        cnt: count(),
      })
      .from(swapHistoryTable)
      .groupBy(swapHistoryTable.tokenIn, swapHistoryTable.tokenOut)
      .orderBy(desc(count()))
      .limit(5);

    res.json({
      totalSwaps: totals?.total ?? 0,
      totalVolume: parseFloat(totals?.volume ?? "0").toFixed(2),
      popularPairs: pairRows.map((r) => ({
        tokenIn: r.tokenIn,
        tokenOut: r.tokenOut,
        count: r.cnt,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Get swap stats failed");
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

export default router;
