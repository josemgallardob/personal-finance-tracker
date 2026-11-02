/**
 * Reproducible release-readiness benchmark using a fictional SQLite dataset.
 *
 * It is intentionally an executable benchmark instead of a Vitest assertion:
 * latency varies with the identified machine, while correctness and query-plan
 * assertions make an invalid benchmark fail deterministically.
 */

import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import type Database from "better-sqlite3";

import { createListTransactions } from "../../src/modules/transactions/application/list-transactions";
import {
  autocommitUnitOfWork,
  runInTransaction,
} from "../../src/modules/transactions/infrastructure/sqlite-unit-of-work";
import { sqliteTransactionQuery } from "../../src/modules/transactions/infrastructure/sqlite-list-transactions-query";
import { sqliteTransactionRepository } from "../../src/modules/transactions/infrastructure/sqlite-transaction-repository";
import { createGenerateDueOccurrences } from "../../src/modules/recurring/application/generate-due-occurrences";
import { createCategory } from "../../src/modules/classification/domain/category";
import {
  sqliteDueDateRunner,
  type SqliteUnitOfWork,
} from "../../src/modules/recurring/infrastructure/sqlite-unit-of-work";
import { sqliteRecurringOccurrenceRepository } from "../../src/modules/recurring/infrastructure/sqlite-recurring-occurrence-repository";
import { sqliteRecurringRuleRepository } from "../../src/modules/recurring/infrastructure/sqlite-recurring-rule-repository";
import { createTransaction } from "../../src/modules/transactions/domain/transaction";
import { FixedClock } from "../../src/shared/domain/clock";
import type { LocalDate } from "../../src/shared/domain/dates";
import { loadAppConfig } from "../../src/shared/server/config";
import {
  openSqliteConnection,
  type SqliteConnection,
} from "../../src/shared/server/database";
import { initializeDatabase } from "../../src/shared/server/initialize";

const DATASET_SIZE = 100_000;
const PAGE_SIZE = 100;
const PAGINATION_PASSES = 3;
const WRITE_SAMPLES = 40;
const DAY_MS = 86_400_000;
const START_DATE_MS = Date.UTC(2022, 0, 1);
const NOW = 1_767_225_600_000;

interface BenchmarkResult {
  readonly hardware: {
    readonly platform: string;
    readonly release: string;
    readonly arch: string;
    readonly cpuModel: string;
    readonly cpuCores: number;
    readonly memoryGiB: number;
    readonly node: string;
    readonly sqlite: string;
  };
  readonly dataset: {
    readonly transactions: number;
    readonly transactionTags: number;
    readonly paginationPasses: number;
    readonly pageSize: number;
    readonly writeSamplesPerKind: number;
  };
  readonly queryPlans: readonly string[];
  readonly timingsMs: {
    readonly paginationP95: number;
    readonly manualWriteP95: number;
    readonly recurrenceWriteP95: number;
    readonly writeP95: number;
  };
}

function validEnvironment(databasePath: string): Record<string, string> {
  return {
    DATABASE_PATH: databasePath,
    APP_URL: "http://127.0.0.1:3000",
    TZ: "Europe/Madrid",
  };
}

