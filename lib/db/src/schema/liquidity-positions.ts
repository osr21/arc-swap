import { pgTable, text, serial, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const liquidityPositionsTable = pgTable("liquidity_positions", {
  id: serial("id").primaryKey(),
  userAddress: text("user_address").notNull(),
  txHash: text("tx_hash").notNull(),
  type: text("type").notNull(), // "add" | "remove"
  tokenA: text("token_a").notNull(),
  tokenB: text("token_b").notNull(),
  amountA: numeric("amount_a", { precision: 30, scale: 10 }).notNull(),
  amountB: numeric("amount_b", { precision: 30, scale: 10 }).notNull(),
  lpTokenAmount: numeric("lp_token_amount", { precision: 30, scale: 10 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLiquidityPositionSchema = createInsertSchema(liquidityPositionsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertLiquidityPosition = z.infer<typeof insertLiquidityPositionSchema>;
export type LiquidityPosition = typeof liquidityPositionsTable.$inferSelect;
