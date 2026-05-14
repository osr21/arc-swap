import { useState } from "react";
import { createWalletClient, custom, parseUnits, createPublicClient, http } from "viem";
import { arcTestnet } from "@/lib/arc-chain";

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

const TOKEN_INFO: Record<string, { address: `0x${string}`; decimals: number }> = {
  USDC: { address: "0x3600000000000000000000000000000000000000", decimals: 6 },
  EURC: { address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", decimals: 6 },
};

const ERC20_TRANSFER_ABI = [
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
] as const;

export function useKitSwap() {
  const [isSwapping, setIsSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const executeSwap = async (params: KitSwapParams): Promise<KitSwapResult> => {
    setIsSwapping(true);
    setError(null);

    try {
      const configRes = await fetch("/api/config");
      if (!configRes.ok) throw new Error("Failed to fetch kit configuration");
      const { kitKey, feeWalletAddress, platformFeeBps } = (await configRes.json()) as {
        kitKey: string;
        feeWalletAddress: string;
        platformFeeBps: number;
      };

      const provider = (window as Window & { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
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

      const feeAmount = parseFloat(params.amountIn) * platformFeeBps / 10_000;
      const effectiveAmountIn = (parseFloat(params.amountIn) - feeAmount).toFixed(6);

      const tokenInfo = TOKEN_INFO[params.tokenIn];
      if (tokenInfo && feeAmount > 0 && feeWalletAddress) {
        const feeRaw = parseUnits(feeAmount.toFixed(tokenInfo.decimals), tokenInfo.decimals);

        await walletClient.writeContract({
          address: tokenInfo.address,
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: [feeWalletAddress as `0x${string}`, feeRaw],
          account: userAddress,
        });
      }

      const { createViemAdapterFromProvider } = await import("@circle-fin/adapter-viem-v2");
      const { AppKit } = await import("@circle-fin/app-kit");

      const adapter = await createViemAdapterFromProvider({
        provider: provider as Parameters<typeof createViemAdapterFromProvider>[0]["provider"],
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
        amountIn: effectiveAmountIn,
        config: { kitKey },
      });

      const txHash = result?.txHash ?? result?.transactionHash ?? result?.hash ?? "";
      const amountOut = result?.estimatedOutput?.amount ?? result?.amountOut ?? "0";
      const explorerUrl = result?.explorerUrl ?? `https://testnet.arcscan.app/tx/${txHash}`;

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
