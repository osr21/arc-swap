/**
 * Uniswap V2 deployment script for Arc Testnet.
 * Deploys: WETH9, UniswapV2Factory, UniswapV2Router02
 * Creates: USDC/EURC pair
 * Seeds:   Initial liquidity from the backend wallet
 *
 * Run: pnpm --filter @workspace/scripts run deploy:uniswap
 * Requires: WALLET_PRIVATE_KEY env var
 */
import { createWalletClient, createPublicClient, http, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const FactoryArtifact = require("@uniswap/v2-core/build/UniswapV2Factory.json") as {
  abi: unknown[];
  bytecode: string;
};
const RouterArtifact = require("@uniswap/v2-periphery/build/UniswapV2Router02.json") as {
  abi: unknown[];
  bytecode: string;
};
const WETHArtifact = require("@uniswap/v2-periphery/build/WETH9.json") as {
  abi: unknown[];
  bytecode: string;
};
const PairArtifact = require("@uniswap/v2-core/build/UniswapV2Pair.json") as {
  abi: unknown[];
  bytecode: string;
};

const ARC_TESTNET = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
} as const;

const USDC = {
  address: "0x3600000000000000000000000000000000000000" as `0x${string}`,
  decimals: 6,
  symbol: "USDC",
};
const EURC = {
  address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}`,
  decimals: 6,
  symbol: "EURC",
};

// Initial liquidity seed amounts — sized to available testnet wallet balance
// USDC: ~44 available → seed 22; EURC: ~24 available → seed 20 (~0.91 EUR/USD rate)
const SEED_USDC = parseUnits("22", 6);
const SEED_EURC = parseUnits("20", 6);

const ERC20_APPROVE_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const FACTORY_ABI = [
  {
    name: "createPair",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
    ],
    outputs: [{ name: "pair", type: "address" }],
  },
  {
    name: "getPair",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
    ],
    outputs: [{ name: "pair", type: "address" }],
  },
] as const;

const ROUTER_ADD_LIQUIDITY_ABI = [
  {
    name: "addLiquidity",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "amountADesired", type: "uint256" },
      { name: "amountBDesired", type: "uint256" },
      { name: "amountAMin", type: "uint256" },
      { name: "amountBMin", type: "uint256" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [
      { name: "amountA", type: "uint256" },
      { name: "amountB", type: "uint256" },
      { name: "liquidity", type: "uint256" },
    ],
  },
] as const;

function getKey(): `0x${string}` {
  const raw = process.env.WALLET_PRIVATE_KEY;
  if (!raw) throw new Error("WALLET_PRIVATE_KEY not set");
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
}

async function deploy(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  label: string,
  abi: unknown[],
  bytecode: string,
  args: unknown[] = [],
): Promise<`0x${string}`> {
  console.log(`\nDeploying ${label}...`);
  const account = privateKeyToAccount(getKey());
  const hash = await walletClient.deployContract({
    abi,
    bytecode: bytecode as `0x${string}`,
    args,
    account,
    gas: 5_000_000n,
    chain: ARC_TESTNET,
  });
  console.log(`  tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const address = receipt.contractAddress;
  if (!address) throw new Error(`${label} deployment failed — no contract address in receipt`);
  console.log(`  ✓ ${label} deployed at ${address}`);
  return address;
}

