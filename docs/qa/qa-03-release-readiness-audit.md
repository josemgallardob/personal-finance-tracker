# QA-03 — MVP release readiness audit

This report is the repository-side audit that closes the MVP: it maps every
functional requirement to the tests that exercise it, records the result of
every configured check on identified hardware, and states which release
criteria are met by evidence and which remain external validations.

Story identifiers (`US-xx`) are references into the owner's private backlog.
No backlog, plan or private evidence content is reproduced here; each row cites
only public artefacts — test files, commands and their observed results.

## Method

Every result below comes from a command run in this worktree at the commit
recorded in "Executed checks". No check was skipped, retried until green,
excluded, or run with a weakened configuration. Coverage thresholds, coverage
exclusions and the Playwright retry policy are unchanged; the audit did not
lower any threshold and did not add any coverage exclusion.

## Requirement traceability

Test paths are the files that assert the behaviour of each requirement. The
end-to-end column lists the Playwright specs under `tests/e2e/`.

| Requirement                             | Unit and component                                                                                                                                                                                                                                                                                                 | Integration                                                                                                                                                                                       | End-to-end                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| F-01 Register an expense                | `src/shared/domain/money.test.ts`, `src/modules/transactions/domain/transaction.test.ts`, `src/modules/transactions/contracts/transaction.test.ts`, `src/modules/transactions/ui/transaction-form.test.tsx`, `src/modules/transactions/ui/create-dialog.test.tsx`                                                  | `tests/integration/transactions/create-transaction.test.ts`, `tests/integration/transactions/sqlite-transaction-repository.test.ts`, `tests/integration/http/transactions.test.ts`                | `create-transaction.spec.ts`, `transaction-history.spec.ts`                                  |
| F-02 Register an income                 | `src/modules/transactions/domain/transaction-type.test.ts`, `src/modules/transactions/application/create-transaction.test.ts`, `src/modules/analytics/ui/summary-cards.test.tsx`                                                                                                                                   | `tests/integration/transactions/create-transaction.test.ts`, `tests/integration/analytics/sqlite-analytics-repository.test.ts`                                                                    | `create-transaction.spec.ts`, `dashboard-summary.spec.ts`                                    |
| F-03 Correct a movement                 | `src/modules/transactions/application/update-transaction.test.ts`, `src/modules/transactions/ui/edit-dialog.test.tsx`                                                                                                                                                                                              | `tests/integration/transactions/update-transaction.test.ts`, `tests/integration/classification/sqlite-unit-of-work.test.ts`                                                                       | `transaction-history.spec.ts`, `maintenance-dialogs.spec.ts`, `dashboard-drill-down.spec.ts` |
| F-04 Delete a movement                  | `src/modules/transactions/application/delete-transaction.test.ts`, `src/modules/transactions/ui/delete-dialog.test.tsx`, `src/shared/ui/confirm-dialog.test.tsx`                                                                                                                                                   | `tests/integration/transactions/delete-transaction.test.ts`                                                                                                                                       | `maintenance-dialogs.spec.ts`, `transaction-history.spec.ts`                                 |
| F-05 Duplicate a movement               | `src/modules/transactions/ui/duplicate-dialog.test.tsx`, `src/modules/transactions/ui/transaction-dialog-support.test.ts`                                                                                                                                                                                          | `tests/integration/transactions/create-transaction.test.ts`                                                                                                                                       | `maintenance-dialogs.spec.ts`, `transaction-history.spec.ts`                                 |
| F-06 Find movements                     | `src/modules/transactions/application/list-transaction-filters.test.ts`, `src/modules/transactions/ui/history-filters.test.tsx`, `src/modules/transactions/ui/history-date-range.test.ts`, `src/modules/transactions/ui/date-range-dialog.test.tsx`, `src/modules/transactions/client/history-query-state.test.ts` | `tests/integration/transactions/list-transactions.test.ts`, `tests/integration/http/transactions.test.ts`                                                                                         | `transaction-history-filters.spec.ts`, `transaction-history-date-range.spec.ts`              |
| F-07 Understand the period              | `src/modules/analytics/domain/periods.test.ts`, `src/modules/analytics/domain/comparison.test.ts`, `src/modules/analytics/application/dashboard-analytics.test.ts`, `src/modules/analytics/ui/summary-cards.test.tsx`, `src/modules/analytics/ui/period-comparison.test.tsx`                                       | `tests/integration/analytics/dashboard-analytics-services.test.ts`, `tests/integration/analytics/sqlite-analytics-repository.test.ts`, `tests/integration/http/analytics.test.ts`                 | `dashboard-summary.spec.ts`, `dashboard-drill-down.spec.ts`                                  |
| F-08 Analyse categories                 | `src/modules/analytics/ui/charts/expense-category-bars.test.tsx`, `src/modules/analytics/contracts/drill-down.test.ts`, `src/modules/analytics/ui/charts/chart-series.test.ts`                                                                                                                                     | `tests/integration/analytics/sqlite-analytics-repository.test.ts`                                                                                                                                 | `dashboard-drill-down.spec.ts`                                                               |
| F-09 Analyse context tags               | `src/modules/classification/domain/tag.test.ts`, `src/modules/classification/application/resolve-tags.test.ts`, `src/modules/classification/ui/tag-picker.test.tsx`, `src/modules/analytics/ui/charts/expense-tag-bars.test.tsx`                                                                                   | `tests/integration/classification/resolve-tags.test.ts`, `tests/integration/classification/sqlite-tag-repository.test.ts`, `tests/integration/analytics/sqlite-analytics-repository.test.ts`      | `dashboard-drill-down.spec.ts`, `transaction-history-filters.spec.ts`                        |
| F-10 Browse a long history              | `src/modules/transactions/ui/use-history-pages.test.tsx`, `src/modules/transactions/ui/history-page-sentinel.test.tsx`, `src/modules/transactions/ui/history-load.test.ts`                                                                                                                                         | `tests/integration/transactions/list-transactions.test.ts`, `tests/integration/analytics/sqlite-analytics-repository.test.ts`                                                                     | `transaction-history-pagination.spec.ts`                                                     |
| F-11 Schedule a monthly movement        | `src/modules/recurring/domain/recurring-rule.test.ts`, `src/modules/recurring/domain/recurrence-calendar.test.ts`, `src/modules/recurring/ui/recurring-rule-form-schema.test.ts`, `src/modules/recurring/ui/repeat-monthly-fields.test.tsx`, `src/modules/recurring/ui/recurring-list.test.tsx`                    | `tests/integration/recurring/recurring-lifecycle.test.ts`, `tests/integration/http/recurring-rules.test.ts`                                                                                       | `recurring-lifecycle.spec.ts`, `transaction-history.spec.ts`                                 |
| F-12 Materialise a due date             | `src/modules/recurring/application/generate-due-occurrences.test.ts`, `src/modules/recurring/domain/recurring-occurrence.test.ts`                                                                                                                                                                                  | `tests/integration/recurring/generate-due-occurrences.test.ts`, `tests/integration/recurring/recurring-command-concurrency.test.ts`, `tests/integration/recurring/run-personal-recurring.test.ts` | `recurring-lifecycle.spec.ts`                                                                |
| F-13 Stop a recurrence                  | `src/modules/recurring/application/services/recurring-lifecycle.test.ts`, `src/modules/recurring/ui/recurring-list.test.tsx`                                                                                                                                                                                       | `tests/integration/recurring/recurring-lifecycle.test.ts`, `tests/integration/recurring/archive-guards.test.ts`                                                                                   | `recurring-lifecycle.spec.ts`                                                                |
| F-14 Know the monthly averages          | `src/modules/analytics/ui/averages/averages-series.test.ts`, `src/modules/analytics/ui/averages/monthly-averages.test.tsx`, `src/modules/analytics/application/dashboard-analytics.test.ts`                                                                                                                        | `tests/integration/analytics/dashboard-analytics-services.test.ts`                                                                                                                                | `dashboard-summary.spec.ts`, `dashboard-drill-down.spec.ts`                                  |
| F-15 Reduce the noise of the breakdowns | `src/modules/analytics/ui/series/series-options.test.ts`, `src/modules/analytics/ui/series/series-selection.test.ts`, `src/modules/analytics/ui/series/use-series-selection.test.tsx`, `src/modules/analytics/ui/series/series-selectors.test.tsx`, `src/shared/ui/multi-select.test.tsx`                          | `tests/integration/analytics/dashboard-analytics-services.test.ts`                                                                                                                                | `dashboard-summary.spec.ts`, `demo-experience.spec.ts`                                       |

