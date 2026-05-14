import { Router } from "express";
import rateLimit from "express-rate-limit";
import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  isAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { db, swapHistoryTable, feeEarningsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { PLATFORM_FEE_BPS, calcPlatformFee, getFeeWalletAddress } from "../lib/fee";
import { requireApiKey } from "../middleware/require-api-key";
import { requireSameOrigin } from "../middleware/require-same-origin";

const router = Router();
const kit = new AppKit();

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
} as const;

const ERC20_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
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

const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
const VALID_TOKENS = new Set(["USDC", "EURC", "cirBTC"]);
const MIN_SWAP_AMOUNT = 0.01;
const MAX_SWAP_AMOUNT = 1_000_000;

type Token = "USDC" | "EURC" | "cirBTC";

function getPrivateKey(): `0x${string}` {
  const privateKey = process.env.WALLET_PRIVATE_KEY;
  if (!privateKey) throw new Error("WALLET_PRIVATE_KEY not configured");
  return (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as `0x${string}`;
}

function getAdapter() {
  return createViemAdapterFromPrivateKey({ privateKey: getPrivateKey() });
}

function getKitKey() {
  const key = process.env.CIRCLE_KIT_KEY;
  if (!key) throw new Error("CIRCLE_KIT_KEY not configured");
  return key.startsWith("KIT_KEY:") ? key : `KIT_KEY:${key}`;
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

function validateSwapInput(tokenIn: unknown, tokenOut: unknown, amountIn: unknown): string | null {
  if (!tokenIn || !tokenOut || !amountIn) return "tokenIn, tokenOut, and amountIn are required";
  if (!VALID_TOKENS.has(tokenIn as string)) return `Invalid tokenIn. Supported: ${[...VALID_TOKENS].join(", ")}`;
  if (!VALID_TOKENS.has(tokenOut as string)) return `Invalid tokenOut. Supported: ${[...VALID_TOKENS].join(", ")}`;
  if (tokenIn === tokenOut) return "tokenIn and tokenOut must be different";
  const parsed = parseFloat(amountIn as string);
  if (isNaN(parsed) || !isFinite(parsed)) return "amountIn must be a valid number";
  if (parsed <= 0) return "amountIn must be greater than 0";
  if (parsed < MIN_SWAP_AMOUNT) return `Minimum swap amount is ${MIN_SWAP_AMOUNT}`;
  if (parsed > MAX_SWAP_AMOUNT) return `Maximum swap amount is ${MAX_SWAP_AMOUNT.toLocaleString()}`;
  return null;
}

function calcPriceImpact(effectiveAmountIn: string, amountOut: string): string {
  const inVal = parseFloat(effectiveAmountIn);
  const outVal = parseFloat(amountOut);
  if (inVal <= 0 || outVal <= 0) return "0.00";
  const impact = Math.max(0, (1 - outVal / inVal) * 100);
  return impact.toFixed(2);
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

router.post("/swap/estimate", estimateLimiter, async (req, res) => {
  const { tokenIn, tokenOut, amountIn } = req.body as { tokenIn: Token; tokenOut: Token; amountIn: string };

  const err = validateSwapInput(tokenIn, tokenOut, amountIn);
  if (err) { res.status(400).json({ error: err }); return; }

  try {
    const { platformFee, effectiveAmountIn } = calcPlatformFee(amountIn);
    const platformFeeAddress = await getFeeWalletAddress();

    const adapter = getAdapter();
    const result = await kit.estimateSwap({
      from: { adapter, chain: "Arc_Testnet" },
      tokenIn,
      tokenOut,
      amountIn: effectiveAmountIn,
      config: { kitKey: getKitKey() },
    });

    const r = result as {
      estimatedOutput?: { amount?: string };
      fees?: Array<{ token?: string; amount?: string; type?: string }>;
    };

    const amountOut = r.estimatedOutput?.amount ?? "0";
    const inNum = parseFloat(amountIn);
    const outNum = parseFloat(amountOut);
    const rate = inNum > 0 ? (outNum / inNum).toFixed(6) : "0.000000";

    const totalFee = (r.fees ?? [])
      .filter((f) => f.token === tokenIn)
      .reduce((sum, f) => sum + parseFloat(f.amount ?? "0"), 0)
      .toFixed(6);

    const priceImpact = calcPriceImpact(effectiveAmountIn, amountOut);

    res.json({
      tokenIn, tokenOut, amountIn, effectiveAmountIn,
      estimatedAmountOut: amountOut,
      exchangeRate: rate,
      fee: totalFee,
      platformFee,
      platformFeeAddress,
      priceImpact,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Estimate swap failed");
    res.status(500).json({ error: "Failed to estimate swap", details: msg });
  }
});

router.post("/swap/execute", requireSameOrigin, executeLimiter, async (req, res) => {
  const { tokenIn, tokenOut, amountIn, userAddress } = req.body as {
    tokenIn: Token;
    tokenOut: Token;
    amountIn: string;
    userAddress?: string;
  };

  const validationError = validateSwapInput(tokenIn, tokenOut, amountIn);
  if (validationError) { res.status(400).json({ error: validationError }); return; }

  if (!userAddress || !ADDRESS_REGEX.test(userAddress)) {
    res.status(400).json({ error: "A valid userAddress is required" });
    return;
  }

  try {
    req.log.info({ tokenIn, tokenOut, amountIn, userAddress }, "Executing swap server-side");

    const walletClient = getWalletClient();
    const publicClient = getPublicClient();
    const backendAddress = walletClient.account.address;

    // Step 1: Pull the input tokens from the user's wallet via transferFrom.
    // The user's MetaMask already signed an approve() for this amount, so
    // transferFrom explicitly debits the user's wallet — not the backend's.
    const inputInfo = TOKEN_INFO[tokenIn];
    if (inputInfo) {
      const amountRaw = parseUnits(amountIn, inputInfo.decimals);

      // Verify allowance before attempting transferFrom
      const allowance = await publicClient.readContract({
        address: inputInfo.address,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [userAddress as `0x${string}`, backendAddress],
      });

      if (allowance < amountRaw) {
        res.status(400).json({
          error: "Insufficient token allowance",
          details: `User has approved ${allowance.toString()} but swap requires ${amountRaw.toString()}. Please approve first.`,
        });
        return;
      }

      const pullHash = await walletClient.writeContract({
        address: inputInfo.address,
        abi: ERC20_ABI,
        functionName: "transferFrom",
        args: [userAddress as `0x${string}`, backendAddress, amountRaw],
      });

      // Wait for the pull to confirm before swapping
      await publicClient.waitForTransactionReceipt({ hash: pullHash });

      req.log.info({ pullHash, userAddress, amountIn, tokenIn }, "Pulled input tokens from user wallet");
    }

    // Step 2: Execute the swap from the backend wallet using Circle SDK
    const adapter = getAdapter();
    const result = await kit.swap({
      from: { adapter, chain: "Arc_Testnet" },
      tokenIn,
      tokenOut,
      amountIn,
      config: { kitKey: getKitKey() },
    });

    const r = result as {
      txHash?: string;
      transactionHash?: string;
      hash?: string;
      explorerUrl?: string;
      amountOut?: string;
      amount?: string;
    };

    const txHash = r.txHash ?? r.transactionHash ?? r.hash ?? "";
    const explorerUrl = r.explorerUrl ?? `https://testnet.arcscan.app/tx/${txHash}`;
    const amountOut = r.amountOut ?? r.amount ?? "0";
    const priceImpact = calcPriceImpact(amountIn, amountOut);

    // Step 3: Deduct platform fee from output — fee stays in backend wallet
    const amountOutNum = parseFloat(amountOut);
    const feeFromOutput = (amountOutNum * PLATFORM_FEE_BPS) / 10_000;
    const userReceives = Math.max(0, amountOutNum - feeFromOutput).toFixed(6);
    const platformFee = feeFromOutput.toFixed(6);

    // Step 4: Transfer output tokens (minus fee) to the user's wallet
    const outputInfo = TOKEN_INFO[tokenOut];
    if (outputInfo && parseFloat(userReceives) > 0 && isAddress(userAddress)) {
      const rawAmount = parseUnits(userReceives, outputInfo.decimals);
      const transferHash = await walletClient.writeContract({
        address: outputInfo.address,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [userAddress as `0x${string}`, rawAmount],
      });
      req.log.info(
        { transferHash, userAddress, userReceives, fee: platformFee, tokenOut },
        "Output tokens (minus fee) transferred to user"
      );
    }

    await Promise.all([
      db.insert(swapHistoryTable).values({
        transactionHash: txHash,
        explorerUrl,
        tokenIn,
        tokenOut,
        amountIn,
        amountOut: userReceives,
        platformFee,
        priceImpact,
      }),
      db.insert(feeEarningsTable).values({
        token: tokenOut,
        feeAmount: platformFee,
        transactionHash: txHash,
        swapAmountIn: amountIn,
      }),
    ]);

    res.json({
      success: true,
      transactionHash: txHash,
      explorerUrl,
      amountOut: userReceives,
      fee: platformFee,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Execute swap failed");
    res.status(500).json({ error: "Swap failed", details: msg });
  }
});

router.get("/swap/history", requireApiKey, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(swapHistoryTable)
      .orderBy(desc(swapHistoryTable.createdAt))
      .limit(50);

    res.json({
      swaps: rows.map((r) => ({
        success: true,
        transactionHash: r.transactionHash,
        explorerUrl: r.explorerUrl,
        tokenIn: r.tokenIn,
        tokenOut: r.tokenOut,
        amountIn: r.amountIn,
        amountOut: r.amountOut,
        timestamp: r.createdAt.toISOString(),
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Get swap history failed");
    res.status(500).json({ error: "Failed to fetch history", details: msg });
  }
});

export default router;
