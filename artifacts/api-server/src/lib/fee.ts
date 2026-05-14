export const PLATFORM_FEE_BPS = 30;

export function calcPlatformFee(amountIn: string): {
  platformFee: string;
  effectiveAmountIn: string;
} {
  const amount = parseFloat(amountIn);
  if (isNaN(amount) || amount <= 0) return { platformFee: "0", effectiveAmountIn: amountIn };
  const fee = (amount * PLATFORM_FEE_BPS) / 10_000;
  const effective = amount - fee;
  return {
    platformFee: fee.toFixed(6),
    effectiveAmountIn: effective.toFixed(6),
  };
}

export async function getFeeWalletAddress(): Promise<string> {
  const explicit = process.env.FEE_WALLET_ADDRESS;
  if (explicit) return explicit;

  const privateKey = process.env.WALLET_PRIVATE_KEY;
  if (!privateKey) throw new Error("FEE_WALLET_ADDRESS or WALLET_PRIVATE_KEY must be set");

  const { privateKeyToAccount } = await import("viem/accounts");
  const normalized = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(normalized as `0x${string}`);
  return account.address;
}
