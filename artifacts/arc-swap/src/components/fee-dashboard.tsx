import React from "react";
import { useAccount } from "wagmi";
import { useGetFeeEarnings, getGetFeeEarningsQueryKey } from "@workspace/api-client-react";
import { TrendingUp, RefreshCw, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatAmount, formatDate } from "@/lib/format";

export function FeeDashboard() {
  const { isConnected } = useAccount();
  const { data, isLoading, isError, refetch, isFetching } = useGetFeeEarnings(
    { query: { queryKey: getGetFeeEarningsQueryKey(), refetchInterval: 30_000, enabled: isConnected } }
  );

  if (!isConnected) {
    return null;
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-4 shadow-lg">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold tracking-tight">Fee Earnings</h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}

      {isError && (
        <div className="py-4 text-center text-xs text-muted-foreground">
          Failed to load fee data
        </div>
      )}

      {data && (
        <>
          {data.totals.length === 0 ? (
            <div className="text-center py-4 text-xs text-muted-foreground">
              No fees collected yet
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 mb-4">
              {data.totals.map((t) => (
                <div
                  key={t.token}
                  className="bg-primary/5 border border-primary/20 rounded-xl p-3 text-center"
                >
                  <div className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">
                    {t.token}
                  </div>
                  <div className="text-lg font-bold font-mono text-primary">
                    {formatAmount(t.totalFee, 6)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t.eventCount} swap{t.eventCount !== 1 ? "s" : ""}
                  </div>
                </div>
              ))}
            </div>
          )}

          {data.recent.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                Recent
              </div>
              <div className="space-y-1.5">
                {data.recent.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center justify-between text-xs font-mono py-1.5 border-b border-border/30 last:border-0"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-foreground font-medium">
                        +{formatAmount(event.feeAmount, 6)} {event.token}
                      </span>
                      <span className="text-muted-foreground">
                        {formatDate(event.createdAt)}
                      </span>
                    </div>
                    <a
                      href={`https://testnet.arcscan.app/tx/${event.transactionHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-primary transition-colors"
                      title="View on explorer"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
