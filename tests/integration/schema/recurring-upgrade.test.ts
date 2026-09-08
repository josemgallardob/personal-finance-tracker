/**
 * Upgrade path of the monthly recurrence tables.
 *
 * A database created before `0003_recurring_rules_and_occurrences` already
 * holds movements and tag associations. These tests build such a file from the
 * committed 0000, 0001 and 0002 files, apply the real migration folder on top
 * and check that the existing rows survive, that the new tables work against
 * them and that two connections racing on the same due date cannot both create
 * it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MAX_MONTHLY_DAY } from "../../../src/modules/recurring/domain/recurrence-calendar";
import { INITIAL_TEMPLATE_VERSION } from "../../../src/modules/recurring/domain/recurring-rule";
import { loadAppConfig } from "../../../src/shared/server/config";
import {
  openSqliteConnection,
  type SqliteConnection,
} from "../../../src/shared/server/database";
import {
  applyMigrations,
  DEFAULT_MIGRATIONS_FOLDER,
  SCHEMA_MIGRATION_TABLE,
} from "../../../src/shared/server/migrate";
import {
  createTemporaryMigrationFolder,
  writeMigrationJournal,
} from "../helpers/migrations";
import {
  createTemporarySqliteFile,
  createValidAppEnv,
} from "../helpers/sqlite";

/** Migrations that existed before the recurrence tables. */
const MIGRATIONS_BEFORE_UPGRADE = [
  "0000_workspace_and_preference",
  "0001_classification_and_transactions",
  "0002_require_integer_amount_minor",
] as const;

/** Tag of the migration under test. */
const RECURRING_UPGRADE_TAG = "0003_recurring_rules_and_occurrences";

const NOW = 1_746_268_800_000;
const WORKSPACE_ID = "workspace-personal";

const cleanups: Array<{ cleanup(): void }> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.cleanup();
  }
});

function openFile(filePath: string): SqliteConnection {
  const config = loadAppConfig(createValidAppEnv(filePath));

  if (!config.ok) {
    throw new Error(`Expected valid configuration: ${JSON.stringify(config)}`);
  }

  const opened = openSqliteConnection(config.value);

  if (!opened.ok) {
    throw new Error(`Expected an open connection: ${JSON.stringify(opened)}`);
  }

  cleanups.push({ cleanup: () => opened.value.close() });

  return opened.value;
}

/**
 * Opens an isolated file that only has the migrations released before the
 * recurrence tables, copied byte for byte so their committed hashes match.
 */
function openDatabaseBeforeUpgrade(): SqliteConnection {
  const file = createTemporarySqliteFile();
  cleanups.push(file);

  const folder = createTemporaryMigrationFolder();
  cleanups.push(folder);

  writeMigrationJournal(
    folder.folder,
    MIGRATIONS_BEFORE_UPGRADE.map((tag) => ({
      tag,
      sql: readFileSync(join(DEFAULT_MIGRATIONS_FOLDER, `${tag}.sql`), "utf8"),
    })),
  );

  const connection = openFile(file.filePath);
  const migrated = applyMigrations(connection, folder.folder);

  if (!migrated.ok) {
    throw new Error(`Expected the old schema: ${JSON.stringify(migrated)}`);
  }

  expect(migrated.value.applied).toEqual([...MIGRATIONS_BEFORE_UPGRADE]);

  seedExistingData(connection);

  return connection;
}

/** Writes the workspace, classification and movements of an existing file. */
function seedExistingData(connection: SqliteConnection): void {
  connection.sqlite
    .prepare("INSERT INTO workspace (id, kind, created_at) VALUES (?, ?, ?)")
    .run(WORKSPACE_ID, "personal", NOW);
  connection.sqlite
    .prepare(
      `INSERT INTO category (
         id, workspace_id, name, normalized_name, type, sort_order
       ) VALUES ('cat-expense', ?, 'Suscripciones', 'suscripciones', 'expense', 0)`,
    )
    .run(WORKSPACE_ID);
  connection.sqlite
    .prepare(
      `INSERT INTO tag (id, workspace_id, name, normalized_name)
       VALUES ('tag-home', ?, 'Casa', 'casa')`,
    )
    .run(WORKSPACE_ID);

  for (const id of ["tx-origin", "tx-other"]) {
    connection.sqlite
      .prepare(
        `INSERT INTO "transaction" (
           id, workspace_id, type, amount_minor, date, category_id,
           concept, note, created_at, updated_at
         ) VALUES (?, ?, 'expense', 1299, '2026-08-31', 'cat-expense',
                   'Suscripción', NULL, ?, ?)`,
      )
      .run(id, WORKSPACE_ID, NOW, NOW);
  }

  connection.sqlite
    .prepare(
      `INSERT INTO transaction_tag (transaction_id, tag_id, workspace_id)
       VALUES ('tx-origin', 'tag-home', ?)`,
    )
    .run(WORKSPACE_ID);
}