## Story evidence

| Story | Evidence                                                                                                                                                                                                                                                                                                                                            | Status                                                                                            |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| US-01 | `tests/integration/workspace-bootstrap.test.ts`, `tests/integration/migrations.test.ts`, `tests/integration/classification/seed-categories.test.ts`                                                                                                                                                                                                 | Covered by automated tests                                                                        |
| US-02 | `tests/integration/demo/mode-and-session.test.ts`, `tests/integration/demo/reset.test.ts`, `src/modules/preferences/ui/demo-actions.test.tsx`, `demo-experience.spec.ts`                                                                                                                                                                            | Covered by automated tests                                                                        |
| US-03 | `src/modules/classification/domain/initial-category-catalog.test.ts`, `tests/integration/classification/seed-categories.test.ts`                                                                                                                                                                                                                    | Covered by automated tests                                                                        |
| US-04 | `src/modules/classification/application/services/classification-maintenance.test.ts`, `tests/integration/classification/classification-maintenance.test.ts`, `tests/integration/classification/sqlite-category-repository.test.ts`, `src/modules/classification/ui/archive-dialog.test.tsx`                                                         | Covered by automated tests                                                                        |
| US-05 | `src/modules/classification/ui/tag-picker.test.tsx`, `src/modules/classification/application/resolve-tags.test.ts`, `src/modules/transactions/ui/transaction-form.test.tsx`                                                                                                                                                                         | Covered by automated tests                                                                        |
| US-06 | `src/modules/classification/ui/tag-dialog.test.tsx`, `tests/integration/classification/sqlite-tag-repository.test.ts`, `tests/integration/classification/classification-maintenance.test.ts`                                                                                                                                                        | Covered by automated tests                                                                        |
| US-07 | F-01 row above; `create-transaction.spec.ts`; `tests/e2e/accessibility.spec.ts`                                                                                                                                                                                                                                                                     | Automated; the timed manual entry remains an owner validation                                     |
| US-08 | F-02 row above                                                                                                                                                                                                                                                                                                                                      | Covered by automated tests                                                                        |
| US-09 | F-03 row above                                                                                                                                                                                                                                                                                                                                      | Covered by automated tests                                                                        |
| US-10 | F-04 row above                                                                                                                                                                                                                                                                                                                                      | Covered by automated tests                                                                        |
| US-11 | F-05 row above                                                                                                                                                                                                                                                                                                                                      | Covered by automated tests                                                                        |
| US-12 | `src/modules/transactions/ui/history-list.test.tsx`, `src/modules/transactions/ui/history-presentation.test.ts`, `tests/integration/transactions/list-transactions.test.ts`, `transaction-history.spec.ts`                                                                                                                                          | Covered by automated tests                                                                        |
| US-13 | F-06 row above; `transaction-history-filters.spec.ts`                                                                                                                                                                                                                                                                                               | Covered by automated tests                                                                        |
| US-14 | `src/modules/transactions/ui/history-date-range.test.ts`, `src/modules/transactions/ui/date-range-dialog.test.tsx`, `transaction-history-date-range.spec.ts`                                                                                                                                                                                        | Covered by automated tests                                                                        |
| US-15 | F-10 row above; `docs/performance/qa-02-100k-benchmark.md`                                                                                                                                                                                                                                                                                          | Covered by automated tests and the recorded benchmark                                             |
| US-16 | `src/modules/analytics/ui/dashboard-summary.test.tsx`, `src/modules/analytics/ui/summary-presentation.test.ts`, `tests/integration/analytics/dashboard-analytics-services.test.ts`                                                                                                                                                                  | Covered by automated tests                                                                        |
| US-17 | `src/modules/analytics/domain/periods.test.ts`, `src/modules/analytics/domain/comparison.test.ts`, `src/modules/analytics/ui/period-selector.test.tsx`, `src/modules/analytics/ui/period-comparison.test.tsx`                                                                                                                                       | Covered by automated tests                                                                        |
| US-18 | `src/modules/analytics/ui/charts/monthly-trend.test.tsx`, `src/modules/analytics/ui/charts/chart-series.test.ts`, `tests/integration/analytics/sqlite-analytics-repository.test.ts`                                                                                                                                                                 | Covered by automated tests                                                                        |
| US-19 | F-08 row above                                                                                                                                                                                                                                                                                                                                      | Covered by automated tests                                                                        |
| US-20 | F-09 row above                                                                                                                                                                                                                                                                                                                                      | Covered by automated tests                                                                        |
| US-21 | F-14 row above                                                                                                                                                                                                                                                                                                                                      | Covered by automated tests                                                                        |
| US-22 | F-15 row above                                                                                                                                                                                                                                                                                                                                      | Covered by automated tests                                                                        |
| US-23 | `src/modules/analytics/contracts/drill-down.test.ts`, `dashboard-drill-down.spec.ts`                                                                                                                                                                                                                                                                | Covered by automated tests                                                                        |
| US-24 | F-11 row above                                                                                                                                                                                                                                                                                                                                      | Covered by automated tests                                                                        |
| US-25 | `tests/integration/recurring/generate-due-occurrences.test.ts`, `tests/integration/recurring/recurring-command-concurrency.test.ts`, `recurring-lifecycle.spec.ts`                                                                                                                                                                                  | Covered by automated tests                                                                        |
| US-26 | `src/modules/recurring/application/generate-due-occurrences.test.ts`, `tests/integration/recurring/run-personal-recurring.test.ts`, `recurring-lifecycle.spec.ts`                                                                                                                                                                                   | Covered by automated tests                                                                        |
| US-27 | `src/modules/recurring/ui/recurring-list.test.tsx`, `src/modules/recurring/application/services/recurring-lifecycle.test.ts`, `tests/integration/http/recurring-rules.test.ts`                                                                                                                                                                      | Covered by automated tests                                                                        |
| US-28 | F-13 row above                                                                                                                                                                                                                                                                                                                                      | Covered by automated tests                                                                        |
| US-29 | `tests/e2e/accessibility.spec.ts` (320 px, 200 % zoom, keyboard and axe), `dashboard-summary.spec.ts` and `transaction-history.spec.ts` mobile viewports, `src/shared/ui/app-shell.test.tsx`                                                                                                                                                        | Chromium and Firefox verified; WebKit not executable on this host                                 |
| US-30 | —                                                                                                                                                                                                                                                                                                                                                   | Owner validation pending; tracked by the sustainability observation task                          |
| US-31 | `tests/integration/deployment/server-binding-and-shutdown.test.ts`, `tests/integration/deployment/private-operations-contract.test.ts`, `tests/integration/deployment/container-contract.test.ts`, `tests/integration/app-config.test.ts`                                                                                                           | Repository-side contract verified; a real private-network device test is an owner validation      |
| US-32 | `tests/integration/deployment/backup-run.test.ts`, `tests/integration/deployment/backup-snapshot-and-restore.test.ts`, `tests/integration/deployment/backup-encryption.test.ts`, `tests/integration/deployment/backup-retention.test.ts`, `tests/integration/deployment/restore-verification.test.ts`, plus the disposable rehearsal recorded below | Verified on a disposable database; a rehearsal on the real deployment host is an owner validation |
| US-33 | `docs/performance/qa-02-100k-benchmark.md`, `tests/performance/release-readiness-benchmark.ts`                                                                                                                                                                                                                                                      | Covered by the recorded benchmark                                                                 |

