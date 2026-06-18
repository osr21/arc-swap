# Changelog

  All notable changes to Arc Swap are documented here, in reverse-chronological order.

  ---

  ## [June 18 2026] — Arc v0.7.2 Precompiles + Send Feature Hardening

  ### Added
  - **On-chain memo tx hash** — the memo precompile transaction hash is now stored in the database and displayed as a direct ArcScan link inline next to the memo text in Send History
  - `memo_transaction_hash` column added to the `payments` table (nullable; null for payments made before this release)

  ### Fixed
  - **Critical: Multicall3From msg.sender mismatch** — the Send execution previously batched `permit + transferFrom + transfer` into a single Multicall3From call. Inside a Multicall3From subcall, `msg.sender` is the Multicall3From contract address (`0x522f...`), not the backend EOA. The ERC-20 `transferFrom` check looks up `allowance[sender][msg.sender]` which was 0, causing every payment to revert with "Batch transaction reverted". Fixed by replacing the batch with three sequential direct transactions from the backend wallet, each of which correctly presents the backend EOA as `msg.sender`.
  - **Memo blocking payment** — previously `allowFailure: false` on the Memo precompile subcall caused the entire batch to revert when the precompile was not yet active (the hardfork activated at 12:00 UTC; tests were run at 07:31 UTC). After the batch→sequential refactor, the memo call is a separate fire-and-forget step that can never block the payment.
  - **Balance check ordering** — the backend liquidity check was incorrectly placed *after* the permit transaction, meaning a failed liquidity check would consume the user's EIP-2612 nonce. The check now runs before the permit is submitted.

  ### Changed
  - **"Pay" renamed to "Send"** — tab label, card heading, and history panel updated throughout the UI
  - **Memo is now best-effort** — submitted as a separate non-awaited transaction after the payment settles; failure is logged but never surfaced to the user

  ---

  ## [June 18 2026] — Send Feature Launch

  ### Added
  - **Send feature** — gasless cross-asset payments using EIP-2612 off-chain permit signatures
    - Supported token pairs: USDC↔EURC, USDC↔cirBTC, EURC↔cirBTC (all directions)
    - User signs a permit typed-data message in MetaMask (zero gas)
    - Backend submits permit tx, transferFrom tx, and transfer tx — paying all gas
    - Optional on-chain memo via Arc v0.7.2 Memo precompile (`0x5294...`)
    - 0.3% platform fee deducted from input amount
    - Automatic sender refund if outbound transfer fails after inbound settles
  - **Send History** — paginated list of sent payments with ArcScan tx links and memo display
  - **Live rate conversion** — real market rates from Frankfurter (USD/EUR) and CoinGecko (BTC/USD) with 5-minute in-memory cache
  - **Security hardening**
    - Permit fields (deadline, V, R, S) validated server-side before any on-chain call
    - Expired permit rejected before touching the chain (server clock check)
    - Amount string length capped to prevent abuse
    - 8-second timeout on external rate API calls
    - All endpoints rate-limited via `express-rate-limit`
    - Production errors return a generic message; full error details are server-logged only

  ---

  ## [June 16 2026] — Uniswap V2 + Liquidity Pool

  ### Added
  - Deployed canonical Uniswap V2 contracts to Arc Testnet (Factory, Router02, WETH9, USDC/EURC Pair)
  - AMM-based USDC↔EURC swaps directly from the user's wallet through the Router
  - On-chain price impact calculation using reserve ratios
  - Slippage tolerance controls (0.1% / 0.5% / 1.0% / custom)
  - Add/remove liquidity UI with LP token tracking
  - Pool stats panel (TVL, reserves, LP supply)
  - Transaction hash verification before recording swaps
  - Rate limiting on swap and pool endpoints

  ### Notes
  - Circle Kit's `kit.swap()` was evaluated but produces `ONCHAIN_SIMULATION_FAILED` on Arc Testnet — its Uniswap router is not deployed on this chain. Uniswap V2 was deployed directly as the working alternative.
  - `createPair` on Arc Testnet requires 5,000,000 gas (not the standard ~500,000) — the EVM gas estimation is also unreliable; all transactions use explicit gas values.
  