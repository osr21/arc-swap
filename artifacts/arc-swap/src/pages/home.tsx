import React, { useState } from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { SwapCard } from "@/components/swap/SwapCard";
import { SwapHistory } from "@/components/swap/SwapHistory";
import { SwapStats } from "@/components/swap/SwapStats";
import { WalletBalances } from "@/components/swap/WalletBalances";
import { LiquidityPanel } from "@/components/liquidity/LiquidityPanel";

type Tab = "swap" | "pool";

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("swap");

  return (
    <div
      className="min-h-[100dvh] flex flex-col relative overflow-hidden selection:bg-primary/30"
      style={{ background: "#0b1929" }}
    >
      {/* ── Arc.io-style background ── */}
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 20% 10%, #112040 0%, #0b1929 60%, #080f1c 100%)",
          }}
        />
        <svg
          className="absolute top-0 right-0 h-full"
          viewBox="0 0 600 900"
          preserveAspectRatio="xMaxYMin meet"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ width: "42vw", opacity: 0.35 }}
        >
          <circle cx="520" cy="300" r="240" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
          <circle cx="520" cy="300" r="340" stroke="rgba(255,255,255,0.10)" strokeWidth="1" />
          <circle cx="520" cy="300" r="440" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
          <circle cx="520" cy="300" r="540" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        </svg>
        <div
          className="absolute top-0 left-0 w-96 h-64 rounded-full"
          style={{
            background: "radial-gradient(ellipse, rgba(46,168,176,0.06) 0%, transparent 70%)",
            transform: "translate(-30%, -20%)",
          }}
        />
      </div>

      {/* ── App shell ── */}
      <Navbar />

      <main className="flex-1 container mx-auto px-4 py-8 relative z-10">
        <div className="mb-8">
          <SwapStats />
        </div>

        {/* Tab selector */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex rounded-xl bg-secondary/30 border border-border/40 p-1 gap-1">
            <button
              onClick={() => setActiveTab("swap")}
              className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === "swap"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="tab-swap"
            >
              Swap
            </button>
            <button
              onClick={() => setActiveTab("pool")}
              className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === "pool"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="tab-pool"
            >
              Pool
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4 order-2 lg:order-1 flex flex-col gap-6">
            <WalletBalances />
            <div className="hidden lg:block flex-1">
              <SwapHistory />
            </div>
          </div>

          <div className="lg:col-span-8 flex justify-center order-1 lg:order-2">
            <div className="w-full max-w-xl">
              {activeTab === "swap" ? <SwapCard /> : <LiquidityPanel />}
            </div>
          </div>

          <div className="lg:hidden col-span-1 order-3 mt-4">
            <div className="h-[400px]">
              <SwapHistory />
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
