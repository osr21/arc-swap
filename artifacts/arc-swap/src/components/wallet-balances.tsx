import React from "react";
import { useAccount } from "wagmi";
import { useGetWalletBalances } from "@workspace/api-client-react";
import { shortenAddress, formatAmount } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Wallet, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function WalletBalances() {
  const { address: connectedAddress } = useAccount();
  const { data: walletData, isLoading, isError } = useGetWalletBalances(
    connectedAddress ? { address: connectedAddress } : {}
  );

  const displayAddress = connectedAddress || walletData?.address;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30">
            <Wallet className="w-4 h-4 text-primary" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
              {connectedAddress ? "Connected Wallet" : "Wallet"}
            </div>
            {isLoading ? (
              <Skeleton className="h-5 w-24 mt-1" />
            ) : displayAddress ? (
              <div className="font-mono text-sm" data-testid="text-wallet-address">{shortenAddress(displayAddress)}</div>
            ) : (
              <div className="text-sm text-muted-foreground">Not Connected</div>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {isLoading ? (
            <Skeleton className="h-6 w-20" />
          ) : walletData ? (
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 flex gap-1.5 items-center font-mono" data-testid="badge-network">
              <Activity className="w-3 h-3" />
              {walletData.network}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {isLoading ? (
          <>
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </>
        ) : walletData ? (
          walletData.balances.map((token) => (
            <div key={token.token} className="bg-card border border-border p-3 rounded-xl flex flex-col justify-between" data-testid={`card-balance-${token.token}`}>
              <div className="text-xs text-muted-foreground">{token.symbol}</div>
              <div className="text-lg font-mono font-medium tracking-tight mt-1" data-testid={`text-balance-amount-${token.token}`}>
                {formatAmount(token.balance)}
              </div>
            </div>
          ))
        ) : isError ? (
          <div className="col-span-3 text-sm text-muted-foreground text-center py-4">
            Failed to load balances
          </div>
        ) : (
          <div className="col-span-3 text-sm text-muted-foreground text-center py-4 col-span-3">
            Connect your wallet to view balances
          </div>
        )}
      </div>
    </div>
  );
}
