# Send Feature — Technical Architecture

  ## Overview

  The Send feature allows users to send one token and have the recipient receive a different token at live market rates. The sender pays **zero gas** — all on-chain transactions are submitted by the backend wallet.

  ## Supported Token Pairs

  | Input | Output |
  |-------|--------|
  | USDC | EURC |
  | EURC | USDC |
  | USDC | cirBTC |
  | cirBTC | USDC |
  | EURC | cirBTC |
  | cirBTC | EURC |

  > cirBTC is simulated on testnet (no on-chain contract). cirBTC payments are recorded in the database with a placeholder transaction hash.

  ## Transaction Flow

  ```
  Frontend (MetaMask)                    Backend (Express)             Arc Testnet
         |                                      |                            |
         |  1. GET /api/pay/estimate            |                            |
         |─────────────────────────────────────→|                            |
         |     { rate, fee, estimatedOut }       |                            |
         |←─────────────────────────────────────|                            |
         |                                      |                            |
         |  2. signTypedData (EIP-2612 permit)  |                            |
         |  (MetaMask popup — no gas)           |                            |
         |                                      |                            |
         |  3. POST /api/pay/execute            |                            |
         |     { tokenIn, tokenOut, amount,     |                            |
         |       senderAddress, recipient,       |                            |
         |       permit: { deadline, v, r, s }} |                            |
         |─────────────────────────────────────→|                            |
         |                                      |  check backend balance      |
         |                                      |                            |
         |                                      |── permit() ───────────────→|
         |                                      |   sets allowance[sender]   |
         |                                      |   [backend] = amountIn     |
         |                                      |                            |
         |                                      |── transferFrom() ─────────→|
         |                                      |   pulls tokenIn from       |
         |                                      |   sender → backend         |
         |                                      |                            |
         |                                      |── transfer() ─────────────→|
         |                                      |   sends tokenOut from      |
         |                                      |   backend → recipient      |
         |                                      |                            |
         |                                      |── memo() (best-effort) ───→|
         |                                      |   emits UTF-8 bytes as     |
         |                                      |   on-chain event log       |
         |                                      |                            |
         |  4. { success, txHash, memoTxHash }  |                            |
         |←─────────────────────────────────────|                            |
  ```

  ## EIP-2612 Permit

  Allows a token owner to grant a spender an allowance via a signed typed-data message — no approve transaction, zero gas for the user.

  **Domain (Arc Testnet):**

  ```typescript
  {
    name: "USDC",      // or "EURC"
    version: "2",
    chainId: 5042002n,
    verifyingContract: tokenAddress,
  }
  ```

  **Typed data:**

  ```typescript
  types: {
    Permit: [
      { name: "owner",    type: "address" },
      { name: "spender",  type: "address" },
      { name: "value",    type: "uint256" },
      { name: "nonce",    type: "uint256" },
      { name: "deadline", type: "uint256" },
    ]
  }
  ```

  The nonce is read from the token contract (`nonces(owner)`) before signing, ensuring the permit is single-use and replay-protected.

  ## Why Sequential Transactions (Not Multicall3From)

  An earlier design batched all calls into a single Multicall3From call. This caused every payment to revert.

  **Root cause:**

  > Inside a Multicall3From subcall, `msg.sender` is the Multicall3From contract address (`0x522fAf9A91c41c443c66765030741e4AaCe147D0`), **not** the backend EOA.

  ERC-20 `transferFrom(owner, to, amount)` checks:
  ```solidity
  require(allowance[owner][msg.sender] >= amount);
  ```

  The permit set `allowance[sender][backendWallet] = amount`.
  Inside the subcall, `msg.sender = Multicall3From`, so `allowance[sender][Multicall3From] = 0` → **revert**.

  **Fix:** three direct backend-signed transactions where `msg.sender = backendWallet` throughout.

  ## Rate Calculation

  ```
  effectiveAmountIn = amountIn × (1 − 0.003)   // 0.3% platform fee
  amountOut = effectiveAmountIn × marketRate
  ```

  | Pair | Source | Cache TTL |
  |------|--------|-----------|
  | USD/EUR | [Frankfurter API](https://www.frankfurter.app) | 5 min |
  | BTC/USD | [CoinGecko](https://api.coingecko.com/api/v3/simple/price) | 5 min |

  All external fetch calls have an 8-second timeout.

  ## On-Chain Memo

  The Arc v0.7.2 Memo precompile (`0x5294E9927c3306DcBaDb03fe70b92e01cCede505`) accepts a `bytes` argument and emits it as an indexed on-chain event visible on ArcScan.

  ```typescript
  const memoBytes = toHex(Buffer.from(memoText, "utf8"));
  await walletClient.writeContract({
    address: "0x5294E9927c3306DcBaDb03fe70b92e01cCede505",
    abi: [{ name: "memo", type: "function", inputs: [{ name: "data", type: "bytes" }] }],
    functionName: "memo",
    args: [memoBytes],
    gas: 100_000n,
  });
  ```

  The memo tx hash is stored in `payments.memo_transaction_hash` and shown as an ArcScan link in Send History. The call is fire-and-forget — failure is logged but never surfaced to the user.

  ## Database Schema

  ```sql
  CREATE TABLE payments (
    id                    SERIAL PRIMARY KEY,
    sender_address        TEXT NOT NULL,
    recipient_address     TEXT NOT NULL,
    token_in              TEXT NOT NULL,
    token_out             TEXT NOT NULL,
    amount_in             NUMERIC(30, 10) NOT NULL,
    amount_out            NUMERIC(30, 10) NOT NULL,
    memo                  TEXT,
    transaction_hash      TEXT NOT NULL,       -- outbound transfer tx
    memo_transaction_hash TEXT,               -- memo precompile tx (nullable)
    status                TEXT NOT NULL DEFAULT 'success',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ```

  ## Refund Logic

  If the outbound transfer reverts after the inbound has settled, the backend immediately refunds the sender:

  ```typescript
  if (transferReceipt.status === "reverted") {
    await walletClient.writeContract({
      address: tokenIn.address,
      functionName: "transfer",
      args: [senderAddress, amountRaw],
      gas: 100_000n,
    });
    // If refund also fails → logged at ERROR level for manual review
  }
  ```

  ## Arc Testnet EVM Quirks

  | Quirk | Workaround |
  |-------|-----------|
  | `eth_estimateGas` is unreliable | All transactions use explicit `gas` values |
  | Receipts do not auto-throw on revert | Every receipt checked: `if (receipt.status === "reverted") throw` |
  | `createPair` requires ~5,000,000 gas | Deploy scripts use explicit high gas limits |
  