import React from "react";
import { useGetSwapHistory } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAmount, formatDate } from "@/lib/format";
import { ExternalLink } from "lucide-react";

export function SwapHistory() {
  const { data: historyData, isLoading } = useGetSwapHistory();

  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-xl overflow-hidden flex flex-col">
      <h3 className="text-lg font-semibold tracking-tight mb-4">Recent Swaps</h3>
      
      <div className="overflow-auto max-h-[300px]">
        <Table>
          <TableHeader className="bg-background/50 sticky top-0 z-10">
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead className="font-mono text-xs text-muted-foreground w-[130px]">Time</TableHead>
              <TableHead className="font-mono text-xs text-muted-foreground">From</TableHead>
              <TableHead className="font-mono text-xs text-muted-foreground">To</TableHead>
              <TableHead className="font-mono text-xs text-muted-foreground text-right">In</TableHead>
              <TableHead className="font-mono text-xs text-muted-foreground text-right">Out</TableHead>
              <TableHead className="font-mono text-xs text-muted-foreground text-right">Tx</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i} className="border-border/50">
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : historyData && historyData.swaps.length > 0 ? (
              historyData.swaps.map((swap, index) => (
                <TableRow key={index} className="border-border/50 hover:bg-secondary/40 transition-colors" data-testid={`row-swap-${index}`}>
                  <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                    {formatDate(swap.timestamp)}
                  </TableCell>
                  <TableCell className="font-medium text-sm">
                    {swap.tokenIn}
                  </TableCell>
                  <TableCell className="font-medium text-sm">
                    {swap.tokenOut}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-right">
                    {formatAmount(swap.amountIn, 4)}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-right text-primary">
                    +{formatAmount(swap.amountOut, 4)}
                  </TableCell>
                  <TableCell className="text-right">
                    <a 
                      href={swap.explorerUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-primary transition-colors"
                      data-testid={`link-tx-${index}`}
                    >
                      {swap.transactionHash.slice(0, 6)}..
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">
                  No recent swaps found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
