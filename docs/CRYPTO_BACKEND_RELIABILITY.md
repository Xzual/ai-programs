# Crypto Demo Reliability

Scope: local 10,000-credit demo ledger and the existing Jev terminal. No real
exchange execution, private account API, news, learning, Ollama, or Obsidian.

## Audit

The previous engine committed cash, positions, decisions, and trades separately.
Integer trade IDs existed, but no durable request IDs or timeout lookup existed.
A repeated partial sell could execute twice. Successful Jev decisions persisted,
but failed attempts did not. A boolean freshness flag could outlive the underlying
price. Reset deleted history. The frontend could not resolve an ambiguous timeout.

## Durable Contract

POST `demo/buy`, `demo/sell`, `demo/hold`, `demo/reset`, and `decision/run` under
`/api/crypto` require `clientRequestId` or `idempotencyKey`. IDs accept 8-128 ASCII
letters, digits, underscores or hyphens. The UI uses UUIDs. Identical canonical
payloads reuse the original response, including errors. A key reused for different
input is rejected. Pending duplicates return 409 `operation_in_progress`.

SQLite reserves the operation before market/provider calls. The network runs
outside the database transaction. A short `BEGIN IMMEDIATE` execution transaction
revalidates risk and price age, writes cash/positions/fees/trade/decision/result,
then commits everything together. SQLite uniqueness constraints apply across
threads and engine instances, not just an in-memory lock.

An operation progresses through `requested`, `validated`, `risk_approved`,
`executed`, or terminates as `rejected`/`failed`. HOLD stores a decision, no trade.
Provider success plus risk veto is an accepted decision but a rejected operation.
The response explicitly reports `execution.executed=false` and the veto reason.

`GET /api/crypto/operations/:clientRequestId` returns the persisted final result
or honest pending state. Client/proxy timeout is not proof of execution failure.
The frontend preserves the ID through reloads and performs recovery lookups.
It must never invent a new ID to retry an uncertain write.

Pending reservations expire after `CRYPTO_OPERATION_LEASE_SECONDS` (default 120).
Expiry is resolved during lookup or a subsequent operation. An expired request
is terminal and its late provider response cannot execute. No automatic retry
occurs after expiry or process restart. Increase the lease only alongside bounded
provider timeouts; it is not a trading interval.

## Identity And History

- `crypto_op_*`: operation, tied to the original client request.
- `demo_trade_*`: server-generated trade ID.
- `jev_decision_*`: Jev attempt, including HOLD, veto, invalid output and errors.
- `demo_decision_*`: manual HOLD or imported non-Jev decision.
- `demo_session_*`: portfolio session.

Manual BUY/SELL has `source=manual` and `decisionId=null`. Jev executions link both
ways between the exact decision and trade; no latest-row lookup is used to guess
the association. History contains structured input summaries only, never hidden
reasoning or raw provider response bodies.

GET APIs: `status`, `portfolio`, `positions`, `trades`, `trades/:id`, `decisions`,
`decisions/latest`, `decisions/:id`, `decision/latest` (compatibility), `session`,
`sessions`, `operations/:clientRequestId`. Decisions accept symbol/source/limit;
trades accept limit/sessionId. `sessionId=all` includes archived sessions.

Responses expose `ok`, `data`, `meta.requestId`, `meta.timestamp`. Legacy root
aliases remain during frontend migration. Error messages are safe fixed strings.

## Freshness And Risk

`CRYPTO_MAX_MARKET_DATA_AGE_MS=15000` controls timestamp freshness. Reads expose
currentPrice/currentPriceTimestamp/marketDataAgeMs/marketDataStatus per position,
and portfolioValuationTimestamp/oldestPriceAgeMs/valuationStatus for the portfolio.
Missing or stale marks remain displayable only with honest status. They do not
authorize new exposure. Price age is recomputed after Jev inference in the ledger.

The Binance cache is bounded, defaults to five seconds and coalesces concurrent
misses. Refresh failure may retain a previous real quote labeled stale, never a
synthetic quote. Existing bounded candle concurrency and Jev's eight-symbol batch
are preserved. Confidence and latency are null when unavailable.

Risk caps remain long-only spot simulation, no leverage, at most 20% position,
60% total exposure, three positions, one long per symbol, cooldown before reopening,
cash including fee validation, and configured simulated fee (default 0.1%). Limits
include fee effects. Selling can reduce an existing long, never open a short.

## Migration And Reset

`demo_migration.py` is an explicit additive v2 migration. Before copying an existing
database it creates a SQLite-consistent `.pre-reliability-v2.bak` backup next to it.
Original demo and legacy paper/audit tables are retained. Existing session balance
and holdings are preserved, including accounts with a different starting balance.
Legacy position field names are normalized without changing their quantities or
cost basis. Only an explicit confirmed reset creates a new 10,000-credit account.

Old records get generated IDs and an explicit `legacy_unverified` risk marker;
historical price timestamps are unavailable. Manual records receive no invented
Jev links. Existing raw legacy blobs remain in the old tables, not public v2 APIs.

Reset requires `confirmation=RESET_DEMO_ACCOUNT`, a stopped loop, and no pending
operation. It archives the current session and creates a new 10,000-credit session.
History remains addressable. Unknown/stale ending equity is null rather than a
fabricated final valuation. Starting the loop is blocked during a pending reset.

## Verification

- `npm run test:edith-crypto`: existing demo/adapter/loop/API regression checks.
- `npm run test:edith-crypto-hardening`: isolated ledger concurrency, rollback,
  restart, recovery, history, migration, risk, Flask contract, cache and Jev tests.
- `npm run test:edith-crypto-ui`: existing desktop/mobile terminal QA.
- `node scripts/test-edith-crypto-ui-states.mjs`: isolated offline/malformed states.
- `node scripts/test-edith-crypto-recovery.mjs`: isolated timeout/recovery UI checks.
- `node scripts/test-edith-crypto-real-recovery.mjs`: mounts the real terminal against
  a disposable service, executes demo BUY/HOLD/SELL and a real Jev attempt, and
  drops a committed BUY response to verify actual UI lookup recovery.
- `npm run lint` and `npm run build`.
- `crypto\.venv\Scripts\python.exe crypto\test_runtime_reliability.py`: explicit
  real Binance public data plus configured Jev smoke test, only on a temporary
  portfolio. Writes safe evidence to `artifacts/crypto-terminal/reliability-runtime.json`.

Runtime database, backups, logs, `.venv`, caches and QA screenshots are local
artifacts. Do not commit them or delete the user's current ledger to fix a test.
The loop does not restart automatically after service restart. No profits are
promised; demo prices/fees cannot reproduce all real exchange execution conditions.
