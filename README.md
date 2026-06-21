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

  ### Send (Cross-Asset Payments)
  - **Cross-asset send** — send USDC, EURC, or cirBTC; recipient receives any other supported token
    - **Non-custodial** — USDC↔EURC payments go directly through the Uniswap V2 Router; no backend holds funds at any point
    - **One transaction** — the router's `to` parameter is set to the recipient address, so tokenOut arrives in the recipient's wallet in the same swap tx as the debit from the sender
    - **Optional memo** — free-text note attached to the payment record (stored in DB; displayed in Send History)
    - **Send History** — full record of sent payments with ArcScan explorer links
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

    The Send feature routes cross-asset payments directly through the Uniswap V2 Router — no backend intermediary holds funds at any point.

    ### Payment flow (USDC → EURC example)

    ```
    Sender wallet                       Uniswap V2 Router        Recipient wallet
         |                                      |                       |
         |-- approve(router, amountIn) ───────→ |                       |
         |                                      |                       |
         |-- swapExactTokensForTokens(          |                       |
         |     amountIn,                        |                       |
         |     amountOutMin,                    |                       |
         |     [USDC, EURC],                    |                       |
         |     recipientAddress,  ← key param   |                       |
         |     deadline )────────────────────→  | pulls USDC from sender|
         |                                      | pushes EURC ────────→ |
    ```

    The critical detail is the **`to` parameter** in `swapExactTokensForTokens`. By passing the recipient's address instead of the sender's, the pool deposits tokenOut directly into the recipient's wallet as part of the same atomic transaction.

    ### How cirBTC payments work

    cirBTC has no deployed ERC-20 contract on Arc Testnet. Payments involving cirBTC (any direction) are **simulated**: the backend records the payment in the database at the live market rate but no on-chain transfer occurs. This is testnet-only behaviour.

    ### Rate sources

    | Pair | Source | Notes |
    |------|--------|-------|
    | USDC ↔ EURC | `getAmountsOut` on the Uniswap V2 Router | Pool price — exact match for execution |
    | USDC ↔ cirBTC | [CoinGecko](https://www.coingecko.com/api) + [Frankfurter](https://www.frankfurter.app) | Market rate (cirBTC simulated) |
    | EURC ↔ cirBTC | Composed from above | Market rate (cirBTC simulated) |

    The estimate shown for USDC↔EURC is fetched from the pool using `getAmountsOut` — the same math the router runs at execution, so the quote is accurate. A market-rate sanity check rejects pool quotes that deviate more than 5% from the Frankfurter benchmark.

    ### Fees

    The **0.3% Uniswap LP fee** is embedded in the pool swap and accrues to liquidity providers. There is no additional platform fee on USDC↔EURC payments.
  ---

  ## Security

    - **Replay protection** — `/pay/record` enforces txHash uniqueness; a given on-chain transaction can only be recorded once
    - **Slippage guard** — payments use a 0.5% `amountOutMin`; transactions revert on-chain if the pool moves against the user before the tx mines
    - **Receipt status check** — every write on Arc Testnet is followed by an explicit `receipt.status` check; the chain does not auto-throw on revert
    - **Rate limiting** — all API endpoints are rate-limited (express-rate-limit)
    - **Input sanitization** — amount strings are length-capped; addresses validated with `isAddress`; tx hashes validated against a strict hex regex
    - **HTTP security headers** — `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` on all responses
    - **Content-Type enforcement** — POST routes return 415 for non-JSON bodies
    - **Error masking** — production errors return a generic message; full details are server-logged only
    - **Address redaction** — global swap history shows truncated addresses (`0xABCD…1234`) to limit on-chain identity correlation
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
  