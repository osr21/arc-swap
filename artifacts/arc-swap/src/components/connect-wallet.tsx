import React from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { Button } from "@/components/ui/button";
import { Wallet, LogOut, ChevronDown, Plus, AlertTriangle, Radio } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { shortenAddress } from "@/lib/format";
import { arcTestnet } from "@/lib/arc-chain";
import { walletConnectEnabled } from "@/lib/wagmi-config";

const ARC_TESTNET_PARAMS = {
  chainId: `0x${(5042002).toString(16)}`,
  chainName: "Arc Testnet",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.testnet.arc.network"],
  blockExplorerUrls: ["https://testnet.arcscan.app"],
};

async function addArcTestnetToMetaMask() {
  const provider = (
    window as Window & {
      ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
    }
  ).ethereum;
  if (!provider) return;
  try {
    await provider.request({ method: "wallet_addEthereumChain", params: [ARC_TESTNET_PARAMS] });
  } catch (e) {
    console.error("Failed to add Arc Testnet:", e);
  }
}

const wcProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined;

export function ConnectWallet() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const isWrongNetwork = isConnected && chainId !== arcTestnet.id;

  if (isConnected && address) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={
              isWrongNetwork
                ? "gap-2 font-mono border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20"
                : "gap-2 font-mono border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary"
            }
          >
            {isWrongNetwork ? (
              <AlertTriangle className="h-3.5 w-3.5" />
            ) : (
              <Wallet className="h-3.5 w-3.5" />
            )}
            {isWrongNetwork ? "Wrong Network" : shortenAddress(address)}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {isWrongNetwork && (
            <>
              <DropdownMenuItem
                onClick={() => switchChain({ chainId: arcTestnet.id })}
                className="gap-2 text-sm"
              >
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                Switch to Arc Testnet
              </DropdownMenuItem>
              <DropdownMenuItem onClick={addArcTestnetToMetaMask} className="gap-2 text-sm">
                <Plus className="h-3.5 w-3.5" />
                Add Arc Testnet
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            onClick={() => disconnect()}
            className="text-destructive focus:text-destructive gap-2"
          >
            <LogOut className="h-3.5 w-3.5" />
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        className="gap-2 border-primary/30 hover:border-primary/60 hover:bg-primary/10"
        onClick={() => connect({ connector: injected() })}
        disabled={isPending}
        data-testid="button-connect-wallet"
      >
        <Wallet className="h-3.5 w-3.5" />
        {isPending ? "Connecting..." : "MetaMask"}
      </Button>
      {walletConnectEnabled && wcProjectId && (
        <Button
          size="sm"
          variant="outline"
          className="gap-2 border-primary/30 hover:border-primary/60 hover:bg-primary/10"
          onClick={() =>
            connect({
              connector: walletConnect({
                projectId: wcProjectId,
                showQrModal: true,
                metadata: {
                  name: "Arc Swap",
                  description: "Token swap on Arc Network",
                  url: window.location.origin,
                  icons: [],
                },
              }),
            })
          }
          disabled={isPending}
          data-testid="button-connect-walletconnect"
        >
          <Radio className="h-3.5 w-3.5" />
          WalletConnect
        </Button>
      )}
    </div>
  );
}
