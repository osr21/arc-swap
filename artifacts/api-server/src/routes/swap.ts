import { Router } from "express";
import rateLimit from "express-rate-limit";
import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { PLATFORM_FEE_BPS, calcPlatformFee, getFeeWalletAddress } from "../lib/fee";

const router = Router();
const kit = new AppKit();

const VALID_TOKENS = new Set(["USDC", "EURC", "cirBTC"]);
const MIN_SWAP_AMOUNT = 0.01;
const MAX_SWAP_AMOUNT = 1_000_000;

type Token = "USDC" | "EURC" | "cirBTC";

const swapHistory: Array<{
  success: boolean;
  transactionHash: string;
  explorerUrl: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  timestamp: string;
}> = [];

function getAdapter() {
  const privateKey = process.env.WALLET_PRIVATE_KEY;
  if (!privateKey) throw new Error("WALLET_PRIVATE_KEY not configured");
  const normalizedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  return createViemAdapterFromPrivateKey({ privateKey: normalizedKey as `0x${string}` });
}

function getKitKey() {
  const key = process.env.CIRCLE_KIT_KEY;
  if (!key) throw new Error("CIRCLE_KIT_KEY not configured");
  return key;
}

function validateSwapInput(
  tokenIn: unknown,
  tokenOut: unknown,
  amountIn: unknown,
): string | null {
  if (!tokenIn || !tokenOut || !amountIn) {
    return "tokenIn, tokenOut, and amountIn are required";
  }
  if (!VALID_TOKENS.has(tokenIn as string)) {
    return `Invalid tokenIn. Supported tokens: ${[...VALID_TOKENS].join(", ")}`;
  }
  if (!VALID_TOKENS.has(tokenOut as string)) {
    return `Invalid tokenOut. Supported tokens: ${[...VALID_TOKENS].join(", ")}`;
  }
  if (tokenIn === tokenOut) {
    return "tokenIn and tokenOut must be different";
  }
  const parsed = parseFloat(amountIn as string);
  if (isNaN(parsed) || !isFinite(parsed)) {
    return "amountIn must be a valid number";
  }
  if (parsed <= 0) {
    return "amountIn must be greater than 0";
  }
  if (parsed < MIN_SWAP_AMOUNT) {
    return `Minimum swap amount is ${MIN_SWAP_AMOUNT}`;
  }
  if (parsed > MAX_SWAP_AMOUNT) {
    return `Maximum swap amount is ${MAX_SWAP_AMOUNT.toLocaleString()}`;
  }
  return null;
}

const estimateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many quote requests — please wait a moment before retrying" },
});

const executeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many swap requests — please wait a minute before retrying" },
});

router.post("/swap/estimate", estimateLimiter, async (req, res) => {
  const { tokenIn, tokenOut, amountIn } = req.body as {
    tokenIn: Token;
    tokenOut: Token;
    amountIn: string;
  };

  const validationError = validateSwapInput(tokenIn, tokenOut, amountIn);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

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
      estimatedOutput?: { amount?: string; token?: string };
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

    res.json({
      tokenIn,
      tokenOut,
      amountIn,
      effectiveAmountIn,
      estimatedAmountOut: amountOut,
      exchangeRate: rate,
      fee: totalFee,
      platformFee,
      platformFeeAddress,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Estimate swap failed");
    res.status(500).json({ error: "Failed to estimate swap", details: msg });
  }
});

router.post("/swap/execute", executeLimiter, async (req, res) => {
  const { tokenIn, tokenOut, amountIn } = req.body as {
    tokenIn: Token;
    tokenOut: Token;
    amountIn: string;
  };

  const validationError = validateSwapInput(tokenIn, tokenOut, amountIn);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  try {
    const { platformFee, effectiveAmountIn } = calcPlatformFee(amountIn);
    const feeWallet = await getFeeWalletAddress();
    req.log.info({ amountIn, platformFee, effectiveAmountIn, feeWallet }, "Swap with platform fee");

    const adapter = getAdapter();
    const result = await kit.swap({
      from: { adapter, chain: "Arc_Testnet" },
      tokenIn,
      tokenOut,
      amountIn: effectiveAmountIn,
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
    const timestamp = new Date().toISOString();

    const record = {
      success: true,
      transactionHash: txHash,
      explorerUrl,
      tokenIn,
      tokenOut,
      amountIn: effectiveAmountIn,
      amountOut,
      timestamp,
    };

    swapHistory.unshift(record);
    if (swapHistory.length > 50) swapHistory.pop();

    res.json(record);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Execute swap failed");
    res.status(500).json({ error: "Swap failed", details: msg });
  }
});

router.get("/swap/history", (_req, res) => {
  res.json({ swaps: swapHistory });
});

export default router;
