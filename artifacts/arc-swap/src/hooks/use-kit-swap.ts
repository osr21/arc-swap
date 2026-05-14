import { useState } from "react";

export interface KitSwapParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
}

export interface KitSwapResult {
  success: boolean;
  transactionHash: string;
  explorerUrl: string;
  amountOut: string;
}

export function useKitSwap() {
  const [isSwapping, setIsSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const executeSwap = async (params: KitSwapParams): Promise<KitSwapResult> => {
    setIsSwapping(true);
    setError(null);

    try {
      const configRes = await fetch("/api/config");
      if (!configRes.ok) throw new Error("Failed to fetch config");
      const { kitKey } = await configRes.json() as { kitKey: string };

      const provider = (window as Window & { ethereum?: unknown }).ethereum;
      if (!provider) throw new Error("No wallet detected. Please install MetaMask.");

      const { createViemAdapterFromProvider } = await import("@circle-fin/adapter-viem-v2");
      const { AppKit } = await import("@circle-fin/app-kit");

      const adapter = await createViemAdapterFromProvider({ provider: provider as Parameters<typeof createViemAdapterFromProvider>[0]["provider"] });
      const kit = new AppKit();

      const result = await (kit as unknown as {
        swap: (params: {
          adapter: typeof adapter;
          fromToken: string;
          toToken: string;
          amount: string;
          apiKey: string;
        }) => Promise<{ txHash?: string; transactionHash?: string; hash?: string; amountOut?: string }>;
      }).swap({
        adapter,
        fromToken: params.tokenIn,
        toToken: params.tokenOut,
        amount: params.amountIn,
        apiKey: kitKey,
      });

      const txHash = result?.txHash || result?.transactionHash || result?.hash || "";
      const amountOut = result?.amountOut || "0";

      return {
        success: true,
        transactionHash: txHash,
        explorerUrl: `https://testnet.arcscan.app/tx/${txHash}`,
        amountOut,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setIsSwapping(false);
    }
  };

  const clearError = () => setError(null);

  return { executeSwap, isSwapping, error, clearError };
}
