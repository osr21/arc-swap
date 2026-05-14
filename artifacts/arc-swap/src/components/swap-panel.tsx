import React, { useState } from "react";
import { 
  useEstimateSwap, 
  useExecuteSwap, 
  getGetWalletBalancesQueryKey, 
  getGetSwapHistoryQueryKey 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDownUp, RefreshCw, Loader2, AlertCircle } from "lucide-react";
import { formatAmount } from "@/lib/format";

const TOKENS = ["USDC", "EURC", "cirBTC"] as const;
type Token = typeof TOKENS[number];

export function SwapPanel() {
  const [tokenIn, setTokenIn] = useState<Token>("USDC");
  const [tokenOut, setTokenOut] = useState<Token>("EURC");
  const [amountIn, setAmountIn] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const queryClient = useQueryClient();
  const estimateMutation = useEstimateSwap();
  const executeMutation = useExecuteSwap();

  const handleSwapDirection = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmountIn("");
    estimateMutation.reset();
    executeMutation.reset();
    setErrorMsg(null);
  };

  const handleGetQuote = () => {
    if (!amountIn || isNaN(Number(amountIn)) || Number(amountIn) <= 0) {
      setErrorMsg("Please enter a valid amount");
      return;
    }
    setErrorMsg(null);
    executeMutation.reset();
    
    estimateMutation.mutate({
      data: {
        tokenIn,
        tokenOut,
        amountIn
      }
    }, {
      onError: (err: any) => {
        setErrorMsg(err.error || err.message || "Failed to get quote");
      }
    });
  };

  const handleExecuteSwap = () => {
    setErrorMsg(null);
    executeMutation.mutate({
      data: {
        tokenIn,
        tokenOut,
        amountIn
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetWalletBalancesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSwapHistoryQueryKey() });
        setAmountIn("");
        estimateMutation.reset();
      },
      onError: (err: any) => {
        setErrorMsg(err.error || err.message || "Failed to execute swap");
      }
    });
  };

  const isEstimating = estimateMutation.isPending;
  const isExecuting = executeMutation.isPending;
  const estimate = estimateMutation.data;
  const result = executeMutation.data;

  return (
    <div className="bg-card border border-border rounded-2xl p-4 shadow-xl">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold tracking-tight">Swap</h2>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => { setAmountIn(""); estimateMutation.reset(); executeMutation.reset(); setErrorMsg(null); }}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-2">
        {/* Token In */}
        <div className="bg-background rounded-xl p-3 border border-border/50 transition-colors focus-within:border-primary/50">
          <div className="text-xs text-muted-foreground mb-1">Pay</div>
          <div className="flex gap-2">
            <Input 
              type="text" 
              placeholder="0.00" 
              value={amountIn}
              onChange={(e) => {
                setAmountIn(e.target.value);
                estimateMutation.reset();
                executeMutation.reset();
              }}
              className="border-0 bg-transparent text-2xl p-0 h-auto font-mono focus-visible:ring-0 shadow-none"
              data-testid="input-amount-in"
            />
            <Select value={tokenIn} onValueChange={(val) => { setTokenIn(val as Token); estimateMutation.reset(); }} data-testid="select-token-in">
              <SelectTrigger className="w-[110px] bg-secondary border-0 shadow-none font-medium h-9">
                <SelectValue placeholder="Token" />
              </SelectTrigger>
              <SelectContent>
                {TOKENS.map(t => (
                  <SelectItem key={t} value={t} disabled={t === tokenOut}>{t}</SelectItem>
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
            <div className="flex-1 text-2xl font-mono px-0 h-auto flex items-center text-muted-foreground truncate" data-testid="text-estimated-out">
              {isEstimating ? (
                <Loader2 className="h-5 w-5 animate-spin opacity-50" />
              ) : estimate ? (
                <span className="text-foreground">{formatAmount(estimate.estimatedAmountOut, 6)}</span>
              ) : (
                "0.00"
              )}
            </div>
            <Select value={tokenOut} onValueChange={(val) => { setTokenOut(val as Token); estimateMutation.reset(); }} data-testid="select-token-out">
              <SelectTrigger className="w-[110px] bg-secondary border-0 shadow-none font-medium h-9">
                <SelectValue placeholder="Token" />
              </SelectTrigger>
              <SelectContent>
                {TOKENS.map(t => (
                  <SelectItem key={t} value={t} disabled={t === tokenIn}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Details */}
      {estimate && (
        <div className="mt-4 p-3 rounded-lg bg-secondary/50 border border-border text-xs space-y-2 font-mono">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Rate</span>
            <span>1 {tokenIn} = {formatAmount(estimate.exchangeRate, 6)} {tokenOut}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Fee</span>
            <span>{estimate.fee} {tokenIn}</span>
          </div>
        </div>
      )}

      {/* Error */}
      {errorMsg && (
        <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-2" data-testid="text-error-message">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Success */}
      {result && result.success && (
        <div className="mt-4 p-3 rounded-lg bg-primary/10 border border-primary/20 text-primary text-sm flex flex-col gap-1" data-testid="text-success-message">
          <div className="font-medium">Swap Successful</div>
          <div className="text-xs opacity-80 break-all">
            <a href={result.explorerUrl} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-1" data-testid="link-explorer">
              View on Explorer: {result.transactionHash.slice(0, 10)}...{result.transactionHash.slice(-8)}
            </a>
          </div>
        </div>
      )}

      {/* Action Button */}
      <div className="mt-4">
        {!estimate ? (
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
            className="w-full h-12 text-base font-semibold" 
            size="lg" 
            onClick={handleExecuteSwap}
            disabled={isExecuting}
            data-testid="button-execute-swap"
          >
            {isExecuting ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
            {isExecuting ? "Swapping..." : "Confirm Swap"}
          </Button>
        )}
      </div>
    </div>
  );
}