function tableNames(connection: SqliteConnection): string[] {
  return (
    connection.sqlite
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name IN ('recurring_rule', 'recurring_rule_tag', 'recurring_occurrence')
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

function appliedTags(connection: SqliteConnection): string[] {
  return (
    connection.sqlite
      .prepare(`SELECT tag FROM ${SCHEMA_MIGRATION_TABLE} ORDER BY tag`)
      .all() as Array<{ tag: string }>
  ).map((row) => row.tag);
}

function upgrade(connection: SqliteConnection) {
  return applyMigrations(connection, DEFAULT_MIGRATIONS_FOLDER);
}

function insertRule(
  connection: SqliteConnection,
  id: string,
  sourceTransactionId: string | null,
): void {
  connection.sqlite
    .prepare(
      `INSERT INTO recurring_rule (
         id, workspace_id, source_transaction_id, type, amount_minor,
         category_id, concept, note, monthly_day, next_due_date,
         template_version, deactivated_at, created_at, updated_at
       ) VALUES (?, ?, ?, 'expense', 1299, 'cat-expense', 'Suscripción', NULL,
                 ?, '2026-09-30', ?, NULL, ?, ?)`,
    )
    .run(
      id,
      WORKSPACE_ID,
      sourceTransactionId,
      MAX_MONTHLY_DAY,
      INITIAL_TEMPLATE_VERSION,
      NOW,
      NOW,
    );
}

function insertOccurrence(
  connection: SqliteConnection,
  id: string,
  scheduledFor: string,
  transactionId: string | null,
): void {
  connection.sqlite
    .prepare(
      `INSERT INTO recurring_occurrence (
         id, workspace_id, recurring_rule_id, scheduled_for, transaction_id,
         created_at
       ) VALUES (?, ?, 'rule-1', ?, ?, ?)`,
    )
    .run(id, WORKSPACE_ID, scheduledFor, transactionId, NOW);
}

describe("recurrence tables upgrade", () => {
  it("has no recurrence table before the upgrade", () => {
    const connection = openDatabaseBeforeUpgrade();

    expect(tableNames(connection)).toEqual([]);
    expect(appliedTags(connection)).toEqual([...MIGRATIONS_BEFORE_UPGRADE]);
  });

  it("adds the three tables while keeping movements and associations", () => {
    const connection = openDatabaseBeforeUpgrade();

    const migrated = upgrade(connection);

    expect(migrated.ok).toBe(true);
    expect(migrated.ok && migrated.value.applied).toEqual([
      RECURRING_UPGRADE_TAG,
    ]);
    expect(migrated.ok && migrated.value.skipped).toEqual([
      ...MIGRATIONS_BEFORE_UPGRADE,
    ]);
    expect(tableNames(connection)).toEqual([
      "recurring_occurrence",
      "recurring_rule",
      "recurring_rule_tag",
    ]);
    expect(
      connection.sqlite
        .prepare(`SELECT id FROM "transaction" ORDER BY id`)
        .all(),
    ).toEqual([{ id: "tx-origin" }, { id: "tx-other" }]);
    expect(
      connection.sqlite
        .prepare(
          `SELECT transaction_id AS transactionId, tag_id AS tagId
           FROM transaction_tag`,
        )
        .all(),
    ).toEqual([{ transactionId: "tx-origin", tagId: "tag-home" }]);
    expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("lets an existing movement become the origin of a rule", () => {
    const connection = openDatabaseBeforeUpgrade();
    expect(upgrade(connection).ok).toBe(true);

    insertRule(connection, "rule-1", "tx-origin");
    connection.sqlite
      .prepare(
        `INSERT INTO recurring_rule_tag (recurring_rule_id, tag_id, workspace_id)
         VALUES ('rule-1', 'tag-home', ?)`,
      )
      .run(WORKSPACE_ID);
    insertOccurrence(connection, "occ-1", "2026-08-31", "tx-other");

    expect(
      connection.sqlite
        .prepare(
          `SELECT source_transaction_id AS sourceTransactionId,
                  monthly_day AS monthlyDay
           FROM recurring_rule`,
        )
        .all(),
    ).toEqual([
      { sourceTransactionId: "tx-origin", monthlyDay: MAX_MONTHLY_DAY },
    ]);
    expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("keeps the upgraded file idempotent on a later run", () => {
    const connection = openDatabaseBeforeUpgrade();
    expect(upgrade(connection).ok).toBe(true);
    insertRule(connection, "rule-1", "tx-origin");

    const second = upgrade(connection);

    expect(second).toEqual({
      ok: true,
      value: {
        applied: [],
        skipped: [...MIGRATIONS_BEFORE_UPGRADE, RECURRING_UPGRADE_TAG],
      },
    });
    expect(
      connection.sqlite
        .prepare("SELECT COUNT(*) AS total FROM recurring_rule")
        .get(),
    ).toEqual({ total: 1 });
  });
});

describe("concurrent writers on the upgraded file", () => {
  it("lets only one connection create the same due date", () => {
    const first = openDatabaseBeforeUpgrade();
    expect(upgrade(first).ok).toBe(true);
    insertRule(first, "rule-1", "tx-origin");

    const second = openFile(first.filePath);

    insertOccurrence(first, "occ-first", "2026-08-31", "tx-origin");

    expect(() =>
      insertOccurrence(second, "occ-second", "2026-08-31", "tx-other"),
    ).toThrow(/UNIQUE constraint failed/);
    expect(
      second.sqlite
        .prepare(
          `SELECT id, transaction_id AS transactionId FROM recurring_occurrence`,
        )
        .all(),
    ).toEqual([{ id: "occ-first", transactionId: "tx-origin" }]);
  });

  it("sees the cleared link from the other connection after a deletion", () => {
    const first = openDatabaseBeforeUpgrade();
    expect(upgrade(first).ok).toBe(true);
    insertRule(first, "rule-1", "tx-origin");
    insertOccurrence(first, "occ-first", "2026-08-31", "tx-other");

    const second = openFile(first.filePath);
    second.sqlite
      .prepare(`DELETE FROM "transaction" WHERE id = ?`)
      .run("tx-other");

    expect(
      first.sqlite
        .prepare(
          `SELECT scheduled_for AS scheduledFor,
                  transaction_id AS transactionId
           FROM recurring_occurrence`,
        )
        .all(),
    ).toEqual([{ scheduledFor: "2026-08-31", transactionId: null }]);
    expect(first.sqlite.pragma("foreign_key_check")).toEqual([]);
  });
});
