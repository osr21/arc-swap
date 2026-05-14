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
      if (!configRes.ok) throw new Error("Failed to fetch kit configuration");
      const { kitKey } = (await configRes.json()) as { kitKey: string };

      const provider = (window as Window & { ethereum?: unknown }).ethereum;
      if (!provider) {
        throw new Error(
          "No wallet detected. Please install MetaMask and connect to Arc Testnet."
        );
      }

      const { createViemAdapterFromProvider } = await import(
        "@circle-fin/adapter-viem-v2"
      );
      const { AppKit } = await import("@circle-fin/app-kit");

      const adapter = await createViemAdapterFromProvider({
        provider:
          provider as Parameters<
            typeof createViemAdapterFromProvider
          >[0]["provider"],
      });

      const kit = new AppKit();

      const result = await (
        kit as unknown as {
          swap: (p: {
            from: { adapter: typeof adapter; chain: string };
            tokenIn: string;
            tokenOut: string;
            amountIn: string;
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
        config: { kitKey },
      });

      const txHash =
        result?.txHash ?? result?.transactionHash ?? result?.hash ?? "";
      const amountOut =
        result?.estimatedOutput?.amount ?? result?.amountOut ?? "0";
      const explorerUrl =
        result?.explorerUrl ?? `https://testnet.arcscan.app/tx/${txHash}`;

      return {
        success: true,
        transactionHash: txHash,
        explorerUrl,
        amountOut,
      };
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
