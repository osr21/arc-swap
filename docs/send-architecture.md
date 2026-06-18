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
         |                                      |── Memo.memo(               |
         |                                      |     target=tokenOut,       |
         |                                      |     data=transfer(),       |
         |                                      |     memoId, memoData) ────→|
         |                                      |   ├─ CallFrom forwards     |
         |                                      |   │  transfer to tokenOut  |
         |                                      |   └─ emits Memo events     |
         |                                      |                            |
         |  4. { success, txHash, memoTxHash }  |                            |
         |←─────────────────────────────────────|                            |
  ```

  > **Note:** Steps 3 (outbound transfer) and 4 (memo) are combined into a single atomic `Memo.memo()` call. `txHash` and `memoTxHash` reference the same transaction.

  ## EIP-2612 Permit

  Allows a token owner to grant a spender an allowance via a signed typed-data message — no approve transaction, zero gas for the user.

  **Domain (Arc Testnet):**

  ```typescript
  {
    name: "USDC",      // or "EURC"
    version: "2",      // both tokens use version 2 on Arc Testnet
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

  The nonce is read from the token contract (`nonces(owner)`) before signing — single-use, replay-protected.

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

  **Fix:** permit and transferFrom are direct backend-signed transactions where `msg.sender = backendWallet`.

  The outbound transfer is wrapped in `Memo.memo()` which uses the `CallFrom` precompile internally — this correctly preserves `msg.sender = backendWallet` for the inner transfer call.

  ## On-Chain Memo via Memo Contract

  The Arc Memo contract (`0x5294E9927c3306DcBaDb03fe70b92e01cCede505`) is a **call wrapper** — it forwards an inner contract call via the `CallFrom` precompile (preserving `msg.sender`) and emits structured events around it.

  **Correct ABI:**

  ```solidity
  function memo(
      address target,
      bytes calldata data,
      bytes32 memoId,
      bytes calldata memoData
  ) external;
  ```

  **viem usage:**

  ```typescript
  const transferCalldata = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipientAddress, amountOut],
  });

  const memoId = `0x${BigInt(Date.now()).toString(16).padStart(64, "0")}` as `0x${string}`;

  await walletClient.writeContract({
    address: MEMO_ADDRESS,
    abi: MEMO_ABI,
    functionName: "memo",
    args: [
      tokenOut.address,                              // target
      transferCalldata,                              // data forwarded to target
      memoId,                                        // bytes32 identifier
      toHex(Buffer.from(memoText, "utf8")),          // memoData
    ],
    gas: 200_000n,  // wraps an inner call — needs more gas than a plain transfer
  });
  ```

  **Events emitted (in order):**
  1. `BeforeMemo(memoIndex)` — before the inner call
  2. Target contract events (e.g. USDC `Transfer`)
  3. `Memo(sender, target, callDataHash, memoId, memo, memoIndex)` — after the inner call

  Query by indexed `memoId` or `sender` to reconcile payments against memo records.

  **Constraints:**
  - Must be called directly from an EOA — intermediary contracts revert (sender spoofing not allowed)
  - If the inner call reverts, the outer Memo tx also reverts (atomic)
  - Do not use `STATICCALL`, `DELEGATECALL`, or call `CallFrom` directly from an EOA

  ## ArcScan: Finding the Memo

  On [testnet.arcscan.app](https://testnet.arcscan.app), open the transaction → **Logs** tab. You will see:
  - A `BeforeMemo` log from the Memo contract
  - The inner token `Transfer` log
  - A `Memo` log with `memoId`, `memo` (your bytes), and `callDataHash`

  The `memo` field in the Memo log contains your UTF-8 encoded memo bytes. Decode with `Buffer.from(memoHex.slice(2), "hex").toString("utf8")`.

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
    transaction_hash      TEXT NOT NULL,       -- Memo.memo() tx (transfer + memo, atomic)
    memo_transaction_hash TEXT,               -- same as transaction_hash (memo is embedded)
    status                TEXT NOT NULL DEFAULT 'success',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ```

  ## Refund Logic

  If the outbound Memo.memo() call reverts (inner transfer failed), the backend refunds the sender:

  ```typescript
  if (transferReceipt.status === "reverted") {
    await walletClient.writeContract({
      address: tokenIn.address,
      functionName: "transfer",
      args: [senderAddress, amountRaw],
      gas: 100_000n,
    });
  }
  ```

  ## Arc Testnet EVM Quirks

  | Quirk | Workaround |
  |-------|-----------|
  | `eth_estimateGas` is unreliable | All transactions use explicit `gas` values |
  | Receipts do not auto-throw on revert | Every receipt checked: `if (receipt.status === "reverted") throw` |
  | `createPair` requires ~5,000,000 gas | Deploy scripts use explicit high gas limits |
  | Memo contract is a call wrapper, not a log emitter | Pass `(target, data, memoId, memoData)` — single `bytes` arg always reverts |
  