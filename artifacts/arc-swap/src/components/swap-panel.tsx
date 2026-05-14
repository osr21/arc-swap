import React, { useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { injected } from "wagmi/connectors";
import {
  useEstimateSwap,
  getGetWalletBalancesQueryKey,
  getGetSwapHistoryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ArrowDownUp, RefreshCw, Loader2, AlertCircle, Wallet, Settings2, AlertTriangle } from "lucide-react";
import { formatAmount } from "@/lib/format";
import { useKitSwap } from "@/hooks/use-kit-swap";

const TOKENS = ["USDC", "EURC", "cirBTC"] as const;
type Token = (typeof TOKENS)[number];

const SLIPPAGE_PRESETS = ["0.1", "0.5", "1.0"];

function getPriceImpactColor(impact: number): string {
  if (impact < 1) return "text-green-400";
  if (impact < 3) return "text-amber-400";
  return "text-red-400";
}

function getPriceImpactLabel(impact: number): string {
  if (impact < 1) return "Low";
  if (impact < 3) return "Medium";
  return "High";
}

export function SwapPanel() {
  const [tokenIn, setTokenIn] = useState<Token>("USDC");
  const [tokenOut, setTokenOut] = useState<Token>("EURC");
  const [amountIn, setAmountIn] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [customSlippage, setCustomSlippage] = useState("");
  const [slippageOpen, setSlippageOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [swapResult, setSwapResult] = useState<{
    success: boolean;
    transactionHash: string;
    explorerUrl: string;
  } | null>(null);

  const { isConnected, chainId } = useAccount();
  const { connect } = useConnect();
  const isWrongNetwork = isConnected && chainId !== 5042002;
  const queryClient = useQueryClient();
  const estimateMutation = useEstimateSwap();
  const { executeSwap, isSwapping } = useKitSwap();

  const activeSlippage = customSlippage || slippage;
  const slippageNum = parseFloat(activeSlippage) || 0.5;

  const resetState = () => {
    setAmountIn("");
    estimateMutation.reset();
    setErrorMsg(null);
    setSwapResult(null);
  };

  const handleSwapDirection = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    resetState();
  };

  const handleGetQuote = () => {
    if (!amountIn || isNaN(Number(amountIn)) || Number(amountIn) <= 0) {
      setErrorMsg("Please enter a valid amount");
      return;
    }
    if (Number(amountIn) < 0.01) {
      setErrorMsg("Minimum swap amount is 0.01");
      return;
    }
    setErrorMsg(null);
    setSwapResult(null);
    estimateMutation.mutate(
      { data: { tokenIn, tokenOut, amountIn } },
      {
        onError: (err: unknown) => {
          const e = err as { error?: string; message?: string };
          setErrorMsg(e.error || e.message || "Failed to get quote");
        },
      }
    );
  };

  const handleExecuteSwap = async () => {
    setErrorMsg(null);
    try {
      const slippageBps = Math.round(slippageNum * 100);
      const result = await executeSwap({ tokenIn, tokenOut, amountIn, slippageBps });
      setSwapResult(result);
      queryClient.invalidateQueries({ queryKey: getGetWalletBalancesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetSwapHistoryQueryKey() });
      setAmountIn("");
      estimateMutation.reset();
    } catch (err: unknown) {
      const e = err as { message?: string };
      setErrorMsg(e.message || "Swap failed");
    }
  };

  const isEstimating = estimateMutation.isPending;
  const isExecuting = isSwapping;
  const estimate = estimateMutation.data;

  const priceImpactNum = estimate ? parseFloat(estimate.priceImpact ?? "0") : 0;
  const showPriceImpactWarning = priceImpactNum >= slippageNum;

  return (
    <div className="bg-card border border-border rounded-2xl p-4 shadow-xl">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold tracking-tight">Swap</h2>
        <div className="flex items-center gap-1">
          {/* Slippage Settings */}
          <Popover open={slippageOpen} onOpenChange={setSlippageOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground relative"
                title="Slippage tolerance"
              >
                <Settings2 className="h-4 w-4" />
                {activeSlippage !== "0.5" && (
                  <span className="absolute -top-1 -right-1 text-[9px] bg-primary text-primary-foreground rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">!</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-4">
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium mb-1">Slippage Tolerance</p>
                  <p className="text-xs text-muted-foreground">Maximum price movement you accept</p>
                </div>
                <div className="flex gap-2">
                  {SLIPPAGE_PRESETS.map((val) => (
                    <button
                      key={val}
                      onClick={() => { setSlippage(val); setCustomSlippage(""); }}
                      className={`flex-1 text-xs py-1.5 rounded-lg border font-mono transition-colors ${
                        slippage === val && !customSlippage
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-secondary hover:border-primary/40"
                      }`}
                    >
                      {val}%
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    placeholder="Custom"
                    value={customSlippage}
                    onChange={(e) => {
                      const raw = parseFloat(e.target.value);
                      if (isNaN(raw)) { setCustomSlippage(""); return; }
                      const clamped = Math.min(50, Math.max(0.01, raw));
                      setCustomSlippage(String(clamped));
                    }}
                    className="h-8 text-xs font-mono"
                    min="0.01"
                    max="50"
                    step="0.01"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                {slippageNum > 3 && (
                  <p className="text-xs text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    High slippage — your trade may be front-run
                  </p>
                )}
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => setSlippageOpen(false)}
                >
                  Apply
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={resetState}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Connect Wallet / Wrong Network Gate */}
      {(!isConnected || isWrongNetwork) && (
        <div
          className={`mb-4 p-4 rounded-xl border flex flex-col items-center gap-3 text-center ${
            isWrongNetwork
              ? "border-amber-500/30 bg-amber-500/5"
              : "border-primary/20 bg-primary/5"
          }`}
        >
          <Wallet className={`w-6 h-6 ${isWrongNetwork ? "text-amber-400/60" : "text-primary/60"}`} />
          <div className="text-sm text-muted-foreground">
            {isWrongNetwork
              ? "Switch to Arc Testnet to swap tokens"
              : "Connect your wallet to swap tokens on Arc Testnet"}
          </div>
          {isWrongNetwork ? (
            <Button
              size="sm"
              variant="outline"
              className="gap-2 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
              onClick={async () => {
                const p = (
                  window as Window & {
                    ethereum?: {
                      request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
                    };
                  }
                ).ethereum;
                if (p)
                  await p.request({
                    method: "wallet_addEthereumChain",
                    params: [
                      {
                        chainId: "0x4CEF52",
                        chainName: "Arc Testnet",
                        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
                        rpcUrls: ["https://rpc.testnet.arc.network"],
                        blockExplorerUrls: ["https://testnet.arcscan.app"],
                      },
                    ],
                  });
              }}
            >
              Switch to Arc Testnet
            </Button>
          ) : (
            <Button
              size="sm"
              className="gap-2"
              onClick={() => connect({ connector: injected() })}
              data-testid="button-connect-wallet-swap"
            >
              <Wallet className="h-3.5 w-3.5" />
              Connect Wallet
            </Button>
          )}
        </div>
      )}

      <div className="space-y-2">
        {/* Token In */}
        <div className="bg-background rounded-xl p-3 border border-border/50 transition-colors focus-within:border-primary/50">
          <div className="text-xs text-muted-foreground mb-1">Pay</div>
          <div className="flex gap-2">
            <Input
              type="number"
              placeholder="0.00"
              value={amountIn}
              min="0"
              step="any"
              onChange={(e) => {
                setAmountIn(e.target.value);
                estimateMutation.reset();
                setSwapResult(null);
              }}
              className="border-0 bg-transparent text-2xl p-0 h-auto font-mono focus-visible:ring-0 shadow-none"
              data-testid="input-amount-in"
            />
            <Select
              value={tokenIn}
              onValueChange={(val) => {
                setTokenIn(val as Token);
                estimateMutation.reset();
              }}
              data-testid="select-token-in"
            >
              <SelectTrigger className="w-[110px] bg-secondary border-0 shadow-none font-medium h-9">
                <SelectValue placeholder="Token" />
              </SelectTrigger>
              <SelectContent>
                {TOKENS.map((t) => (
                  <SelectItem key={t} value={t} disabled={t === tokenOut}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Swap Arrow */}
        <div className="flex justify-center -my-3 relative z-10">
          <Button
            variant="secondary"
            size="icon"
            className="h-8 w-8 rounded-full border border-card shadow-sm hover:border-primary/30"
            onClick={handleSwapDirection}
            data-testid="button-swap-direction"
          >
            <ArrowDownUp className="h-3 w-3" />
          </Button>
        </div>

        {/* Token Out */}
        <div className="bg-background rounded-xl p-3 border border-border/50">
          <div className="text-xs text-muted-foreground mb-1">Receive (Estimated)</div>
          <div className="flex gap-2">
            <div
              className="flex-1 text-2xl font-mono px-0 h-auto flex items-center text-muted-foreground truncate"
              data-testid="text-estimated-out"
            >
              {isEstimating ? (
                <Loader2 className="h-5 w-5 animate-spin opacity-50" />
              ) : estimate ? (
                <span className="text-foreground">{formatAmount(estimate.estimatedAmountOut, 6)}</span>
              ) : (
                "0.00"
              )}
            </div>
            <Select
              value={tokenOut}
              onValueChange={(val) => {
                setTokenOut(val as Token);
                estimateMutation.reset();
              }}
              data-testid="select-token-out"
            >
              <SelectTrigger className="w-[110px] bg-secondary border-0 shadow-none font-medium h-9">
                <SelectValue placeholder="Token" />
              </SelectTrigger>
              <SelectContent>
                {TOKENS.map((t) => (
                  <SelectItem key={t} value={t} disabled={t === tokenIn}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Quote Details */}
      {estimate && (
        <div className="mt-4 p-3 rounded-lg bg-secondary/50 border border-border text-xs space-y-2 font-mono">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Rate</span>
            <span>
              1 {tokenIn} = {formatAmount(estimate.exchangeRate, 6)} {tokenOut}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Platform Fee (0.3%)</span>
            <span className="text-primary">
              {formatAmount(estimate.platformFee, 6)} {tokenIn}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Amount Swapped</span>
            <span>
              {formatAmount(estimate.effectiveAmountIn ?? estimate.amountIn, 6)} {tokenIn}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Network Gas</span>
            <span>
              {estimate.fee} {tokenIn}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Slippage Tolerance</span>
            <span>{activeSlippage}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Price Impact</span>
            <span className={getPriceImpactColor(priceImpactNum)}>
              {priceImpactNum.toFixed(2)}% ({getPriceImpactLabel(priceImpactNum)})
            </span>
          </div>
          <div className="flex justify-between border-t border-border/50 pt-2 font-semibold">
            <span className="text-muted-foreground">You Receive ≈</span>
            <span className="text-primary">
              +{formatAmount(estimate.estimatedAmountOut, 6)} {tokenOut}
            </span>
          </div>
        </div>
      )}

      {/* Price Impact Warning */}
      {estimate && showPriceImpactWarning && (
        <div
          className={`mt-3 p-3 rounded-lg border flex items-start gap-2 text-xs ${
            priceImpactNum >= 3
              ? "bg-red-500/10 border-red-500/30 text-red-400"
              : "bg-amber-500/10 border-amber-500/30 text-amber-400"
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {priceImpactNum >= 3
              ? `High price impact (${priceImpactNum.toFixed(2)}%) — this swap may result in significant loss. Reduce amount or increase slippage tolerance.`
              : `Price impact (${priceImpactNum.toFixed(2)}%) exceeds your slippage tolerance (${activeSlippage}%). The swap may fail.`}
          </span>
        </div>
      )}

      {/* Error */}
      {errorMsg && (
        <div
          className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-2"
          data-testid="text-error-message"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Success */}
      {swapResult && swapResult.success && (
        <div
          className="mt-4 p-3 rounded-lg bg-primary/10 border border-primary/20 text-primary text-sm flex flex-col gap-1"
          data-testid="text-success-message"
        >
          <div className="font-medium">Swap Successful</div>
          <div className="text-xs opacity-80 break-all">
            <a
              href={swapResult.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline flex items-center gap-1"
              data-testid="link-explorer"
            >
              View on Explorer: {swapResult.transactionHash.slice(0, 10)}...
              {swapResult.transactionHash.slice(-8)}
            </a>
          </div>
        </div>
      )}

      {/* Action Button */}
      <div className="mt-4">
        {!isConnected ? (
          <Button
            className="w-full h-12 text-base font-semibold"
            size="lg"
            onClick={() => connect({ connector: injected() })}
          >
            <Wallet className="w-5 h-5 mr-2" />
            Connect Wallet to Swap
          </Button>
        ) : !estimate ? (
          <Button
            className="w-full h-12 text-base font-semibold"
            size="lg"
            onClick={handleGetQuote}
            disabled={isEstimating || !amountIn || isNaN(Number(amountIn)) || Number(amountIn) <= 0}
            data-testid="button-get-quote"
          >
            {isEstimating ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
            Get Quote
          </Button>
        ) : (
          <Button
            className={`w-full h-12 text-base font-semibold ${priceImpactNum >= 3 ? "bg-red-500 hover:bg-red-600 border-red-500" : ""}`}
            size="lg"
            onClick={handleExecuteSwap}
            disabled={isExecuting}
            data-testid="button-execute-swap"
          >
            {isExecuting ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
            {isExecuting
              ? "Confirm in Wallet..."
              : priceImpactNum >= 3
              ? "Swap Anyway (High Impact)"
              : "Confirm Swap"}
          </Button>
        )}
      </div>
    </div>
  );
}
