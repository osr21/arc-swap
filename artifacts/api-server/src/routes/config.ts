import { Router } from "express";
import { PLATFORM_FEE_BPS, getFeeWalletAddress } from "../lib/fee";

const router = Router();

router.get("/config", async (req, res) => {
  const kitKey = process.env.CIRCLE_KIT_KEY;
  if (!kitKey) {
    res.status(500).json({ error: "CIRCLE_KIT_KEY not configured" });
    return;
  }
  try {
    const feeWalletAddress = await getFeeWalletAddress();
    res.json({ kitKey, feeWalletAddress, platformFeeBps: PLATFORM_FEE_BPS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Failed to get fee config", details: msg });
  }
});

export default router;
