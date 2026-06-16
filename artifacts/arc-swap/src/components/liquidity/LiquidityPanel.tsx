import React, { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { createWalletClient, createPublicClient, custom, http, parseUnits, formatUnits, isAddress } from "viem";
import { arcTestnet } from "@/lib/arc-chain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Droplets, TrendingUp, AlertCircle, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

const USDC = { address: "0x3600000000000000000000000000000000000000" as `0x${string}`, decimals: 6, symbol: "USDC" };
const EURC = { address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}`, decimals: 6, symbol: "EURC" };

const APPROVE_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

const LP_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

const ROUTER_ABI = [
  {
    name: "addLiquidity",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenA", type: "address" }, { name: "tokenB", type: "address" },
      { name: "amountADesired", type: "uint256" }, { name: "amountBDesired", type: "uint256" },
      { name: "amountAMin", type: "uint256" }, { name: "amountBMin", type: "uint256" },
      { name: "to", type: "address" }, { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amountA", type: "uint256" }, { name: "amountB", type: "uint256" }, { name: "liquidity", type: "uint256" }],
  },
  {
    name: "removeLiquidity",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenA", type: "address" }, { name: "tokenB", type: "address" },
      { name: "liquidity", type: "uint256" },
      { name: "amountAMin", type: "uint256" }, { name: "amountBMin", type: "uint256" },
      { name: "to", type: "address" }, { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amountA", type: "uint256" }, { name: "amountB", type: "uint256" }],
  },
] as const;

interface PoolInfo {
  pairAddress: string;
  reserves: { USDC: string; EURC: string };
  prices: { USDCtoEURC: string; EURCtoUSDC: string };
  tvlUsdc: string;
  totalLpSupply: string;
}

interface LpBalance {
  lpBalance: string;
  sharePercent: string;
  pooledTokens: { USDC: string; EURC: string };
}

interface AppConfig {
  walletAddress: string;
  contracts: { router: string | null; pairUsdcEurc: string | null };
}

export function LiquidityPanel() {
  const { address, isConnected } = useAccount();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [poolInfo, setPoolInfo] = useState<PoolInfo | null>(null);
  const [lpBalance, setLpBalance] = useState<LpBalance | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [poolError, setPoolError] = useState<string | null>(null);

  // Add liquidity state
  const [usdcAmount, setUsdcAmount] = useState("");
  const [eurcAmount, setEurcAmount] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  // Remove liquidity state
  const [removePercent, setRemovePercent] = useState("25");
  const [isRemoving, setIsRemoving] = useState(false);

  const [txError, setTxError] = useState<string | null>(null);

  useEffect(() => {
    void refreshPool();
  }, [address]);

  async function refreshPool() {
    setLoading(true);
    setPoolError(null);
    try {
      const [configRes, poolRes] = await Promise.all([
        fetch("/api/config/wallet"),
        fetch("/api/pool/info"),
      ]);
      const cfg = await configRes.json() as AppConfig;
      setConfig(cfg);

      if (!poolRes.ok) {
        const err = await poolRes.json() as { error: string };
        setPoolError(err.error ?? "Pool not available");
        return;
      }
      const pool = await poolRes.json() as PoolInfo;
      setPoolInfo(pool);

      if (address && isAddress(address)) {
        const lpRes = await fetch(`/api/pool/lp-balance?address=${address}`);
        if (lpRes.ok) setLpBalance(await lpRes.json() as LpBalance);
      }
    } catch {
      setPoolError("Failed to load pool data");
    } finally {
      setLoading(false);
    }
  }

  // Auto-calculate EURC when USDC changes using pool price
  function handleUsdcChange(val: string) {
    setUsdcAmount(val);
    if (poolInfo && val && !isNaN(Number(val))) {
      const eurc = (Number(val) * Number(poolInfo.prices.USDCtoEURC)).toFixed(6);
      setEurcAmount(eurc);
    }
  }

  function handleEurcChange(val: string) {
    setEurcAmount(val);
    if (poolInfo && val && !isNaN(Number(val))) {
      const usdc = (Number(val) * Number(poolInfo.prices.EURCtoUSDC)).toFixed(6);
      setUsdcAmount(usdc);
    }
  }

  async function handleAddLiquidity() {
    if (!address || !config?.contracts.router || !usdcAmount || !eurcAmount) return;
    setIsAdding(true);
    setTxError(null);
    try {
      const provider = (window as Window & { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
      if (!provider) throw new Error("No wallet detected");

      const walletClient = createWalletClient({ chain: arcTestnet, transport: custom(provider), account: address });
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http("https://rpc.testnet.arc.network") });
      const routerAddress = config.contracts.router as `0x${string}`;

      const amountUsdc = parseUnits(usdcAmount, USDC.decimals);
      const amountEurc = parseUnits(eurcAmount, EURC.decimals);
      const slippage = 50n; // 0.5% in BPS

      // Approve router for USDC
      const usdcAllowance = await publicClient.readContract({ address: USDC.address, abi: APPROVE_ABI, functionName: "allowance", args: [address, routerAddress] }) as bigint;
      if (usdcAllowance < amountUsdc) {
        const h = await walletClient.writeContract({ address: USDC.address, abi: APPROVE_ABI, functionName: "approve", args: [routerAddress, amountUsdc], account: address, gas: 100_000n });
        await publicClient.waitForTransactionReceipt({ hash: h });
      }

      // Approve router for EURC
      const eurcAllowance = await publicClient.readContract({ address: EURC.address, abi: APPROVE_ABI, functionName: "allowance", args: [address, routerAddress] }) as bigint;
      if (eurcAllowance < amountEurc) {
        const h = await walletClient.writeContract({ address: EURC.address, abi: APPROVE_ABI, functionName: "approve", args: [routerAddress, amountEurc], account: address, gas: 100_000n });
        await publicClient.waitForTransactionReceipt({ hash: h });
      }

      const amountUsdcMin = (amountUsdc * (10_000n - slippage)) / 10_000n;
      const amountEurcMin = (amountEurc * (10_000n - slippage)) / 10_000n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

      const txHash = await walletClient.writeContract({
        address: routerAddress,
        abi: ROUTER_ABI,
        functionName: "addLiquidity",
        args: [USDC.address, EURC.address, amountUsdc, amountEurc, amountUsdcMin, amountEurcMin, address, deadline],
        account: address,
        gas: 500_000n,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      // Estimate LP tokens received (simplified)
      const lpApprox = Math.sqrt(Number(usdcAmount) * Number(eurcAmount)).toFixed(6);

      await fetch("/api/pool/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAddress: address, txHash, amountA: usdcAmount, amountB: eurcAmount, lpTokenAmount: lpApprox }),
      }).catch(() => {});

      toast({
        title: "Liquidity Added",
        description: (
          <div className="flex flex-col gap-1">
            <span>Added {usdcAmount} USDC + {eurcAmount} EURC to pool</span>
            <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="text-primary underline text-sm">
              View on Explorer
            </a>
          </div>
        ),
      });
      setUsdcAmount("");
      setEurcAmount("");
      await refreshPool();
      queryClient.invalidateQueries();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Add liquidity failed";
      setTxError(msg);
    } finally {
      setIsAdding(false);
    }
  }

  async function handleRemoveLiquidity() {
    if (!address || !config?.contracts.router || !lpBalance || !config.contracts.pairUsdcEurc) return;
    setIsRemoving(true);
    setTxError(null);
    try {
      const provider = (window as Window & { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
      if (!provider) throw new Error("No wallet detected");

      const walletClient = createWalletClient({ chain: arcTestnet, transport: custom(provider), account: address });
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http("https://rpc.testnet.arc.network") });
      const routerAddress = config.contracts.router as `0x${string}`;
      const pairAddress = config.contracts.pairUsdcEurc as `0x${string}`;

      const totalLp = parseUnits(lpBalance.lpBalance, 18);
      const liquidityToRemove = (totalLp * BigInt(Math.floor(Number(removePercent)))) / 100n;
      if (liquidityToRemove === 0n) throw new Error("Nothing to remove");

      // Approve router for LP tokens
      const lpApproveHash = await walletClient.writeContract({
        address: pairAddress,
        abi: LP_ABI,
        functionName: "approve",
        args: [routerAddress, liquidityToRemove],
        account: address,
        gas: 100_000n,
      });
      await publicClient.waitForTransactionReceipt({ hash: lpApproveHash });

      const pooledUsdc = parseUnits(lpBalance.pooledTokens.USDC, USDC.decimals);
      const pooledEurc = parseUnits(lpBalance.pooledTokens.EURC, EURC.decimals);
      const fraction = BigInt(Math.floor(Number(removePercent))) * 100n;
      const minUsdc = (pooledUsdc * fraction * 95n) / 10_000_000n;
      const minEurc = (pooledEurc * fraction * 95n) / 10_000_000n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

      const txHash = await walletClient.writeContract({
        address: routerAddress,
        abi: ROUTER_ABI,
        functionName: "removeLiquidity",
        args: [USDC.address, EURC.address, liquidityToRemove, minUsdc, minEurc, address, deadline],
        account: address,
        gas: 300_000n,
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const removedUsdc = (Number(lpBalance.pooledTokens.USDC) * Number(removePercent) / 100).toFixed(6);
      const removedEurc = (Number(lpBalance.pooledTokens.EURC) * Number(removePercent) / 100).toFixed(6);

      await fetch("/api/pool/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAddress: address,
          txHash,
          amountA: removedUsdc,
          amountB: removedEurc,
          lpTokenAmount: formatUnits(liquidityToRemove, 18),
        }),
      }).catch(() => {});

      toast({
        title: "Liquidity Removed",
        description: (
          <div className="flex flex-col gap-1">
            <span>Removed {removePercent}% of your pool position</span>
            <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="text-primary underline text-sm">
              View on Explorer
            </a>
          </div>
        ),
      });
      await refreshPool();
      queryClient.invalidateQueries();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Remove liquidity failed";
      setTxError(msg);
    } finally {
      setIsRemoving(false);
    }
  }

  if (loading) {
    return (
      <Card className="w-full max-w-md mx-auto shadow-2xl border-border/50 bg-card/80 backdrop-blur-xl">
        <CardContent className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (poolError) {
    return (
      <Card className="w-full max-w-md mx-auto shadow-2xl border-border/50 bg-card/80 backdrop-blur-xl">
        <CardHeader><CardTitle className="flex items-center gap-2"><Droplets className="w-5 h-5 text-primary" /> Pool</CardTitle></CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{poolError}</AlertDescription>
          </Alert>
          <p className="text-xs text-muted-foreground mt-3 text-center">
            Pool not deployed yet. Run <code className="bg-secondary px-1 rounded">deploy:uniswap</code> script first.
          </p>
        </CardContent>
      </Card>
    );
  }

  const hasPosition = lpBalance && Number(lpBalance.lpBalance) > 0;

  return (
    <Card className="w-full max-w-md mx-auto shadow-2xl border-border/50 bg-card/80 backdrop-blur-xl">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <Droplets className="w-5 h-5 text-primary" />
          USDC / EURC Pool
        </CardTitle>
        {poolInfo && (
          <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
            <div className="p-2 rounded-lg bg-secondary/30 border border-border/40 text-center">
              <div className="text-muted-foreground">TVL</div>
              <div className="font-mono font-semibold text-foreground">${Number(poolInfo.tvlUsdc).toLocaleString()}</div>
            </div>
            <div className="p-2 rounded-lg bg-secondary/30 border border-border/40 text-center">
              <div className="text-muted-foreground">USDC Reserve</div>
              <div className="font-mono font-semibold text-foreground">{Number(poolInfo.reserves.USDC).toLocaleString()}</div>
            </div>
            <div className="p-2 rounded-lg bg-secondary/30 border border-border/40 text-center">
              <div className="text-muted-foreground">EURC Reserve</div>
              <div className="font-mono font-semibold text-foreground">{Number(poolInfo.reserves.EURC).toLocaleString()}</div>
            </div>
          </div>
        )}
        {poolInfo && (
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <TrendingUp className="w-3 h-3" />
            <span>1 USDC = {poolInfo.prices.USDCtoEURC} EURC · 0.3% fee</span>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {!isConnected ? (
          <p className="text-center text-muted-foreground py-8">Connect wallet to manage liquidity</p>
        ) : (
          <Tabs defaultValue="add">
            <TabsList className="w-full mb-4">
              <TabsTrigger value="add" className="flex-1">Add Liquidity</TabsTrigger>
              <TabsTrigger value="remove" className="flex-1" disabled={!hasPosition}>
                Remove {hasPosition ? `(${Number(lpBalance!.sharePercent).toFixed(2)}%)` : ""}
              </TabsTrigger>
            </TabsList>

            {/* Add Liquidity Tab */}
            <TabsContent value="add" className="space-y-3">
              <div className="p-3 rounded-xl bg-secondary/30 border border-border/50 space-y-2">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>USDC</span>
                </div>
                <Input
                  type="number"
                  placeholder="0.0"
                  value={usdcAmount}
                  onChange={(e) => handleUsdcChange(e.target.value)}
                  className="border-0 bg-transparent text-xl font-mono p-0 h-10 focus-visible:ring-0 shadow-none"
                />
              </div>
              <div className="flex justify-center text-muted-foreground text-lg">+</div>
              <div className="p-3 rounded-xl bg-secondary/30 border border-border/50 space-y-2">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>EURC</span>
                </div>
                <Input
                  type="number"
                  placeholder="0.0"
                  value={eurcAmount}
                  onChange={(e) => handleEurcChange(e.target.value)}
                  className="border-0 bg-transparent text-xl font-mono p-0 h-10 focus-visible:ring-0 shadow-none"
                />
              </div>
              {txError && (
                <Alert variant="destructive" className="py-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">{txError}</AlertDescription>
                </Alert>
              )}
              <Button
                className="w-full h-11 font-medium"
                onClick={() => void handleAddLiquidity()}
                disabled={isAdding || !usdcAmount || !eurcAmount || !config?.contracts.router}
              >
                {isAdding ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {isAdding ? "Adding Liquidity..." : "Add Liquidity"}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                You&apos;ll receive LP tokens representing your pool share. Earn 0.3% on every swap.
              </p>
            </TabsContent>

            {/* Remove Liquidity Tab */}
            <TabsContent value="remove" className="space-y-4">
              {hasPosition && lpBalance && (
                <div className="p-3 rounded-xl bg-secondary/20 border border-border/40 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Your share</span>
                    <span className="font-mono">{Number(lpBalance.sharePercent).toFixed(4)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pooled USDC</span>
                    <span className="font-mono">{Number(lpBalance.pooledTokens.USDC).toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pooled EURC</span>
                    <span className="font-mono">{Number(lpBalance.pooledTokens.EURC).toFixed(4)}</span>
                  </div>
                </div>
              )}
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Amount to remove</span>
                  <span className="font-mono font-semibold">{removePercent}%</span>
                </div>
                <div className="flex gap-2">
                  {[25, 50, 75, 100].map((p) => (
                    <Button
                      key={p}
                      variant={removePercent === p.toString() ? "default" : "outline"}
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={() => setRemovePercent(p.toString())}
                    >
                      {p === 100 ? "MAX" : `${p}%`}
                    </Button>
                  ))}
                </div>
              </div>
              {hasPosition && lpBalance && (
                <div className="p-3 rounded-xl bg-secondary/20 border border-border/40 text-sm space-y-1">
                  <div className="text-muted-foreground text-xs mb-1">You will receive:</div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">USDC</span>
                    <span className="font-mono">{(Number(lpBalance.pooledTokens.USDC) * Number(removePercent) / 100).toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">EURC</span>
                    <span className="font-mono">{(Number(lpBalance.pooledTokens.EURC) * Number(removePercent) / 100).toFixed(4)}</span>
                  </div>
                </div>
              )}
              {txError && (
                <Alert variant="destructive" className="py-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">{txError}</AlertDescription>
                </Alert>
              )}
              <Button
                variant="destructive"
                className="w-full h-11 font-medium"
                onClick={() => void handleRemoveLiquidity()}
                disabled={isRemoving || !hasPosition}
              >
                {isRemoving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {isRemoving ? "Removing..." : `Remove ${removePercent}% Liquidity`}
              </Button>
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
