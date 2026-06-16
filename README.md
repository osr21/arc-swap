# Arc Swap

A token swap DApp built on **Arc Testnet** (EVM-compatible, Chain ID 5042002). Connect MetaMask, get live quotes, and swap USDC, EURC, and cirBTC at real market rates.

🔗 **Live App:** https://arc-swap-dapp.replit.app  
📁 **GitHub:** https://github.com/osr21/arc-swap

---

## Features

- **Live exchange rates** — USDC/EURC via ECB forex (Frankfurter API), cirBTC via CoinGecko
- **Real-time quotes** — get a quote before committing to a swap
- **Slippage control** — configurable tolerance (0.1% / 0.5% / 1.0% or custom)
- **Balance indicator** — shows your token balance inline with a MAX button
- **Swap history** — all swaps recorded on-chain and displayed in the UI
- **Stats dashboard** — total swaps, total volume, top trading pair
- **Wallet balances** — live view of your USDC, EURC, cirBTC holdings
- **Auto refund** — if a swap send fails, tokens are automatically returned to you

---

## Tokens

| Token | Address | Decimals | Notes |
|-------|---------|----------|-------|
| USDC | `0x3600000000000000000000000000000000000000` | 6 | Circle USD Coin on Arc |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | 6 | Circle EUR Coin on Arc |
| cirBTC | — | 8 | Simulated on testnet |

---

## How Swaps Work

Arc Swap uses a **backend-facilitated peer-to-peer model**:

1. User approves token allowance to the backend wallet
2. Backend pulls `amountIn` from user via `transferFrom`
3. Backend calculates `amountOut` at live market rate
4. Backend sends `amountOut` of the output token directly to the user
5. A 0.3% platform fee is retained by the backend wallet

> Circle Kit's on-chain swap router is not deployed on Arc Testnet, so swaps are settled directly through the backend wallet which holds liquidity in both USDC and EURC.

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
# WALLET_PRIVATE_KEY=0x...   (backend wallet private key)
# SESSION_SECRET=...          (random secret for sessions)

# Push database schema
pnpm --filter @workspace/db run push

# Start API server
pnpm --filter @workspace/api-server run dev

# Start frontend (separate terminal)
pnpm --filter @workspace/arc-swap run dev
```

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

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/healthz` | Health check |
| `GET` | `/api/config/wallet` | Backend wallet public address |
| `GET` | `/api/wallet/balances` | User token balances |
| `POST` | `/api/swap/estimate` | Get a quote |
| `POST` | `/api/swap/execute` | Execute a swap |
| `GET` | `/api/swap/history` | Recent swap history |
| `GET` | `/api/swap/stats` | Aggregate stats |

---

## Security

- Private key stored as a server-side environment variable only — never in code, never in API responses, never in the frontend bundle
- CORS restricted to configured origins in production (`ALLOWED_ORIGINS` env var)
- Rate limiting on all endpoints
- Input validation via Zod schemas
- Request body size capped at 16 KB
- Automatic refund if output token transfer fails

---

## License

MIT