## Continuous-integration gates

`.github/workflows/ci.yml` publishes two jobs, `Quality` and `End-to-end`, on
pull requests targeting `main` and `stable` and again on the merge group that
GitHub builds before integration. There is no post-merge `push` trigger, so the
merge-group run is the final gate.

| Documented gate                        | Workflow step                                                    | Job                    |
| -------------------------------------- | ---------------------------------------------------------------- | ---------------------- |
| Format, lint and TypeScript            | `npm run format:check`, `npm run lint`, `npm run typecheck`      | Quality                |
| Unit tests                             | `npm run test:coverage` (`jsdom` project)                        | Quality                |
| Integration tests on isolated SQLite   | `npm run test:coverage` (`node` project, `tests/integration/**`) | Quality                |
| Coverage with the mandatory thresholds | `npm run test:coverage`                                          | Quality                |
| Migrations against a clean database    | `npm run verify:clean-migrations`                                | Quality                |
| Production build                       | `npm run verify:build-without-database`                          | Quality and End-to-end |
| Secret scan                            | `npm run security:secrets`                                       | Quality                |
| Dependency audit                       | `npm audit --audit-level=high`                                   | Quality                |
| Critical end-to-end suite              | `npm run test:e2e`                                               | End-to-end             |

The unit and integration suites share one Vitest invocation, so the coverage
thresholds are applied to the combined run. No workflow step is marked
`continue-on-error`, none is guarded by `if: always()`, and no command swallows
its exit status.

