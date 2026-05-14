import { Router } from "express";
import { PLATFORM_FEE_BPS } from "../lib/fee";
import { requireSameOrigin } from "../middleware/require-same-origin";

const router = Router();

router.get("/config", requireSameOrigin, async (req, res) => {
  try {
    res.json({ platformFeeBps: PLATFORM_FEE_BPS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Failed to get config", details: msg });
  }
});

export default router;