function localDate(index: number): string {
  return new Date(START_DATE_MS + (index % 1_461) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}

function elapsed<TValue>(work: () => TValue): {
  value: TValue;
  milliseconds: number;
} {
  const start = performance.now();
  const value = work();
  return { value, milliseconds: performance.now() - start };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function run(): BenchmarkResult {
  const databasePath = path.join(
    tmpdir(),
    `finance-qa-02-${randomUUID()}.sqlite`,
  );
  const config = loadAppConfig(validEnvironment(databasePath));
  assert(config.ok, "benchmark configuration must be valid");

  const opened = openSqliteConnection(config.value);
  assert(opened.ok, "benchmark database must open");
  const connection = opened.value;

  try {
    const initialized = initializeDatabase(connection, {
      now: () => NOW,
      seedCategories: false,
    });
    assert(initialized.ok, "benchmark database must initialize");
    const workspaceId = initialized.value.workspaceId;
    seedFictionalDataset(connection.sqlite, workspaceId);

    const original = connection.sqlite
      .prepare(
        'SELECT COUNT(*) AS count, COALESCE(SUM(amount_minor), 0) AS total FROM "transaction" WHERE workspace_id = ?',
      )
      .get(workspaceId) as { count: number; total: number };
    assert(
      original.count === DATASET_SIZE,
      "seed must contain 100000 transactions",
    );

    const queryPlans = inspectQueryPlans(connection.sqlite, workspaceId);
    const paginationP95 = benchmarkPagination(
      connection,
      workspaceId,
      original.count,
    );
    const manualWriteP95 = benchmarkManualWrites(connection, workspaceId);
    const recurrenceWriteP95 = benchmarkRecurrenceWrites(
      connection,
      workspaceId,
    );

    const final = connection.sqlite
      .prepare(
        'SELECT COUNT(*) AS count, COALESCE(SUM(amount_minor), 0) AS total FROM "transaction" WHERE workspace_id = ?',
      )
      .get(workspaceId) as { count: number; total: number };
    assert(
      final.count === DATASET_SIZE + WRITE_SAMPLES * 2,
      "benchmark writes must create their expected transaction count",
    );
    assert(
      final.total > original.total,
      "benchmark writes must preserve positive totals",
    );

    const tagCount = (
      connection.sqlite
        .prepare("SELECT COUNT(*) AS count FROM transaction_tag")
        .get() as { count: number }
    ).count;
    const cpu = os.cpus()[0];

    return {
      hardware: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        cpuModel: cpu?.model ?? "unknown",
        cpuCores: os.cpus().length,
        memoryGiB: Number((os.totalmem() / 1024 ** 3).toFixed(2)),
        node: process.version,
        sqlite: String(
          (
            connection.sqlite
              .prepare("SELECT sqlite_version() AS version")
              .get() as { version: string }
          ).version,
        ),
      },
      dataset: {
        transactions: DATASET_SIZE,
        transactionTags: tagCount,
        paginationPasses: PAGINATION_PASSES,
        pageSize: PAGE_SIZE,
        writeSamplesPerKind: WRITE_SAMPLES,
      },
      queryPlans,
      timingsMs: {
        paginationP95,
        manualWriteP95,
        recurrenceWriteP95,
        writeP95: Math.max(manualWriteP95, recurrenceWriteP95),
      },
    };
  } finally {
    connection.close();
    rmSync(databasePath, { force: true });
    rmSync(`${databasePath}-wal`, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
  }
}

function seedFictionalDataset(
  sqlite: Database.Database,
  workspaceId: string,
): void {
  sqlite
    .prepare(
      "INSERT INTO category (id, workspace_id, name, normalized_name, type, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      "expense-category",
      workspaceId,
      "Fictional expenses",
      "fictional expenses",
      "expense",
      0,
    );
  sqlite
    .prepare(
      "INSERT INTO tag (id, workspace_id, name, normalized_name) VALUES (?, ?, ?, ?)",
    )
    .run("fictional-tag", workspaceId, "Fictional tag", "fictional tag");

  const insertTransaction = sqlite.prepare(
    'INSERT INTO "transaction" (id, workspace_id, type, amount_minor, date, category_id, concept, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertTag = sqlite.prepare(
    "INSERT INTO transaction_tag (transaction_id, tag_id, workspace_id) VALUES (?, ?, ?)",
  );
  const seed = sqlite.transaction(() => {
    for (let index = 0; index < DATASET_SIZE; index += 1) {
      const id = `fictional-${String(index).padStart(6, "0")}`;
      insertTransaction.run(
        id,
        workspaceId,
        "expense",
        100 + (index % 50_000),
        localDate(index),
        "expense-category",
        `Fictional transaction ${index}`,
        index % 7 === 0 ? "Fictional note" : null,
        NOW - index,
        NOW - index,
      );
      if (index % 5 === 0) {
        insertTag.run(id, "fictional-tag", workspaceId);
      }
    }
  });
  seed();
}

function inspectQueryPlans(
  sqlite: Database.Database,
  workspaceId: string,
): string[] {
  const rows = sqlite
    .prepare(
      'EXPLAIN QUERY PLAN SELECT id FROM "transaction" WHERE workspace_id = ? ORDER BY date DESC, created_at DESC, id DESC LIMIT ?',
    )
    .all(workspaceId, PAGE_SIZE + 1) as Array<{ detail: string }>;
  const details = rows.map((row) => row.detail);
  assert(
    details.some((detail) =>
      detail.includes("transaction_workspace_pagination_idx"),
    ),
    "pagination must use the composite pagination index",
  );
  assert(
    details.every(
      (detail) =>
        !detail.includes("TEMP B-TREE") &&
        !detail.startsWith("SCAN transaction"),
    ),
    "pagination must not sort a temporary full result or scan the transaction table",
  );
  return details;
}

function benchmarkPagination(
  connection: SqliteConnection,
  workspaceId: string,
  expectedCount: number,
): number {
  const list = createListTransactions({ query: sqliteTransactionQuery });
  const samples: number[] = [];

  for (let pass = 0; pass < PAGINATION_PASSES; pass += 1) {
    let cursor: string | undefined;
    const ids = new Set<string>();
    do {
      const timed = elapsed(() =>
        list.execute(autocommitUnitOfWork(connection), {
          workspaceId,
          limit: PAGE_SIZE,
          cursor,
        }),
      );
      assert(timed.value.ok, "every page must succeed");
      samples.push(timed.milliseconds);
      for (const item of timed.value.value.items) {
        assert(
          !ids.has(item.id),
          "pagination must not duplicate a transaction",
        );
        ids.add(item.id);
      }
      cursor = timed.value.value.nextCursor ?? undefined;
    } while (cursor !== undefined);
    assert(
      ids.size === expectedCount,
      "pagination must not skip a transaction",
    );
  }

  return percentile95(samples);
}

function benchmarkManualWrites(
  connection: SqliteConnection,
  workspaceId: string,
): number {
  const category = createCategory({
    id: "expense-category",
    name: "Fictional expenses",
    type: "expense",
    sortOrder: 0,
    archivedAt: null,
  });
  assert(category.ok, "manual write category must be valid");
  const samples: number[] = [];
  for (let index = 0; index < WRITE_SAMPLES; index += 1) {
    const built = createTransaction({
      id: `manual-benchmark-${index}`,
      type: "expense",
      amountMinor: 100,
      date: "2026-12-01",
      category: category.value,
      concept: "Fictional benchmark write",
      note: null,
      tagIds: [],
      createdAt: NOW + index,
      updatedAt: NOW + index,
    });
    assert(built.ok, "manual benchmark transaction must be valid");
    const timed = elapsed(() =>
      runInTransaction(connection, (unit) =>
        sqliteTransactionRepository.insertTransaction(unit, {
          workspaceId,
          transaction: built.value,
        }),
      ),
    );
    assert(timed.value.ok, "manual benchmark write must succeed");
    samples.push(timed.milliseconds);
  }
  return percentile95(samples);
}

function benchmarkRecurrenceWrites(
  connection: SqliteConnection,
  workspaceId: string,
): number {
  connection.sqlite
    .prepare(
      "INSERT INTO recurring_rule (id, workspace_id, type, amount_minor, category_id, monthly_day, next_due_date, template_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      "benchmark-rule",
      workspaceId,
      "expense",
      100,
      "expense-category",
      1,
      "2026-01-01",
      1,
      NOW,
      NOW,
    );

  const samples: number[] = [];
  for (let index = 0; index < WRITE_SAMPLES; index += 1) {
    const dueDate = new Date(Date.UTC(2026, 0, index + 1))
      .toISOString()
      .slice(0, 10) as LocalDate;
    connection.sqlite
      .prepare("UPDATE recurring_rule SET next_due_date = ? WHERE id = ?")
      .run(dueDate, "benchmark-rule");
    const generator = createGenerateDueOccurrences<SqliteUnitOfWork>({
      runner: sqliteDueDateRunner(connection),
      rules: sqliteRecurringRuleRepository,
      occurrences: sqliteRecurringOccurrenceRepository,
      transactions: sqliteTransactionRepository,
      clock: new FixedClock(dueDate),
      createId: (() => {
        let id = 0;
        return () => `recurrence-benchmark-${index}-${++id}`;
      })(),
      now: () => NOW + index,
    });
    const timed = elapsed(() => generator.execute({ workspaceId }));
    assert(timed.value.ok, "recurrence benchmark write must succeed");
    assert(
      timed.value.value.generated.length === 1 &&
        timed.value.value.failed.length === 0,
      "each recurrence sample must materialize exactly one due date",
    );
    samples.push(timed.milliseconds);
  }
  return percentile95(samples);
}

console.log(JSON.stringify(run(), null, 2));