`tests/integration/ci-workflow.test.ts` turns this table into an executable
contract: it fails when a trigger, a gate, a package script or a coverage
threshold is removed or lowered, and when a step is made non-blocking.

### Cross-browser coverage

The pull-request job runs Chromium only, which matches the documented policy of
covering every change in Chromium and running Firefox and WebKit before
publishing a version. Those two browsers are executed manually (see below);
there is no scheduled workflow that runs them, which remains an open item for
the deployment phase, together with the definition of the `stable` branch.

## Branch protection observation

Read-only observation, taken with the repository owner's `gh` credentials. No
repository or host setting was changed by this task; the findings below are
reported for the owner to decide on.

- `main` is covered by an active repository ruleset (`main ruleset`) that
  requires a pull request, forbids deletion and non-fast-forward pushes, has no
  bypass actors, and enables the merge queue with the all-green grouping
  strategy.
- The ruleset requires strict status checks, but its required-check list
  contains only `Quality`. The `End-to-end` job is therefore not a required
  check: a pull request whose end-to-end job fails can still be queued.
- The classic branch-protection endpoint reports `main` as unprotected because
  protection is expressed through the ruleset, not through legacy protection.
- `stable` does not exist yet in the remote, so no ruleset targets it. The
  workflow already declares the trigger for when it is created.

