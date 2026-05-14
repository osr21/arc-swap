import { createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { arcTestnet } from "./arc-chain";

const wcProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined;

export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors: [
    injected(),
    ...(wcProjectId
      ? [walletConnect({
          projectId: wcProjectId,
          showQrModal: true,
          metadata: { name: "Arc Swap", description: "Token swap on Arc Network", url: window.location.origin, icons: [] },
        })]
      : []
    ),
  ],
  transports: {
    [arcTestnet.id]: http("https://rpc.testnet.arc.network"),
  },
});

export const walletConnectEnabled = Boolean(wcProjectId);
