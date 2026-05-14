import { useState } from "react";
import { createWalletClient, custom, parseUnits, isAddress } from "viem";
import { arcTestnet } from "@/lib/arc-chain";

export interface KitSwapParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps?: number;
}

export interface KitSwapResult {
  success: boolean;
  transactionHash: string;
  explorerUrl: string;
  amountOut: string;
}

const ALLOWED_EXPLORER_ORIGIN = "https://testnet.arcscan.app";

const FEE_WALLET_ADDRESS = "0xf4a14B84108885AF2f18843DD18761706e47d5F6" as `0x${string}`;
const PLATFORM_FEE_BPS = 30;
const MAX_FEE_BPS = 100;

if (!isAddress(FEE_WALLET_ADDRESS)) {
  throw new Error(`Invalid hardcoded FEE_WALLET_ADDRESS: ${FEE_WALLET_ADDRESS}`);
}

const TOKEN_INFO: Record<string, { address: `0x${string}`; decimals: number } | undefined> = {
  USDC: { address: "0x3600000000000000000000000000000000000000", decimals: 6 },
  EURC: { address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", decimals: 6 },
  cirBTC: undefined,
};

function calcFeeUnits(amountIn: string, decimals: number, feeBps: number): bigint {
  const raw = parseUnits(amountIn, decimals);
  return (raw * BigInt(feeBps)) / BigInt(10_000);
}

function safeSanitizeExplorerUrl(url: string, txHash: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.origin === ALLOWED_EXPLORER_ORIGIN) return url;
  } catch {
  }
  return `${ALLOWED_EXPLORER_ORIGIN}/tx/${txHash}`;
}

export function useKitSwap() {
  const [isSwapping, setIsSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const executeSwap = async (params: KitSwapParams): Promise<KitSwapResult> => {
    setIsSwapping(true);
    setError(null);

    try {
      const configRes = await fetch("/api/config");
      if (!configRes.ok) throw new Error("Failed to fetch configuration");
      const config = (await configRes.json()) as { kitKey?: string };
      const kitKey = config.kitKey;
      if (!kitKey) throw new Error("App configuration is unavailable. Please try again later.");

      const provider = (
        window as Window & {
          ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
        }
      ).ethereum;
      if (!provider) {
        throw new Error("No wallet detected. Please install MetaMask and connect to Arc Testnet.");
      }

      const walletClient = createWalletClient({
        chain: arcTestnet,
        transport: custom(provider),
      });

      const accounts = await walletClient.getAddresses();
      const userAddress = accounts[0];
      if (!userAddress) throw new Error("No account found. Please connect your wallet.");

      const parsedIn = parseFloat(params.amountIn);
      if (isNaN(parsedIn) || parsedIn <= 0) throw new Error("Invalid swap amount.");

      const effectiveBps = Math.min(PLATFORM_FEE_BPS, MAX_FEE_BPS);
      const tokenInfo = TOKEN_INFO[params.tokenIn];

      let feeAmountStr = "0";

      if (tokenInfo && effectiveBps > 0) {
        const feeRaw = calcFeeUnits(params.amountIn, tokenInfo.decimals, effectiveBps);
        const effectiveRaw = parseUnits(params.amountIn, tokenInfo.decimals) - feeRaw;

        feeAmountStr = (Number(feeRaw) / 10 ** tokenInfo.decimals).toFixed(tokenInfo.decimals);
        const effectiveAmountIn = (Number(effectiveRaw) / 10 ** tokenInfo.decimals).toFixed(tokenInfo.decimals);

        await walletClient.writeContract({
          address: tokenInfo.address,
          abi: [
            {
              name: "transfer",
              type: "function",
              stateMutability: "nonpayable",
              inputs: [
                { name: "to", type: "address" },
                { name: "amount", type: "uint256" },
              ],
              outputs: [{ name: "", type: "bool" }],
            },
          ] as const,
          functionName: "transfer",
          args: [FEE_WALLET_ADDRESS, feeRaw],
          account: userAddress,
        });

        params = { ...params, amountIn: effectiveAmountIn };
      }

      const { createViemAdapterFromProvider } = await import("@circle-fin/adapter-viem-v2");
      const { AppKit } = await import("@circle-fin/app-kit");

      const adapter = await createViemAdapterFromProvider({
        provider: provider as Parameters<typeof createViemAdapterFromProvider>[0]["provider"],
      });

      const kit = new AppKit();

      const slippageBps = params.slippageBps ?? 50;

      const result = await (
        kit as unknown as {
          swap: (p: {
            from: { adapter: typeof adapter; chain: string };
            tokenIn: string;
            tokenOut: string;
            amountIn: string;
            slippageBps?: number;
            config: { kitKey: string };
          }) => Promise<{
            txHash?: string;
            transactionHash?: string;
            hash?: string;
            explorerUrl?: string;
            estimatedOutput?: { amount?: string };
            amountOut?: string;
          }>;
        }
      ).swap({
        from: { adapter, chain: "Arc_Testnet" },
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        slippageBps,
        config: { kitKey },
      });

      const txHash = result?.txHash ?? result?.transactionHash ?? result?.hash ?? "";
      const amountOut = result?.estimatedOutput?.amount ?? result?.amountOut ?? "0";
      const rawExplorerUrl = result?.explorerUrl ?? `${ALLOWED_EXPLORER_ORIGIN}/tx/${txHash}`;
      const explorerUrl = safeSanitizeExplorerUrl(rawExplorerUrl, txHash);

      void feeAmountStr;

      return { success: true, transactionHash: txHash, explorerUrl, amountOut };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw new Error(msg);
    } finally {
      setIsSwapping(false);
    }
  };

  const clearError = () => setError(null);

  return { executeSwap, isSwapping, error, clearError };
}
