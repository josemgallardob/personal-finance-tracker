# QA-02 — 100,000 transaction benchmark

## Reproduction

Run `npm run benchmark:release-readiness`. The command creates a temporary,
migrated SQLite file using the production connection PRAGMAs (WAL, foreign keys,
and a 5,000 ms busy timeout), then removes the database and its WAL artifacts.
It does not open a network listener or use personal or demo application data.

The generator writes 100,000 fictional expense transactions spanning 1,461
calendar days, with 20,000 fictional tag associations. It uses the application
history use case to traverse every 100-row page three times (3,000 timed pages),
asserting exactly 100,000 unique IDs on each pass. It also samples 40 transactional
manual inserts and 40 one-date recurrence materializations through the production
repositories, asserting one generated occurrence per sample and the final
transaction count of 100,080.

## Recorded run

Run date: 2026-09-09 UTC

| Property | Observed value |
| --- | --- |
| Operating system | Linux 7.0.0-28-generic x64 |
| CPU | Intel Core Processor (Haswell, no TSX), 4 logical cores |
| Memory | 7.56 GiB |
| Node.js | v24.5.0 |
| SQLite | 3.53.4 |

Two independent command runs on the same identified hardware produced:

| Metric | Run 1 | Run 2 |
| --- | ---: | ---: |
| Pagination p95 | 69.20 ms | 66.44 ms |
| Manual write p95 | 0.71 ms | 0.98 ms |
| Recurrence materialization p95 | 5.85 ms | 5.41 ms |
| Maximum write p95 | 5.85 ms | 5.41 ms |

The observed repository-level p95 values are below the 500 ms read and 800 ms
write objectives on this hardware. They are not an end-to-end private-network
latency claim: release operations must repeat the command or an equivalent
HTTP-level measurement on the target private deployment before treating the
network-specific acceptance criterion as verified.

## Query-plan evidence and optimization

Before this task, SQLite selected `transaction_workspace_date_idx` for the
history ordering but reported `USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY`;
the index covered only `(workspace_id, date)` while the stable cursor order also
uses `created_at` and `id`. Migration `0004_lethal_toro.sql` adds
`transaction_workspace_pagination_idx` on
`(workspace_id, date, created_at, id)`. The recorded benchmark plan is
`SEARCH transaction USING COVERING INDEX transaction_workspace_pagination_idx
(workspace_id=?)`, with neither a transaction-table scan nor a temporary sort.

The benchmark fails if that plan regresses, if a page traversal skips or repeats
an ID, if a write fails, or if expected transaction counts no longer match.
Existing real-SQL integration coverage continues to prove page snapshot
consistency, tag-filter deduplication, recurrence idempotency, and concurrent
writer behavior.
