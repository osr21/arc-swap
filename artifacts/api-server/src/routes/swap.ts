import { Router } from "express";
import rateLimit from "express-rate-limit";
import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { db, swapHistoryTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { calcPlatformFee, getFeeWalletAddress } from "../lib/fee";
import { requireApiKey } from "../middleware/require-api-key";

const router = Router();
const kit = new AppKit();

const VALID_TOKENS = new Set(["USDC", "EURC", "cirBTC"]);
const MIN_SWAP_AMOUNT = 0.01;
const MAX_SWAP_AMOUNT = 1_000_000;

type Token = "USDC" | "EURC" | "cirBTC";

function getAdapter() {
  const privateKey = process.env.WALLET_PRIVATE_KEY;
  if (!privateKey) throw new Error("WALLET_PRIVATE_KEY not configured");
  const normalizedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  return createViemAdapterFromPrivateKey({ privateKey: normalizedKey as `0x${string}` });
}

function getKitKey() {
  const key = process.env.CIRCLE_KIT_KEY;
  if (!key) throw new Error("CIRCLE_KIT_KEY not configured");
  return key.startsWith("KIT_KEY:") ? key : `KIT_KEY:${key}`;
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
