import React from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { Button } from "@/components/ui/button";
import { Wallet, LogOut, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { shortenAddress } from "@/lib/format";

export function ConnectWallet() {
  const { address, isConnected } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 font-mono border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary"
          >
            <Wallet className="h-3.5 w-3.5" />
            {shortenAddress(address)}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
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
    <Button
      size="sm"
      variant="outline"
      className="gap-2 border-primary/30 hover:border-primary/60 hover:bg-primary/10"
      onClick={() => connect({ connector: injected() })}
      disabled={isPending}
      data-testid="button-connect-wallet"
    >
      <Wallet className="h-3.5 w-3.5" />
      {isPending ? "Connecting..." : "Connect Wallet"}
    </Button>
  );
}