async function writeWithGas(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  label: string,
  params: Parameters<typeof walletClient.writeContract>[0],
  gas = 500_000n,
): Promise<`0x${string}`> {
  console.log(`\n${label}...`);
  const hash = await walletClient.writeContract({
    ...params,
    gas, // explicit override — eth_estimateGas unreliable on Arc Testnet
  } as Parameters<typeof walletClient.writeContract>[0]);
  console.log(`  tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") {
    throw new Error(`Transaction reverted (tx: ${hash}, gasUsed: ${receipt.gasUsed})`);
  }
  console.log(`  ✓ done (gasUsed: ${receipt.gasUsed})`);
  return hash;
}

async function main() {
  const key = getKey();
  const account = privateKeyToAccount(key);
  console.log(`Deployer: ${account.address}`);
  console.log(`Network:  Arc Testnet (Chain ID 5042002)`);

  const transport = http("https://rpc.testnet.arc.network");
  const walletClient = createWalletClient({ chain: ARC_TESTNET, transport, account });
  const publicClient = createPublicClient({ chain: ARC_TESTNET, transport });

  // --- Check balances ---
  const [usdcBal, eurcBal] = await Promise.all([
    publicClient.readContract({ address: USDC.address, abi: ERC20_APPROVE_ABI, functionName: "balanceOf", args: [account.address] }) as Promise<bigint>,
    publicClient.readContract({ address: EURC.address, abi: ERC20_APPROVE_ABI, functionName: "balanceOf", args: [account.address] }) as Promise<bigint>,
  ]);
  console.log(`\nWallet balances:`);
  console.log(`  USDC: ${formatUnits(usdcBal, 6)}`);
  console.log(`  EURC: ${formatUnits(eurcBal, 6)}`);
  if (usdcBal < SEED_USDC) throw new Error(`Insufficient USDC — need ${formatUnits(SEED_USDC, 6)}, have ${formatUnits(usdcBal, 6)}`);
  if (eurcBal < SEED_EURC) throw new Error(`Insufficient EURC — need ${formatUnits(SEED_EURC, 6)}, have ${formatUnits(eurcBal, 6)}`);

  // --- 1. Deploy WETH9 (skip if already set via env) ---
  const existingWeth = process.env.UNISWAP_V2_WETH_ADDRESS;
  const wethAddress = existingWeth && existingWeth !== ""
    ? (existingWeth as `0x${string}`)
    : await deploy(walletClient, publicClient, "WETH9", WETHArtifact.abi, WETHArtifact.bytecode);
  if (existingWeth) console.log(`\nReusing WETH9 at ${wethAddress}`);

  // --- 2. Deploy Factory (skip if already set via env) ---
  const existingFactory = process.env.UNISWAP_V2_FACTORY_ADDRESS;
  const factoryAddress = existingFactory && existingFactory !== ""
    ? (existingFactory as `0x${string}`)
    : await deploy(walletClient, publicClient, "UniswapV2Factory", FactoryArtifact.abi, FactoryArtifact.bytecode, [account.address]);
  if (existingFactory) console.log(`\nReusing UniswapV2Factory at ${factoryAddress}`);

  // --- 3. Deploy Router02 (skip if already set via env) ---
  const existingRouter = process.env.UNISWAP_V2_ROUTER_ADDRESS;
  const routerAddress = existingRouter && existingRouter !== ""
    ? (existingRouter as `0x${string}`)
    : await deploy(walletClient, publicClient, "UniswapV2Router02", RouterArtifact.abi, RouterArtifact.bytecode, [factoryAddress, wethAddress]);
  if (existingRouter) console.log(`\nReusing UniswapV2Router02 at ${routerAddress}`);

  // --- 4. Create USDC/EURC pair (skip if already exists) ---
  let pairAddress = await publicClient.readContract({
    address: factoryAddress,
    abi: FACTORY_ABI,
    functionName: "getPair",
    args: [USDC.address, EURC.address],
  }) as `0x${string}`;

  const ZERO = "0x0000000000000000000000000000000000000000";
  if (pairAddress === ZERO) {
    // createPair deploys a contract via CREATE2 inside — needs ~3-5M gas
    await writeWithGas(walletClient, publicClient, "Creating USDC/EURC pair (CREATE2 deploy — needs high gas)", {
      address: factoryAddress,
      abi: FACTORY_ABI,
      functionName: "createPair",
      args: [USDC.address, EURC.address],
      account,
      chain: ARC_TESTNET,
    }, 5_000_000n);

    pairAddress = await publicClient.readContract({
      address: factoryAddress,
      abi: FACTORY_ABI,
      functionName: "getPair",
      args: [USDC.address, EURC.address],
    }) as `0x${string}`;
    if (pairAddress === ZERO) throw new Error("createPair succeeded but getPair still returns zero — investigate Arc Testnet EVM compatibility");
  } else {
    console.log(`\nPair already exists at ${pairAddress}`);
  }
  console.log(`\n✓ Pair address: ${pairAddress}`);

  // --- 5. Approve Router to spend USDC + EURC ---
  const MAX = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
  await writeWithGas(walletClient, publicClient, "Approving Router for USDC", {
    address: USDC.address,
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [routerAddress, MAX],
    account,
    chain: ARC_TESTNET,
  });
  await writeWithGas(walletClient, publicClient, "Approving Router for EURC", {
    address: EURC.address,
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [routerAddress, MAX],
    account,
    chain: ARC_TESTNET,
  });

  // --- 6. Add initial liquidity (first-time initializes pair reserves) ---
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  await writeWithGas(walletClient, publicClient, `Seeding liquidity (${formatUnits(SEED_USDC, 6)} USDC + ${formatUnits(SEED_EURC, 6)} EURC)`, {
    address: routerAddress,
    abi: ROUTER_ADD_LIQUIDITY_ABI,
    functionName: "addLiquidity",
    args: [USDC.address, EURC.address, SEED_USDC, SEED_EURC, 0n, 0n, account.address, deadline],
    account,
    chain: ARC_TESTNET,
  }, 3_000_000n);

  // --- Summary ---
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║              UNISWAP V2 DEPLOYMENT COMPLETE                      ║
╠══════════════════════════════════════════════════════════════════╣
║ Set these as Replit secrets:                                     ║
╠══════════════════════════════════════════════════════════════════╣`);
  console.log(`║ UNISWAP_V2_FACTORY_ADDRESS = ${factoryAddress}`);
  console.log(`║ UNISWAP_V2_ROUTER_ADDRESS  = ${routerAddress}`);
  console.log(`║ UNISWAP_V2_WETH_ADDRESS    = ${wethAddress}`);
  console.log(`║ UNISWAP_V2_PAIR_USDC_EURC  = ${pairAddress}`);
  console.log(`╚══════════════════════════════════════════════════════════════════╝`);
}

main().catch((err) => {
  console.error("\n❌ Deployment failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
