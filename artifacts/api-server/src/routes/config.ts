import { Router } from "express";

const router = Router();

router.get("/config", (req, res) => {
  const kitKey = process.env.CIRCLE_KIT_KEY;
  if (!kitKey) {
    res.status(500).json({ error: "CIRCLE_KIT_KEY not configured" });
    return;
  }
  res.json({ kitKey });
});

export default router;
