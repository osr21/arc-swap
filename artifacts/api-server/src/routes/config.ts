import { Router } from "express";
import { PLATFORM_FEE_BPS, getFeeWalletAddress } from "../lib/fee";

const router = Router();

router.get("/config", async (req, res) => {
  const origin = req.get("origin") ?? "";
  const host = req.get("host") ?? "";
  const referer = req.get("referer") ?? "";

  const devDomain = process.env.REPLIT_DEV_DOMAIN ?? "";
  const replitDomains = (process.env.REPLIT_DOMAINS ?? "").split(",").map((d) => d.trim()).filter(Boolean);

  const allowedOrigins = new Set([
    ...(devDomain ? [`https://${devDomain}`, `http://${devDomain}`] : []),
    ...replitDomains.map((d) => `https://${d}`),
    "http://localhost",
    "http://127.0.0.1",
  ]);

  const isSameHost =
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    (devDomain && host.includes(devDomain));

  const originAllowed =
    isSameHost ||
    (!!origin && (allowedOrigins.has(origin) ||
    (devDomain && origin.includes(devDomain)) ||
    replitDomains.some((d) => origin.includes(d))));

  const refererAllowed =
    !!referer &&
    ((devDomain && referer.includes(devDomain)) ||
    replitDomains.some((d) => referer.includes(d)) ||
    referer.startsWith("http://localhost") ||
    referer.startsWith("http://127.0.0.1"));

  if (!originAllowed && !refererAllowed) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const feeWalletAddress = await getFeeWalletAddress();
    res.json({ feeWalletAddress, platformFeeBps: PLATFORM_FEE_BPS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Failed to get fee config", details: msg });
  }
});

export default router;
