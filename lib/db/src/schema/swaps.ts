import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const swapHistoryTable = pgTable("swap_history", {
  id: serial("id").primaryKey(),
  transactionHash: text("transaction_hash").notNull(),
  explorerUrl: text("explorer_url").notNull(),
  tokenIn: text("token_in").notNull(),
  tokenOut: text("token_out").notNull(),
  amountIn: text("amount_in").notNull(),
  amountOut: text("amount_out").notNull(),
  platformFee: text("platform_fee").notNull().default("0"),
  priceImpact: text("price_impact").notNull().default("0"),
  userAddress: text("user_address"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const feeEarningsTable = pgTable("fee_earnings", {
  id: serial("id").primaryKey(),
  token: text("token").notNull(),
  feeAmount: text("fee_amount").notNull(),
  transactionHash: text("transaction_hash").notNull(),
  swapAmountIn: text("swap_amount_in").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSwapHistorySchema = createInsertSchema(swapHistoryTable).omit({ id: true, createdAt: true });
export type InsertSwapHistory = z.infer<typeof insertSwapHistorySchema>;
export type SwapHistory = typeof swapHistoryTable.$inferSelect;

export const insertFeeEarningSchema = createInsertSchema(feeEarningsTable).omit({ id: true, createdAt: true });
export type InsertFeeEarning = z.infer<typeof insertFeeEarningSchema>;
export type FeeEarning = typeof feeEarningsTable.$inferSelect;
