import { Router } from "express";
import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";

const router = Router();
const kit = new AppKit();

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

router.post("/swap/estimate", async (req, res) => {
  const { tokenIn, tokenOut, amountIn } = req.body as {
    tokenIn: Token;
    tokenOut: Token;
    amountIn: string;
  };

  if (!tokenIn || !tokenOut || !amountIn) {
    res.status(400).json({ error: "tokenIn, tokenOut, and amountIn are required" });
    return;
  }
  if (tokenIn === tokenOut) {
    res.status(400).json({ error: "tokenIn and tokenOut must be different" });
    return;
  }

  try {
    const adapter = getAdapter();
    const result = await kit.estimateSwap({
      from: { adapter, chain: "Arc_Testnet" },
      tokenIn,
      tokenOut,
      amountIn,
      config: { kitKey: getKitKey() },
    });

    const r = result as {
      estimatedOutput?: { amount?: string; token?: string };
      fees?: Array<{ token?: string; amount?: string; type?: string }>;
      stopLimit?: { amount?: string; token?: string };
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
      estimatedAmountOut: amountOut,
      exchangeRate: rate,
      fee: totalFee,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Estimate swap failed");
    res.status(500).json({ error: "Failed to estimate swap", details: msg });
  }
});

router.post("/swap/execute", async (req, res) => {
  const { tokenIn, tokenOut, amountIn } = req.body as {
    tokenIn: Token;
    tokenOut: Token;
    amountIn: string;
  };

  if (!tokenIn || !tokenOut || !amountIn) {
    res.status(400).json({ error: "tokenIn, tokenOut, and amountIn are required" });
    return;
  }
  if (tokenIn === tokenOut) {
    res.status(400).json({ error: "tokenIn and tokenOut must be different" });
    return;
  }

  try {
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
    const timestamp = new Date().toISOString();

    const record = {
      success: true,
      transactionHash: txHash,
      explorerUrl,
      tokenIn,
      tokenOut,
      amountIn,
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
