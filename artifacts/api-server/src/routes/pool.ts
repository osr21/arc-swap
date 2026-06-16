import { Router } from "express";
import rateLimit from "express-rate-limit";
import { createPublicClient, createWalletClient, http, isAddress, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { db, liquidityPositionsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router = Router();

const ARC_TESTNET = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
} as const;

const USDC = { address: "0x3600000000000000000000000000000000000000" as `0x${string}`, decimals: 6, symbol: "USDC" };
const EURC = { address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}`, decimals: 6, symbol: "EURC" };

const PAIR_ABI = [
  { name: "getReserves", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "reserve0", type: "uint112" }, { name: "reserve1", type: "uint112" }, { name: "blockTimestampLast", type: "uint32" }] },
  { name: "token0", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { name: "token1", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;

const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

const ROUTER_ABI = [
  {
    name: "addLiquidity",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "amountADesired", type: "uint256" },
      { name: "amountBDesired", type: "uint256" },
      { name: "amountAMin", type: "uint256" },
      { name: "amountBMin", type: "uint256" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amountA", type: "uint256" }, { name: "amountB", type: "uint256" }, { name: "liquidity", type: "uint256" }],
  },
  {
    name: "removeLiquidity",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "liquidity", type: "uint256" },
      { name: "amountAMin", type: "uint256" },
      { name: "amountBMin", type: "uint256" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amountA", type: "uint256" }, { name: "amountB", type: "uint256" }],
  },
  {
    name: "swapExactTokensForTokens",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    name: "getAmountsOut",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "path", type: "address[]" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

function getConfig() {
  return {
    pairAddress: process.env.UNISWAP_V2_PAIR_USDC_EURC as `0x${string}` | undefined,
    routerAddress: process.env.UNISWAP_V2_ROUTER_ADDRESS as `0x${string}` | undefined,
    factoryAddress: process.env.UNISWAP_V2_FACTORY_ADDRESS as `0x${string}` | undefined,
  };
}

function getPrivateKey(): `0x${string}` {
  const key = process.env.WALLET_PRIVATE_KEY;
  if (!key) throw new Error("WALLET_PRIVATE_KEY not configured");
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}

function getPublicClient() {
  return createPublicClient({ chain: ARC_TESTNET, transport: http("https://rpc.testnet.arc.network") });
}

function getWalletClient() {
  const account = privateKeyToAccount(getPrivateKey());
  return { client: createWalletClient({ chain: ARC_TESTNET, transport: http("https://rpc.testnet.arc.network"), account }), account };
}

const poolLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });
const actionLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });

// ── GET /pool/info ─────────────────────────────────────────────────────────────

router.get("/pool/info", poolLimiter, async (req, res): Promise<void> => {
  const { pairAddress } = getConfig();
  if (!pairAddress) {
    res.status(503).json({ error: "Pool not deployed yet — run deploy:uniswap script" });
    return;
  }
  try {
    const publicClient = getPublicClient();
    const [reserves, token0Addr, totalSupply] = await Promise.all([
      publicClient.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: "getReserves" }) as Promise<[bigint, bigint, number]>,
      publicClient.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: "token0" }) as Promise<`0x${string}`>,
      publicClient.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: "totalSupply" }) as Promise<bigint>,
    ]);

    const [reserve0, reserve1] = reserves;
    // Determine which reserve is USDC and which is EURC based on token0
    const isUsdc0 = token0Addr.toLowerCase() === USDC.address.toLowerCase();
    const usdcReserve = isUsdc0 ? reserve0 : reserve1;
    const eurcReserve = isUsdc0 ? reserve1 : reserve0;

    const usdcFloat = parseFloat(formatUnits(usdcReserve, USDC.decimals));
    const eurcFloat = parseFloat(formatUnits(eurcReserve, EURC.decimals));

    // Price: how much EURC per 1 USDC (constant product)
    const priceUsdcToEurc = eurcFloat / usdcFloat;
    const priceEurcToUsdc = usdcFloat / eurcFloat;

    // TVL in USDC terms (EURC ≈ 1/priceEurcToUsdc USDC)
    const tvlUsdc = usdcFloat + eurcFloat * priceEurcToUsdc;

    res.json({
      pairAddress,
      token0: isUsdc0 ? "USDC" : "EURC",
      token1: isUsdc0 ? "EURC" : "USDC",
      reserves: {
        USDC: formatUnits(usdcReserve, USDC.decimals),
        EURC: formatUnits(eurcReserve, EURC.decimals),
      },
      prices: {
        USDCtoEURC: priceUsdcToEurc.toFixed(6),
        EURCtoUSDC: priceEurcToUsdc.toFixed(6),
      },
      tvlUsdc: tvlUsdc.toFixed(2),
      totalLpSupply: formatUnits(totalSupply, 18),
    });
  } catch (err) {
    req.log.error({ err }, "Get pool info failed");
    res.status(500).json({ error: "Failed to fetch pool info" });
  }
});

// ── GET /pool/lp-balance ───────────────────────────────────────────────────────

router.get("/pool/lp-balance", poolLimiter, async (req, res): Promise<void> => {
  const address = req.query.address as string;
  if (!address || !isAddress(address)) {
    res.status(400).json({ error: "Valid wallet address required" });
    return;
  }
  const { pairAddress } = getConfig();
  if (!pairAddress) {
    res.status(503).json({ error: "Pool not deployed yet" });
    return;
  }
  try {
    const publicClient = getPublicClient();
    const [balance, totalSupply, reserves, token0Addr] = await Promise.all([
      publicClient.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: "balanceOf", args: [address as `0x${string}`] }) as Promise<bigint>,
      publicClient.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: "totalSupply" }) as Promise<bigint>,
      publicClient.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: "getReserves" }) as Promise<[bigint, bigint, number]>,
      publicClient.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: "token0" }) as Promise<`0x${string}`>,
    ]);

    const [reserve0, reserve1] = reserves;
    const isUsdc0 = token0Addr.toLowerCase() === USDC.address.toLowerCase();
    const usdcReserve = isUsdc0 ? reserve0 : reserve1;
    const eurcReserve = isUsdc0 ? reserve1 : reserve0;

    const sharePercent = totalSupply > 0n ? (Number(balance) / Number(totalSupply)) * 100 : 0;
    const userUsdc = totalSupply > 0n ? (balance * usdcReserve) / totalSupply : 0n;
    const userEurc = totalSupply > 0n ? (balance * eurcReserve) / totalSupply : 0n;

    res.json({
      address,
      lpBalance: formatUnits(balance, 18),
      sharePercent: sharePercent.toFixed(4),
      pooledTokens: {
        USDC: formatUnits(userUsdc, USDC.decimals),
        EURC: formatUnits(userEurc, EURC.decimals),
      },
    });
  } catch (err) {
    req.log.error({ err }, "Get LP balance failed");
    res.status(500).json({ error: "Failed to fetch LP balance" });
  }
});

// ── POST /pool/add ─────────────────────────────────────────────────────────────
// Records a liquidity-add event after the user has completed the on-chain tx

router.post("/pool/add", actionLimiter, async (req, res): Promise<void> => {
  const { userAddress, txHash, amountA, amountB, lpTokenAmount } = req.body as {
    userAddress: string;
    txHash: string;
    amountA: string;
    amountB: string;
    lpTokenAmount: string;
  };

  if (!userAddress || !isAddress(userAddress) || !txHash || !amountA || !amountB || !lpTokenAmount) {
    res.status(400).json({ error: "userAddress, txHash, amountA, amountB, lpTokenAmount required" });
    return;
  }
  try {
    await db.insert(liquidityPositionsTable).values({
      userAddress,
      txHash,
      type: "add",
      tokenA: "USDC",
      tokenB: "EURC",
      amountA,
      amountB,
      lpTokenAmount,
    });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Record pool add failed");
    res.status(500).json({ error: "Failed to record liquidity add" });
  }
});

// ── POST /pool/remove ──────────────────────────────────────────────────────────

router.post("/pool/remove", actionLimiter, async (req, res): Promise<void> => {
  const { userAddress, txHash, amountA, amountB, lpTokenAmount } = req.body as {
    userAddress: string;
    txHash: string;
    amountA: string;
    amountB: string;
    lpTokenAmount: string;
  };

  if (!userAddress || !isAddress(userAddress) || !txHash || !amountA || !amountB || !lpTokenAmount) {
    res.status(400).json({ error: "userAddress, txHash, amountA, amountB, lpTokenAmount required" });
    return;
  }
  try {
    await db.insert(liquidityPositionsTable).values({
      userAddress,
      txHash,
      type: "remove",
      tokenA: "USDC",
      tokenB: "EURC",
      amountA,
      amountB,
      lpTokenAmount,
    });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Record pool remove failed");
    res.status(500).json({ error: "Failed to record liquidity removal" });
  }
});

// ── GET /pool/positions ────────────────────────────────────────────────────────

router.get("/pool/positions", poolLimiter, async (req, res): Promise<void> => {
  const address = req.query.address as string;
  if (!address || !isAddress(address)) {
    res.status(400).json({ error: "Valid wallet address required" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(liquidityPositionsTable)
      .orderBy(desc(liquidityPositionsTable.createdAt))
      .limit(20);

    res.json(rows.filter((r) => r.userAddress.toLowerCase() === address.toLowerCase()).map((r) => ({
      id: r.id,
      type: r.type,
      tokenA: r.tokenA,
      tokenB: r.tokenB,
      amountA: r.amountA,
      amountB: r.amountB,
      lpTokenAmount: r.lpTokenAmount,
      txHash: r.txHash,
      createdAt: r.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "Get positions failed");
    res.status(500).json({ error: "Failed to fetch positions" });
  }
});

export { PAIR_ABI, ERC20_ABI, ROUTER_ABI };
export default router;
