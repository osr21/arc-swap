import { Router } from "express";
import { createPublicClient, http, formatUnits } from "viem";

const router = Router();

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
  },
} as const;

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const TOKENS = [
  {
    symbol: "USDC",
    address: "0x3600000000000000000000000000000000000000" as `0x${string}`,
    decimals: 6,
  },
  {
    symbol: "EURC",
    address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}`,
    decimals: 6,
  },
];

const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

router.get("/wallet/balances", async (req, res) => {
  const queryAddress = req.query.address as string | undefined;

  if (!queryAddress) {
    res.status(400).json({ error: "address query parameter is required" });
    return;
  }

  if (!ADDRESS_REGEX.test(queryAddress)) {
    res.status(400).json({ error: "Invalid wallet address format" });
    return;
  }

  const address = queryAddress;

  try {
    const client = createPublicClient({
      chain: arcTestnet,
      transport: http("https://rpc.testnet.arc.network"),
    });

    const balances = await Promise.all(
      TOKENS.map(async (token) => {
        try {
          const raw = await client.readContract({
            address: token.address,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [address as `0x${string}`],
          });
          const balance = formatUnits(raw as bigint, token.decimals);
          return { token: token.symbol, symbol: token.symbol, balance };
        } catch {
          return { token: token.symbol, symbol: token.symbol, balance: "0.00" };
        }
      })
    );

    balances.push({ token: "cirBTC", symbol: "cirBTC", balance: "0.00" });

    res.json({ address, balances, network: "Arc Testnet" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Get wallet balances failed");
    res.status(500).json({ error: "Failed to fetch balances", details: msg });
  }
});

export default router;
