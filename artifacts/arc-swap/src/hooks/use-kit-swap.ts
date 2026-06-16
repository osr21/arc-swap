import { useState } from "react";
import { createWalletClient, createPublicClient, custom, http, parseUnits, formatUnits, isAddress } from "viem";
import { arcTestnet } from "@/lib/arc-chain";

export interface KitSwapParams { tokenIn: string; tokenOut: string; amountIn: string; slippageBps?: number; }
export interface KitSwapResult { success: boolean; transactionHash: string; explorerUrl: string; amountOut: string; fee: string; }

const ALLOWED_EXPLORER_ORIGIN = "https://testnet.arcscan.app";

const TOKEN_INFO: Record<string, { address: `0x${string}`; decimals: number } | undefined> = {
  USDC: { address: "0x3600000000000000000000000000000000000000", decimals: 6 },
  EURC: { address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", decimals: 6 },
};

const APPROVE_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

const ROUTER_ABI = [
  {
    name: "swapExactTokensForTokens",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

function safeSanitizeExplorerUrl(url: string, txHash: string): string {
  try { const p = new URL(url); if (p.origin === ALLOWED_EXPLORER_ORIGIN) return url; } catch {}
  return `${ALLOWED_EXPLORER_ORIGIN}/tx/${txHash}`;
}

interface AppConfig {
  walletAddress: string;
  contracts: { router: string | null; factory: string | null; pairUsdcEurc: string | null };
}

async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch("/api/config/wallet");
  if (!res.ok) throw new Error("Failed to fetch app config");
  return res.json() as Promise<AppConfig>;
}

export function useKitSwap() {
  const [isSwapping, setIsSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const executeSwap = async (params: KitSwapParams): Promise<KitSwapResult> => {
    setIsSwapping(true);
    setError(null);
    try {
      const provider = (window as Window & { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
      if (!provider) throw new Error("No wallet detected. Please install MetaMask.");

      const walletClient = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http("https://rpc.testnet.arc.network") });

      const accounts = await walletClient.getAddresses();
      const userAddress = accounts[0];
      if (!userAddress) throw new Error("No account found. Please connect your wallet.");

      const config = await fetchConfig();

      // cirBTC: simulated via backend (no on-chain contract on testnet)
      if (params.tokenIn === "cirBTC" || params.tokenOut === "cirBTC") {
        return await backendSwap(params, userAddress, config.walletAddress as `0x${string}`, walletClient, publicClient);
      }

      const routerAddress = config.contracts.router;

      // Pool deployed: swap through Uniswap V2 router directly
      if (routerAddress && isAddress(routerAddress)) {
        return await routerSwap(params, userAddress, routerAddress as `0x${string}`, walletClient, publicClient);
      }

      // Pool not deployed yet: fall back to backend peer-to-peer swap
      return await backendSwap(params, userAddress, config.walletAddress as `0x${string}`, walletClient, publicClient);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw new Error(msg);
    } finally {
      setIsSwapping(false);
    }
  };

  return { executeSwap, isSwapping, error, clearError: () => setError(null) };
}

// ── Router-based swap (Uniswap V2) ────────────────────────────────────────────

async function routerSwap(
  params: KitSwapParams,
  userAddress: `0x${string}`,
  routerAddress: `0x${string}`,
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
): Promise<KitSwapResult> {
  const tokenInInfo = TOKEN_INFO[params.tokenIn];
  if (!tokenInInfo) throw new Error(`Unknown token: ${params.tokenIn}`);
  const tokenOutInfo = TOKEN_INFO[params.tokenOut];
  if (!tokenOutInfo) throw new Error(`Unknown token: ${params.tokenOut}`);

  const amountRaw = parseUnits(params.amountIn, tokenInInfo.decimals);
  const slippageBps = params.slippageBps ?? 50; // default 0.5%

  // Check and set allowance for router
  const allowance = await publicClient.readContract({
    address: tokenInInfo.address,
    abi: APPROVE_ABI,
    functionName: "allowance",
    args: [userAddress, routerAddress],
  }) as bigint;

  if (allowance < amountRaw) {
    const approveHash = await walletClient.writeContract({
      address: tokenInInfo.address,
      abi: APPROVE_ABI,
      functionName: "approve",
      args: [routerAddress, amountRaw],
      account: userAddress,
      chain: arcTestnet,
      gas: 100_000n, // explicit override — eth_estimateGas unreliable on Arc Testnet
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  // Get quote to compute minimum output
  const quoteRes = await fetch("/api/swap/estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokenIn: params.tokenIn, tokenOut: params.tokenOut, amountIn: params.amountIn }),
  });
  const quoteText = await quoteRes.text();
  let quote: { estimatedAmountOut?: string; error?: string } = {};
  try { quote = JSON.parse(quoteText) as typeof quote; } catch { /* ignore */ }
  if (!quoteRes.ok || !quote.estimatedAmountOut) throw new Error(quote.error ?? "Failed to get quote");

  const expectedOut = parseUnits(quote.estimatedAmountOut, tokenOutInfo.decimals);
  const amountOutMin = (expectedOut * BigInt(10_000 - slippageBps)) / 10_000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 min

  // Execute swap through router — user pays gas, tokens go directly to user
  const swapHash = await walletClient.writeContract({
    address: routerAddress,
    abi: ROUTER_ABI,
    functionName: "swapExactTokensForTokens",
    args: [amountRaw, amountOutMin, [tokenInInfo.address, tokenOutInfo.address], userAddress, deadline],
    account: userAddress,
    chain: arcTestnet,
    gas: 250_000n, // explicit override — eth_estimateGas unreliable on Arc Testnet
  });
  await publicClient.waitForTransactionReceipt({ hash: swapHash });

  // Record in DB
  const fee = (parseFloat(params.amountIn) * 0.003).toFixed(6);
  await fetch("/api/swap/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      amountOut: quote.estimatedAmountOut,
      userAddress,
      txHash: swapHash,
    }),
  }).catch(() => { /* non-critical */ });

  return {
    success: true,
    transactionHash: swapHash,
    explorerUrl: safeSanitizeExplorerUrl(`${ALLOWED_EXPLORER_ORIGIN}/tx/${swapHash}`, swapHash),
    amountOut: quote.estimatedAmountOut ?? "0",
    fee,
  };
}

// ── Backend peer-to-peer swap (fallback) ──────────────────────────────────────

async function backendSwap(
  params: KitSwapParams,
  userAddress: `0x${string}`,
  backendWallet: `0x${string}`,
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
): Promise<KitSwapResult> {
  const tokenInfo = TOKEN_INFO[params.tokenIn];
  if (tokenInfo) {
    const amountRaw = parseUnits(params.amountIn, tokenInfo.decimals);
    const approveHash = await walletClient.writeContract({
      address: tokenInfo.address,
      abi: APPROVE_ABI,
      functionName: "approve",
      args: [backendWallet, amountRaw],
      account: userAddress,
      chain: arcTestnet,
      gas: 100_000n,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  const res = await fetch("/api/swap/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokenIn: params.tokenIn, tokenOut: params.tokenOut, amountIn: params.amountIn, userAddress }),
  });
  const rawText = await res.text();
  let data: { success?: boolean; transactionHash?: string; explorerUrl?: string; amountOut?: string; fee?: string; error?: string; details?: string } = {};
  try { data = JSON.parse(rawText) as typeof data; } catch {
    throw new Error(res.ok ? "Unexpected server response" : `Server error (${res.status})`);
  }
  if (!res.ok || !data.success) throw new Error(data.details ?? data.error ?? "Swap failed");

  const txHash = data.transactionHash ?? "";
  return {
    success: true,
    transactionHash: txHash,
    explorerUrl: safeSanitizeExplorerUrl(data.explorerUrl ?? `${ALLOWED_EXPLORER_ORIGIN}/tx/${txHash}`, txHash),
    amountOut: data.amountOut ?? "0",
    fee: data.fee ?? "0",
  };
}
