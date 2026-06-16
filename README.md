# Arc Swap

A token swap DApp built on **Arc Testnet** (EVM-compatible, Chain ID 5042002). Connect MetaMask, swap USDC ↔ EURC through a live Uniswap V2 AMM, and provide liquidity to earn fees.

🔗 **Live App:** https://arc-swap-dapp.replit.app  
📁 **GitHub:** https://github.com/osr21/arc-swap

---

## Features

- **Uniswap V2 AMM** — USDC/EURC swaps execute on-chain through a deployed Router contract
- **Live pool prices** — quotes pulled from on-chain reserves using the constant-product formula (x·y = k)
- **Real price impact** — shows exact AMM price impact before confirming a swap
- **Slippage control** — configurable tolerance (0.1% / 0.5% / 1.0% or custom)
- **Liquidity pool** — Add and remove USDC/EURC liquidity, view your LP share and position
- **Pool stats** — live TVL, reserve ratio, and LP token supply from chain
- **Balance indicator** — shows your token balance inline with a MAX button
- **Swap history** — all swaps recorded and displayed in the UI
- **Stats dashboard** — total swaps, total volume, top trading pair
- **Wallet balances** — live view of your USDC and EURC holdings

---

## Tokens

| Token | Address | Decimals | Notes |
|-------|---------|----------|-------|
| USDC  | `0x3600000000000000000000000000000000000000` | 6 | Circle USD Coin on Arc |
| EURC  | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | 6 | Circle EUR Coin on Arc |

---

## Uniswap V2 Contracts (Arc Testnet)

All contracts were deployed from the canonical Uniswap V2 bytecode, with no modifications.

| Contract | Address |
|----------|---------|
| UniswapV2Factory | `0x7483847d46db2920dd64efa676cf72dcf765814f` |
| UniswapV2Router02 | `0xe27d5d256b370604f1ff060fb489c6a8e3f8a6d9` |
| WETH9 | `0x6be2c68117ca58086bd6a14e525835584d7f721e` |
| USDC/EURC Pair | `0xb3685D16AAa06361ED28377b1319136650Fa9A13` |

View on explorer: [testnet.arcscan.app](https://testnet.arcscan.app)

---

## How Swaps Work

Arc Swap uses **Uniswap V2 AMM** for USDC ↔ EURC:

1. User approves the Router contract to spend their input token
2. User calls `swapExactTokensForTokens` directly on the Router from their own wallet (MetaMask)
3. The Router swaps through the USDC/EURC pair contract using the x·y = k formula
4. Output tokens arrive in the user's wallet in the same transaction
5. The backend records the completed swap for history and stats

The **0.3% Uniswap fee** stays in the liquidity pool and accrues to LP token holders.

> **Why not Circle Kit's swap router?** Circle Kit's on-chain Uniswap integration is only deployed on mainnet/supported chains, not Arc Testnet. We deployed the Uniswap V2 contracts directly to Arc Testnet instead.

---

## How Liquidity Works

1. User approves both USDC and EURC to the Router
2. User calls `addLiquidity` on the Router — tokens are deposited into the pair contract
3. LP tokens are minted proportional to the share of the pool
4. To withdraw, user calls `removeLiquidity` — LP tokens are burned and tokens returned
5. Earned fees (0.3% of every swap) are reflected in the reserve balances

---

## Arc Testnet EVM Notes

Arc Testnet has two known quirks relevant to contract interaction:

1. **`eth_estimateGas` is broken** — gas estimation returns incorrect values. All contract calls use explicit gas overrides:
   - Approve / simple calls: 100,000
   - Swap: 250,000
   - First `addLiquidity`: 3,000,000
   - `createPair` (deploys a contract internally via CREATE2): 5,000,000

2. **Receipts don't throw on revert** — `waitForTransactionReceipt` does not throw when a transaction reverts. Status must be checked explicitly: `if (receipt.status === "reverted") throw new Error(...)`.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Tailwind CSS, shadcn/ui |
| Wallet | wagmi v2, viem v2 |
| Backend | Express 5, Node.js 24, TypeScript 5.9 |
| Database | PostgreSQL + Drizzle ORM |
| API spec | OpenAPI 3.0 + Orval codegen |
| Monorepo | pnpm workspaces |

---

## Project Structure

```
artifacts/
  api-server/     # Express API (port 8080, proxied at /api)
  arc-swap/       # React/Vite frontend (proxied at /)
lib/
  api-spec/       # OpenAPI spec + Orval codegen config
  api-client-react/ # Generated React Query hooks
  api-zod/        # Generated Zod validation schemas
  db/             # Drizzle ORM schema + client
scripts/
  deploy-uniswap.ts  # Uniswap V2 deployment script
```

---

## Running Locally

### Prerequisites
- Node.js 24+
- pnpm 9+
- PostgreSQL database
- MetaMask with Arc Testnet configured

### Arc Testnet MetaMask Config

| Field | Value |
|-------|-------|
| Network Name | Arc Testnet |
| RPC URL | `https://rpc.testnet.arc.network` |
| Chain ID | `5042002` |
| Currency Symbol | USDC |
| Block Explorer | `https://testnet.arcscan.app` |

### Setup

```bash
# Install dependencies
pnpm install

# Set environment variables
# DATABASE_URL=postgres://...
# WALLET_PRIVATE_KEY=0x...              (backend wallet private key)
# SESSION_SECRET=...                    (random secret for sessions)
# UNISWAP_V2_FACTORY_ADDRESS=0x...      (from table above)
# UNISWAP_V2_ROUTER_ADDRESS=0x...       (from table above)
# UNISWAP_V2_WETH_ADDRESS=0x...         (from table above)
# UNISWAP_V2_PAIR_USDC_EURC=0x...       (from table above)

# Push database schema
pnpm --filter @workspace/db run push

# Start API server
pnpm --filter @workspace/api-server run dev

# Start frontend (separate terminal)
pnpm --filter @workspace/arc-swap run dev
```

### Re-deploying Uniswap Contracts

If you need to redeploy to a different testnet:

```bash
pnpm --filter @workspace/scripts run deploy-uniswap
```

The script skips already-deployed contracts if their addresses are set in env vars.

### Useful Commands

```bash
# Full typecheck
pnpm run typecheck

# Regenerate API client from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen

# Build all packages
pnpm run build
```

---

## API Endpoints

### Swap

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/config/wallet` | Contract addresses + network info |
| `POST` | `/api/swap/estimate` | Get AMM quote with price impact |
| `POST` | `/api/swap/record` | Record a completed on-chain swap |
| `GET`  | `/api/swap/history` | Recent swap history |
| `GET`  | `/api/swap/stats` | Aggregate stats |

### Pool

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/pool/info` | Live reserves, price, TVL, LP supply |
| `GET`  | `/api/pool/lp-balance` | LP token balance for a wallet |
| `POST` | `/api/pool/add` | Record a completed addLiquidity event |
| `POST` | `/api/pool/remove` | Record a completed removeLiquidity event |
| `GET`  | `/api/pool/positions` | LP position history for a wallet |

---

## Security

- Private key stored as a server-side environment variable only — never in code, never in API responses, never in the frontend bundle
- CORS restricted to configured origins in production (`ALLOWED_ORIGINS` env var)
- Rate limiting on all endpoints
- Input validation via Zod schemas
- Request body size capped at 16 KB

---

## License

MIT
