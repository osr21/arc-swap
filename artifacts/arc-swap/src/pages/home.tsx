import React from "react";
import { WalletBalances } from "@/components/wallet-balances";
import { SwapPanel } from "@/components/swap-panel";
import { SwapHistory } from "@/components/swap-history";

export function Home() {
  return (
    <div className="flex-1 w-full max-w-4xl mx-auto p-4 md:p-8 flex flex-col gap-8">
      {/* Header / Brand */}
      <header className="flex items-center justify-between border-b border-border pb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 border border-primary/30 rounded-xl flex items-center justify-center shrink-0">
            <div className="w-4 h-4 bg-primary rotate-45 transform" />
          </div>
          <div>
            <h1 className="font-bold text-xl tracking-tight text-foreground leading-tight">Arc Network</h1>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Terminal</div>
          </div>
        </div>
      </header>

      {/* Main Content Grid */}
      <main className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Wallet & History */}
        <div className="lg:col-span-7 flex flex-col gap-8 order-2 lg:order-1">
          <WalletBalances />
          <SwapHistory />
        </div>

        {/* Right Column: Swap Interface */}
        <div className="lg:col-span-5 order-1 lg:order-2">
          <SwapPanel />
        </div>
      </main>
      
      <footer className="mt-auto pt-8 border-t border-border/50 text-center flex justify-between items-center text-xs text-muted-foreground font-mono">
        <div>Arc Network Testnet</div>
        <div>Status: Operational</div>
      </footer>
    </div>
  );
}
