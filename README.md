# Arc Swap

  A full-stack token swap and cross-asset payment DApp on **Arc Testnet** (EVM-compatible, Chain ID 5042002). Connect MetaMask, swap USDC ↔ EURC through a live Uniswap V2 AMM, provide liquidity, and send gasless cross-asset payments to any address.

  🔗 **Live App:** https://arc-swap-dapp.replit.app  
  📁 **GitHub:** https://github.com/osr21/arc-swap

  ---

  ## Features

  ### Swap
  - **Uniswap V2 AMM** — USDC/EURC swaps execute on-chain through deployed Router and Pair contracts
  - **Live pool prices** — quotes from on-chain reserves using the constant-product formula (x·y = k)
  - **Real price impact** — shows exact AMM price impact before confirming
  - **Slippage control** — configurable tolerance (0.1% / 0.5% / 1.0% or custom)
  - **Balance indicator** — inline token balance with MAX button
  - **Swap history** — all on-chain swaps recorded and displayed

  ### Liquidity
  - **Add/remove liquidity** — deposit USDC + EURC, receive LP tokens; redeem LP tokens to withdraw
  - **LP share display** — live view of your pool share and position value
  - **Pool stats** — live TVL, reserve ratio, LP token supply from chain

  ### Send (Gasless Cross-Asset Payments)
  - **Cross-asset send** — send USDC, EURC, or cirBTC; recipient receives any other supported token at live market rates
  - **Gasless for sender** — uses EIP-2612 permit: user signs off-chain, backend submits and pays all gas
  - **On-chain memo** — optional memo attached to each payment via the Arc v0.7.2 Memo precompile, with a direct ArcScan link in Send History
  - **Automatic refund** — if the outbound transfer ever reverts after funds are received, the sender is automatically refunded
  - **Send History** — full record of sent payments with explorer links for both the payment and memo transactions

  ### General
  - **Stats dashboard** — total swaps, total volume, top trading pair
  - **Wallet balances** — live USDC, EURC view
  - **Dark UI** — responsive, mobile-friendly

  ---

  ## Supported Tokens

  | Token | Address | Decimals | Notes |
  |-------|---------|----------|-------|
  | USDC  | `0x3600000000000000000000000000000000000000` | 6 | Circle USD Coin on Arc |
  | EURC  | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | 6 | Circle EUR Coin on Arc |
  | cirBTC | (simulated) | 8 | Simulated on testnet — no on-chain contract |

  ---

  ## Uniswap V2 Contracts (Arc Testnet)

  Deployed from canonical Uniswap V2 bytecode with no modifications.

  | Contract | Address |
  |----------|---------|
  | UniswapV2Factory | `0x7483847d46db2920dd64efa676cf72dcf765814f` |
  | UniswapV2Router02 | `0xe27d5d256b370604f1ff060fb489c6a8e3f8a6d9` |
  | WETH9 | `0x6be2c68117ca58086bd6a14e525835584d7f721e` |
  | USDC/EURC Pair | `0xb3685D16AAa06361ED28377b1319136650Fa9A13` |

  ---

  ## Arc v0.7.2 Precompiles (Activated June 18 2026)

  | Precompile | Address |
  |------------|---------|
  | Memo | `0x5294E9927c3306DcBaDb03fe70b92e01cCede505` |
  | Multicall3From | `0x522fAf9A91c41c443c66765030741e4AaCe147D0` |

  The **Memo precompile** emits an indexed on-chain event containing UTF-8 bytes. Arc Swap uses it to attach payment memos to the blockchain, viewable on [ArcScan](https://testnet.arcscan.app).

  ---

  ## How Swaps Work

  1. User approves the Router to spend their input token
  2. User calls `swapExactTokensForTokens` on the Router from MetaMask
  3. Router swaps through the USDC/EURC pair (x·y = k)
  4. Output tokens arrive in the user's wallet in the same transaction
  5. Backend records the swap for history and stats

  The **0.3% Uniswap fee** accrues to LP token holders.

  > **Why not Circle Kit?** Circle Kit's swap router is not deployed on Arc Testnet. We deployed Uniswap V2 contracts directly instead.

  ---

  ## How the Send Feature Works

  The Send feature enables gasless, cross-asset payments — the sender pays no gas at all.

  ### Payment flow (USDC → EURC example)

  ```
  User (off-chain)   Backend wallet                        Chain
       |                   |                                 |
       |-- sign EIP-2612 permit (no gas) ---------------→   |
       |                   |                                 |
       |                   |-- submit permit() tx --------→  |  (sets allowance)
       |                   |-- submit transferFrom() tx --→  |  (pulls USDC from sender)
       |                   |-- submit transfer() tx ------→  |  (sends EURC to recipient)
       |                   |-- submit memo() tx ----------→  |  (on-chain memo, best-effort)
  ```

  ### Key design decisions

  - **EIP-2612 permit** — the user signs a typed-data message granting the backend wallet a one-time allowance. No approve transaction, zero gas for the user.
  - **Sequential transactions, not batched** — an earlier design used Multicall3From to batch all calls into one transaction. This was found to cause `transferFrom` reverts: inside a Multicall3From subcall, `msg.sender` is the Multicall3From contract address, not the backend EOA. Since the permit set `allowance[sender][backendWallet]`, the check `allowance[sender][Multicall3From]` returned 0 and reverted. The fix uses three direct backend-signed transactions instead.
  - **Balance check before permit** — the backend checks it has sufficient output token balance *before* submitting the permit, so the user's EIP-2612 nonce is never consumed on a payment that will fail.
  - **Memo is best-effort** — the memo tx is fire-and-forget after the payment settles. A memo precompile failure never blocks the payment.
  - **Automatic refund** — if the outbound transfer (step 3) reverts after the inbound (step 2) has settled, the backend immediately attempts to refund the sender.

  ### Rate sources

  | Pair | Source | Cache TTL |
  |------|--------|-----------|
  | USD → EUR | [Frankfurter API](https://www.frankfurter.app) | 5 min |
  | BTC → USD | [CoinGecko API](https://www.coingecko.com/api) | 5 min |
  | Derived pairs | Composed from above | 5 min |

  ### Platform fee

  A **0.3%** fee is deducted from the input amount before conversion. The fee stays in the backend wallet to maintain liquidity.

  ---

  ## Security

  - **EIP-2612 permit validation** — deadline, V, R, S fields are validated server-side before any on-chain call
  - **Expired permit rejection** — deadline is checked against current server time; expired signatures are rejected before touching the chain
  - **Liquidity pre-check** — backend balance is verified before the permit is submitted
  - **Rate limiting** — all API endpoints are rate-limited (express-rate-limit)
  - **Input sanitization** — amount strings are length-capped; addresses validated with `isAddress`
  - **Error masking** — production errors return a generic message; full details are server-logged only

  ---

  ## Stack

  | Layer | Technology |
  |-------|-----------|
  | Frontend | React 18, Vite, TailwindCSS, shadcn/ui, wagmi, viem |
  | Backend | Node.js 24, Express 5, TypeScript 5.9 |
  | Database | PostgreSQL + Drizzle ORM |
  | Monorepo | pnpm workspaces |
  | API contract | OpenAPI 3.0 → Orval codegen (React Query hooks + Zod schemas) |
  | Chain | Arc Testnet (EVM, Chain ID 5042002) |

  ---

  ## Running Locally

  ```bash
  # Install dependencies
  pnpm install

  # Set environment variables
  # DATABASE_URL=<postgres connection string>
  # WALLET_PRIVATE_KEY=<backend wallet private key>
  # SESSION_SECRET=<random string>

  # Start API server (port 5000 / $PORT)
  pnpm --filter @workspace/api-server run dev

  # Start frontend (port 3000 / $PORT)
  pnpm --filter @workspace/arc-swap run dev

  # Push DB schema
  pnpm --filter @workspace/db run push

  # Regenerate API client from OpenAPI spec
  pnpm --filter @workspace/api-spec run codegen
  ```

  ---

  ## Explorer

  View contracts and transactions: [testnet.arcscan.app](https://testnet.arcscan.app)
  