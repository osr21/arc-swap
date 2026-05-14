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
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
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
  {
    symbol: "cirBTC",
    address: "0x0000000000000000000000000000000000000000" as `0x${string}`,
    decimals: 8,
    native: false,
    skip: true,
  },
];

function deriveAddress(privateKey: string): string {
  try {
    const { privateKeyToAccount } = require("viem/accounts");
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    return account.address;
  } catch {
    return "0x0000000000000000000000000000000000000000";
  }
}

router.get("/wallet/balances", async (req, res) => {
  let address: string;

  const queryAddress = req.query.address as string | undefined;

  if (queryAddress && /^0x[0-9a-fA-F]{40}$/.test(queryAddress)) {
    address = queryAddress;
  } else {
    const privateKey = process.env.WALLET_PRIVATE_KEY;
    if (!privateKey) {
      res.status(500).json({ error: "WALLET_PRIVATE_KEY not configured" });
      return;
    }
    try {
      const { privateKeyToAccount } = await import("viem/accounts");
      const normalizedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
      const account = privateKeyToAccount(normalizedKey as `0x${string}`);
      address = account.address;
    } catch {
      res.status(500).json({ error: "Invalid WALLET_PRIVATE_KEY" });
      return;
    }
  }

  try {

    const client = createPublicClient({
      chain: arcTestnet,
      transport: http("https://rpc.testnet.arc.network"),
    });

    const balances = await Promise.all(
      TOKENS.filter((t) => !t.skip).map(async (token) => {
        try {
          const raw = await client.readContract({
            address: token.address,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [address],
          });
          const balance = formatUnits(raw as bigint, token.decimals);
          return { token: token.symbol, symbol: token.symbol, balance };
        } catch {
          return { token: token.symbol, symbol: token.symbol, balance: "0.00" };
        }
      })
    );

    balances.push({ token: "cirBTC", symbol: "cirBTC", balance: "0.00" });

    res.json({
      address,
      balances,
      network: "Arc Testnet",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Get wallet balances failed");
    res.status(500).json({ error: "Failed to fetch balances", details: msg });
  }
});

export default router;