Making `End-to-end` a required check is a remote repository setting and was
explicitly out of scope for this task; it is left to the owner.

## Execution environment

| Property         | Value                                                   |
| ---------------- | ------------------------------------------------------- |
| Operating system | Linux 7.0.0-28-generic x64                              |
| CPU              | Intel Core Processor (Haswell, no TSX), 4 logical cores |
| Memory           | 7.56 GiB                                                |
| Node.js          | v24.20.0                                                |
| npm              | 12.0.2                                                  |
| SQLite           | 3.53.4                                                  |
| Browsers         | Playwright 1.63 Chromium 1243, Firefox 1543             |

## Executed checks

Run date: 2026-09-09 UTC, on the branch that carries this report.

| Command                                        | Result                                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run check`                                | Passed: formatting, lint, TypeScript, coverage, clean migrations, production build and secret scan |
| `npm run test:coverage`                        | 180 test files, 2,230 tests passed, 0 skipped, in 143.68 s                                         |
| `npm run verify:clean-migrations`              | Applied 5 migrations to a new database; a second run changed nothing                               |
| `npm run verify:build-without-database`        | Production build succeeded and created no SQLite file                                              |
| `npm run security:secrets`                     | No secret reported                                                                                 |
| `npm audit --audit-level=high`                 | Passed: 0 critical, 0 high, 4 moderate                                                             |
| `npm run test:e2e` (Chromium)                  | 35 passed in 1.8 min                                                                               |
| `PLAYWRIGHT_BROWSERS=firefox npm run test:e2e` | 35 passed in 2.6 min                                                                               |
| `PLAYWRIGHT_BROWSERS=webkit npm run test:e2e`  | Not executable on this host: 35 launch failures                                                    |
| `npm run benchmark:release-readiness`          | Completed; figures below                                                                           |
| Backup and restore rehearsal                   | Completed on a disposable database; details below                                                  |

No test was skipped, quarantined or retried. Playwright runs with `retries: 0`
and `forbidOnly` under CI, so a flaky pass cannot be produced by a retry.

### Dependency audit detail

The four moderate advisories are the same chain, reached only through the
development dependency `drizzle-kit` (`@esbuild-kit/esm-loader` →
`@esbuild-kit/core-utils` → `esbuild` ≤ 0.24.2, GHSA-67mh-4wv8-2f99). The
advisory concerns the esbuild development server, which this project never
starts, and the chain is absent from the production image, which installs with
`npm ci --omit=dev`. The only offered remedy is a breaking downgrade of
`drizzle-kit`. No critical or high advisory is open.

### WebKit

WebKit cannot start on this host: every launch fails with
`Host system is missing dependencies to run browsers`, listing `libgtk-4.so.1`,
`libgraphene-1.0.so.0`, `libevent-2.1.so.7` and the GStreamer and Flite
libraries. Installing those system packages changes the host, which is outside
this task, so the 35 WebKit results are reported as not executed rather than as
failures of the product. WebKit remains an external validation before
publishing a version.

## Coverage

Measured by the same `npm run test:coverage` run that gates CI, over
`src/**/*.{ts,tsx}`, with the thresholds unchanged at 90 % lines, 90 %
statements, 90 % functions and 85 % branches.

| Metric     | Result                  | Threshold |
| ---------- | ----------------------- | --------- |
| Statements | 95.61 % (5,754 / 6,018) | 90 %      |
| Branches   | 92.35 % (3,674 / 3,978) | 85 %      |
| Functions  | 96.61 % (1,455 / 1,506) | 90 %      |
| Lines      | 95.75 % (5,660 / 5,911) | 90 %      |

### Critical branch rule

The QA document requires 100 % branch coverage for the monetary rules, the
monthly averages, the date-period calculations and the recurrence generation.
The audit measured each of those modules from `coverage/lcov.info`:

| Module                                                          | Rule                  | Lines           | Branches      |
| --------------------------------------------------------------- | --------------------- | --------------- | ------------- |
| `src/shared/domain/money.ts`                                    | Monetary rules        | 100 % (55/55)   | 100 % (33/33) |
| `src/shared/domain/dates.ts`                                    | Date periods          | 100 % (58/58)   | 100 % (36/36) |
| `src/modules/analytics/domain/periods.ts`                       | Date periods          | 100 % (79/79)   | 100 % (31/31) |
| `src/modules/analytics/domain/comparison.ts`                    | Date periods          | 100 % (27/27)   | 100 % (22/22) |
| `src/modules/analytics/ui/averages/averages-series.ts`          | Monthly averages      | 100 % (24/24)   | 100 % (16/16) |
| `src/modules/analytics/application/dashboard-analytics.ts`      | Monthly averages      | 100 % (83/83)   | 100 % (44/44) |
| `src/modules/recurring/domain/recurrence-calendar.ts`           | Recurrence generation | 100 % (22/22)   | 100 % (15/15) |
| `src/modules/recurring/domain/recurring-rule.ts`                | Recurrence generation | 100 % (57/57)   | 100 % (53/53) |
| `src/modules/recurring/domain/recurring-occurrence.ts`          | Recurrence generation | 100 % (17/17)   | 100 % (16/16) |
| `src/modules/recurring/application/generate-due-occurrences.ts` | Recurrence generation | 100 % (108/108) | 100 % (73/73) |

`generate-due-occurrences.ts` did not meet the rule when the audit started: it
stood at 96.30 % lines and 94.52 % branches because the catch-up path used by
an edited or reactivated rule was never exercised for a missing rule, for a
storage failure, for a rule that moved on between the read and the write, or
for a date another run had already reserved. Five tests were added for those
four behaviours; they assert the returned refusal code and that no second
movement is written. No threshold, exclusion or production line was changed to
reach 100 %.

### Remaining uncovered code

| Area                                                                                                             | Coverage                      | Why it is uncovered                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/app/e2e/recurring/harness.tsx`, `src/app/e2e/recurring/run/route.ts`                                        | 0 %                           | The gated end-to-end clock harness. It is exercised by `recurring-lifecycle.spec.ts` under Playwright, which the Vitest coverage run does not observe. |
| `src/app/api/**/route.ts`                                                                                        | 0–75 %                        | Next route files that only re-export the handler. The behaviour is covered by `tests/integration/http/**`, which drives the handler modules directly.  |
| `src/modules/preferences/ui/demo-actions.tsx`                                                                    | 66.7 % lines                  | Demo reset states reached through the browser dialogs; covered end to end by `demo-experience.spec.ts` rather than by component tests.                 |
| `src/modules/recurring/application/services/recurring-lifecycle.ts`                                              | 87.8 % lines, 82.5 % branches | Repository failure paths of the rule lifecycle that the SQLite integration suite cannot provoke without faulting the driver.                           |
| `src/modules/recurring/infrastructure/sqlite-recurring-rule-repository.ts`                                       | 86.3 % lines                  | Driver error mapping for SQLite conditions that the isolated database does not produce.                                                                |
| `src/shared/server/backup/restore-verification.ts`                                                               | 83.7 % lines                  | Artifact rejection branches for filesystem failures; the invalid-name and tampered-artifact branches are exercised, including by the rehearsal below.  |
| Dialog components (`transaction-mutation-dialog.tsx`, `edit-recurring-dialog.tsx`, `classification-list.tsx`, …) | 76–92 % lines                 | Transient submit and error states whose remaining branches are covered end to end rather than in isolation.                                            |

