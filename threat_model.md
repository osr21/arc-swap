# Threat Model

## Project Overview

Arc Swap is a pnpm monorepo containing a React frontend (`artifacts/arc-swap`) and an Express API (`artifacts/api-server`) for estimating and executing token swaps on Arc Testnet. The backend holds privileged assets in environment variables, talks directly to PostgreSQL through Drizzle, and invokes Circle AppKit plus blockchain RPC services on behalf of the application. The mockup sandbox artifact is development-only and out of production scope unless later evidence shows it is deployed.

## Assets

- **Server-controlled wallet credentials** -- `WALLET_PRIVATE_KEY` gives the API authority to act on-chain as the backend wallet. Compromise or misuse can directly move or transform funds.
- **Application API credentials and secrets** -- `CIRCLE_KIT_KEY`, `DATABASE_URL`, and any fee-wallet configuration control access to third-party services and persistence.
- **Operational financial data** -- swap history, fee earnings, and backend wallet balances reveal trading activity and treasury posture.
- **Database records** -- `swap_history` and `fee_earnings` store historical transaction metadata and platform revenue data.
- **Frontend users and their wallets** -- browser users connect wallets and initiate swaps; the client is untrusted and all server decisions must assume malicious input.

## Trust Boundaries

- **Browser to API** -- all `/api` requests originate from untrusted clients. CORS does not provide authorization and cannot be relied on as a security boundary.
- **API to environment secrets** -- route handlers can access wallet private keys and service credentials from environment variables; any public route using them is highly sensitive.
- **API to PostgreSQL** -- the server can read and write swap and fee tables. Query scoping and exposure decisions must be enforced server-side.
- **API to Circle / blockchain RPC** -- the backend can trigger external swaps and inspect wallet balances; misuse can have financial impact even without direct key leakage.
- **Production vs dev-only artifacts** -- `artifacts/mockup-sandbox` and utility scripts are assumed non-production unless explicitly wired into deployment.

## Scan Anchors

- Production API entry points: `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, and `artifacts/api-server/src/routes/`.
- Highest-risk code areas: `artifacts/api-server/src/routes/swap.ts`, `artifacts/api-server/src/routes/wallet.ts`, `artifacts/api-server/src/routes/config.ts`, and `artifacts/api-server/src/lib/fee.ts` because they touch server-held blockchain credentials or financial data.
- Public surfaces: all current API routes under `/api/*` appear unauthenticated.
- Data layer: `lib/db/src/index.ts` and `lib/db/src/schema/swaps.ts`.
- Dev-only area to usually ignore: `artifacts/mockup-sandbox/**`.

## Threat Categories

### Spoofing

The API currently exposes public routes without session or API-key enforcement. The system must not trust browser origin, connected-wallet UI state, or frontend routing as proof that a caller is allowed to trigger privileged backend actions. Any endpoint that uses server-held wallet credentials or reveals restricted operational data MUST require an explicit server-side authorization decision.

### Tampering

Untrusted clients can supply swap parameters, wallet addresses, and other request data. The system must validate token identifiers, numeric ranges, and any future address ownership claims server-side before those inputs influence on-chain actions, database writes, or third-party API calls. Public callers must never be able to cause the backend hot wallet to execute trades on their behalf without authorization.

### Information Disclosure

The application exposes operational data through `/api/config`, `/api/wallet/balances`, `/api/swap/history`, and `/api/fees`. The system must ensure that only intentionally public information is returned there, and must not disclose server-side secrets, sensitive wallet metadata, or internal error details that reveal environment configuration or third-party failures. Financial activity linked to a backend-controlled wallet should be treated as sensitive unless the product explicitly intends full public transparency.

### Denial of Service

Public routes call external services and blockchain RPCs. The system must keep strict body-size limits, request throttling, and bounded external calls so unauthenticated users cannot cheaply force expensive quote, swap, or balance operations. Rate limiting helps but does not replace authorization on routes with direct financial side effects.

### Elevation of Privilege

The highest-risk privilege boundary is between public internet callers and code paths that use `WALLET_PRIVATE_KEY` or other privileged server capabilities. The system must ensure no unauthenticated request can indirectly gain the authority of the backend wallet, read restricted treasury information, or perform administrative financial operations. All privileged server actions must be unreachable from anonymous callers unless they are deliberately safe to expose.