import type { Request, Response, NextFunction } from "express";

function parseHost(urlString: string): string {
  try {
    return new URL(urlString).host;
  } catch {
    return "";
  }
}

export function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin = req.get("origin") ?? "";
  const referer = req.get("referer") ?? "";
  const host = req.get("host") ?? "";

  const devDomain = process.env.REPLIT_DEV_DOMAIN ?? "";
  const replitDomains = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

  const allowedHosts = new Set<string>([
    "localhost",
    "127.0.0.1",
    ...(devDomain ? [devDomain] : []),
    ...replitDomains,
  ]);

  function isAllowedHost(h: string): boolean {
    const bare = h.split(":")[0];
    return allowedHosts.has(bare) || allowedHosts.has(h);
  }

  const requestHost = host.split(":")[0];
  const isSameHost = isAllowedHost(requestHost);

  const originHost = origin ? parseHost(origin) : "";
  const originAllowed = !!originHost && isAllowedHost(originHost.split(":")[0]);

  const refererHost = referer ? parseHost(referer) : "";
  const refererAllowed = !!refererHost && isAllowedHost(refererHost.split(":")[0]);

  if (!isSameHost && !originAllowed && !refererAllowed) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  next();
}