No unreachable or dead code was found, and no code was excluded from the
measurement.

## Performance

`npm run benchmark:release-readiness` on the hardware above, with 100,000
fictional transactions and 20,000 tag associations:

| Metric                         | Observed | Objective |
| ------------------------------ | -------- | --------- |
| History pagination p95         | 54.81 ms | < 500 ms  |
| Manual write p95               | 0.72 ms  | < 800 ms  |
| Recurrence materialisation p95 | 2.94 ms  | < 800 ms  |

The pagination query used the covering index
`transaction_workspace_pagination_idx`. These are repository-level figures on
this host, not an end-to-end measurement over the owner's private network,
which stays an external validation.

## Backup and restore rehearsal

Run against a disposable, freshly migrated database in a temporary directory,
with a throwaway key and a `file://` destination. No personal or demo data was
involved and no live database was replaced.

| Step                                         | Result                                                       |
| -------------------------------------------- | ------------------------------------------------------------ |
| `npm run db:migrate` on a new database       | Workspace initialised                                        |
| `npm run backup:run`                         | Encrypted artifact written, 184,356 bytes, 1 kept, 0 removed |
| `npm run restore:verify <artifact>`          | Verified; migrations applied to the restored copy: 0         |
| `npm run restore:verify <tampered artifact>` | Refused with `decryptFailed`                                 |
| Live database after the rehearsal            | Unchanged                                                    |

## Release criteria

| Criterion                                       | Status                                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| F-01 to F-15 accepted                           | Every requirement is mapped above to unit, integration and end-to-end tests, all green                         |
| Critical suite green, mobile and desktop review | Chromium and Firefox 35/35, including 320 px, 200 % zoom and mobile viewport specs; WebKit not executable here |
| Performance objectives                          | Met on the identified hardware; the private-network measurement is pending                                     |
| No known exploitable critical vulnerability     | 0 critical and 0 high advisories; 4 moderate development-only advisories documented above                      |
| Private access verified                         | Verified at the repository contract level; a real device test on the private network is pending                |
| Backup restored successfully                    | Verified on a disposable database; a rehearsal on the deployment host is pending                               |

## Outstanding external validations

These cannot be produced from this repository and are reported as pending, not
as met:

1. WebKit and a real iOS or macOS Safari device.
2. The owner's timed mobile entry measurement and the month of real use.
3. A private-network access test from the owner's devices.
4. A restore rehearsal on the actual deployment host.
5. The owner's decision on requiring the `End-to-end` check in the `main`
   ruleset, and on the scheduled cross-browser run.
