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

const BACKEND_WALLET = "0xf4a14B84108885AF2f18843DD18761706e47d5F6" as `0x${string}`;

if (!isAddress(BACKEND_WALLET)) {
  throw new Error(`Invalid hardcoded BACKEND_WALLET: ${BACKEND_WALLET}`);
}

const ERC20_ABI = [
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

const TOKEN_INFO: Record<string, { address: `0x${string}`; decimals: number } | undefined> = {
  USDC: { address: "0x3600000000000000000000000000000000000000", decimals: 6 },
  EURC: { address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", decimals: 6 },
  cirBTC: undefined,
};

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

      const tokenInfo = TOKEN_INFO[params.tokenIn];

      if (tokenInfo) {
        // Transfer the full swap amount from user → backend wallet.
        // The backend executes the swap using these tokens and returns the output.
        const amountRaw = parseUnits(params.amountIn, tokenInfo.decimals);

        await walletClient.writeContract({
          address: tokenInfo.address,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [BACKEND_WALLET, amountRaw],
          account: userAddress,
        });
      }

      const res = await fetch("/api/swap/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          amountIn: params.amountIn,
          userAddress,
        }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        transactionHash?: string;
        explorerUrl?: string;
        amountOut?: string;
        error?: string;
        details?: string;
      };

      if (!res.ok || !data.success) {
        throw new Error(data.details ?? data.error ?? "Swap failed");
      }

      const txHash = data.transactionHash ?? "";
      const rawUrl = data.explorerUrl ?? `${ALLOWED_EXPLORER_ORIGIN}/tx/${txHash}`;
      const explorerUrl = safeSanitizeExplorerUrl(rawUrl, txHash);
      const amountOut = data.amountOut ?? "0";

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
