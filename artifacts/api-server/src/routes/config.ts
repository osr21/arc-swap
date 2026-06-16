import { Router } from "express";
import rateLimit from "express-rate-limit";
import { privateKeyToAccount } from "viem/accounts";

const router = Router();

const configLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests" },
});

router.get("/config/wallet", configLimiter, (_req, res): void => {
  try {
    const key = process.env.WALLET_PRIVATE_KEY;
    if (!key) {
      res.status(500).json({ error: "Wallet not configured" });
      return;
    }
    const pk = (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
    const account = privateKeyToAccount(pk);
    res.json({
      walletAddress: account.address,
      network: "Arc Testnet",
      chainId: 5042002,
      contracts: {
        router: process.env.UNISWAP_V2_ROUTER_ADDRESS ?? null,
        factory: process.env.UNISWAP_V2_FACTORY_ADDRESS ?? null,
        pairUsdcEurc: process.env.UNISWAP_V2_PAIR_USDC_EURC ?? null,
      },
    });
  } catch {
    res.status(500).json({ error: "Failed to derive wallet address" });
  }
});

export default router;
