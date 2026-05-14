import { Router } from "express";
import { db, feeEarningsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { requireApiKey } from "../middleware/require-api-key";

const router = Router();

router.get("/fees", requireApiKey, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(feeEarningsTable)
      .orderBy(desc(feeEarningsTable.createdAt))
      .limit(100);

    const totalsMap = new Map<string, { total: number; count: number }>();
    for (const row of rows) {
      const existing = totalsMap.get(row.token) ?? { total: 0, count: 0 };
      totalsMap.set(row.token, {
        total: existing.total + parseFloat(row.feeAmount),
        count: existing.count + 1,
      });
    }

    const totals = [...totalsMap.entries()].map(([token, { total, count }]) => ({
      token,
      totalFee: total.toFixed(6),
      eventCount: count,
    }));

    res.json({ totals, recent: rows.slice(0, 20) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Get fee earnings failed");
    res.status(500).json({ error: "Failed to fetch fee earnings", details: msg });
  }
});

export default router;
