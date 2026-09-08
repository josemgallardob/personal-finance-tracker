/**
 * Upgrade path of the integer amount rule.
 *
 * A database created before `0002_require_integer_amount_minor` stores amounts
 * in a column whose INTEGER affinity keeps a fractional value as REAL, so the
 * original range check accepted 12.5 cents. These tests build such a database
 * from the committed 0000 and 0001 files, apply the real migration folder on
 * top and check that the upgraded file rejects fractional amounts while its
 * rows, associations and indexes survive.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_TRANSACTION_MINOR,
  MIN_TRANSACTION_MINOR,
} from "../../../src/shared/domain/money";
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
  COMMITTED_MIGRATION_TAGS,
  createTemporaryMigrationFolder,
  writeMigrationJournal,
} from "../helpers/migrations";
import {
  createTemporarySqliteFile,
  createValidAppEnv,
} from "../helpers/sqlite";

/** Migrations that existed before the integer amount rule. */
const MIGRATIONS_BEFORE_UPGRADE = [
  "0000_workspace_and_preference",
  "0001_classification_and_transactions",
] as const;

/** Tag of the migration under test. */
const AMOUNT_UPGRADE_TAG = "0002_require_integer_amount_minor";

/** Files the upgrade applies, starting with the migration under test. */
const MIGRATIONS_FROM_UPGRADE = COMMITTED_MIGRATION_TAGS.filter(
  (tag) => !(MIGRATIONS_BEFORE_UPGRADE as readonly string[]).includes(tag),
);

const NOW = 1_746_268_800_000;
const WORKSPACE_ID = "workspace-personal";

const cleanups: Array<{ cleanup(): void }> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.cleanup();
  }
});

/**
 * Opens an isolated file that only has the migrations released before the
 * integer amount rule, copied byte for byte so their committed hashes match.
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

  const config = loadAppConfig(createValidAppEnv(file.filePath));

  if (!config.ok) {
    throw new Error(`Expected valid configuration: ${JSON.stringify(config)}`);
  }

  const opened = openSqliteConnection(config.value);

  if (!opened.ok) {
    throw new Error(`Expected an open connection: ${JSON.stringify(opened)}`);
  }

  cleanups.push({ cleanup: () => opened.value.close() });

  const migrated = applyMigrations(opened.value, folder.folder);

  if (!migrated.ok) {
    throw new Error(`Expected the old schema: ${JSON.stringify(migrated)}`);
  }

  expect(migrated.value.applied).toEqual([...MIGRATIONS_BEFORE_UPGRADE]);

  seedWorkspaceAndCategory(opened.value);

  return opened.value;
}

function seedWorkspaceAndCategory(connection: SqliteConnection): void {
  connection.sqlite
    .prepare("INSERT INTO workspace (id, kind, created_at) VALUES (?, ?, ?)")
    .run(WORKSPACE_ID, "personal", NOW);
  connection.sqlite
    .prepare(
      `INSERT INTO category (
         id, workspace_id, name, normalized_name, type, sort_order
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "cat-expense",
      WORKSPACE_ID,
      "Supermercado",
      "supermercado",
      "expense",
      0,
    );
}

function insertTransaction(
  connection: SqliteConnection,
  id: string,
  amountMinor: number | string,
  date = "2026-09-06",
): void {
  connection.sqlite
    .prepare(
      `INSERT INTO "transaction" (
         id, workspace_id, type, amount_minor, date, category_id,
         concept, note, created_at, updated_at
       ) VALUES (?, ?, 'expense', ?, ?, 'cat-expense', ?, NULL, ?, ?)`,
    )
    .run(id, WORKSPACE_ID, amountMinor, date, `concepto ${id}`, NOW, NOW);
}

function readAmounts(connection: SqliteConnection) {
  return connection.sqlite
    .prepare(
      `SELECT id, amount_minor AS amountMinor, typeof(amount_minor) AS storedType
       FROM "transaction" ORDER BY id`,
    )
    .all() as Array<{ id: string; amountMinor: number; storedType: string }>;
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

describe("integer amount upgrade", () => {
  it("accepted a fractional amount before the upgrade", () => {
    const connection = openDatabaseBeforeUpgrade();

    insertTransaction(connection, "tx-fractional", 12.5);

    expect(readAmounts(connection)).toEqual([
      { id: "tx-fractional", amountMinor: 12.5, storedType: "real" },
    ]);
  });

  it("keeps rows, tag associations and indexes while adding the rule", () => {
    const connection = openDatabaseBeforeUpgrade();

    insertTransaction(connection, "tx-min", MIN_TRANSACTION_MINOR);
    insertTransaction(connection, "tx-max", MAX_TRANSACTION_MINOR);
    connection.sqlite
      .prepare(
        `INSERT INTO tag (id, workspace_id, name, normalized_name)
         VALUES ('tag-home', ?, 'Casa', 'casa')`,
      )
      .run(WORKSPACE_ID);
    connection.sqlite
      .prepare(
        `INSERT INTO transaction_tag (transaction_id, tag_id, workspace_id)
         VALUES (?, 'tag-home', ?)`,
      )
      .run("tx-min", WORKSPACE_ID);
    connection.sqlite
      .prepare(
        `INSERT INTO transaction_tag (transaction_id, tag_id, workspace_id)
         VALUES (?, 'tag-home', ?)`,
      )
      .run("tx-max", WORKSPACE_ID);

    const migrated = upgrade(connection);

    expect(migrated.ok).toBe(true);
    expect(migrated.ok && migrated.value.applied).toEqual([
      ...MIGRATIONS_FROM_UPGRADE,
    ]);
    expect(migrated.ok && migrated.value.skipped).toEqual([
      ...MIGRATIONS_BEFORE_UPGRADE,
    ]);

    expect(readAmounts(connection)).toEqual([
      {
        id: "tx-max",
        amountMinor: MAX_TRANSACTION_MINOR,
        storedType: "integer",
      },
      {
        id: "tx-min",
        amountMinor: MIN_TRANSACTION_MINOR,
        storedType: "integer",
      },
    ]);
    expect(
      connection.sqlite
        .prepare(
          `SELECT transaction_id AS transactionId, tag_id AS tagId
           FROM transaction_tag ORDER BY transaction_id`,
        )
        .all(),
    ).toEqual([
      { transactionId: "tx-max", tagId: "tag-home" },
      { transactionId: "tx-min", tagId: "tag-home" },
    ]);
    expect(
      (
        connection.sqlite
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'index' AND tbl_name IN ('transaction', 'transaction_tag')
               AND sql IS NOT NULL
             ORDER BY name`,
          )
          .all() as Array<{ name: string }>
      ).map((row) => row.name),
    ).toEqual([
      "transaction_category_date_idx",
      "transaction_id_workspace_unique",
      "transaction_tag_tag_transaction_idx",
      "transaction_workspace_date_idx",
      "transaction_workspace_type_date_idx",
    ]);
    expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("rejects fractional amounts on insert and update after the upgrade", () => {
    const connection = openDatabaseBeforeUpgrade();
    insertTransaction(connection, "tx-min", MIN_TRANSACTION_MINOR);

    expect(upgrade(connection).ok).toBe(true);

    expect(() => insertTransaction(connection, "tx-real", 12.5)).toThrow(
      /CHECK constraint failed: transaction_amount_minor_is_accepted/,
    );
    expect(() => insertTransaction(connection, "tx-text", "12.5")).toThrow(
      /CHECK constraint failed: transaction_amount_minor_is_accepted/,
    );
    expect(() =>
      connection.sqlite
        .prepare(`UPDATE "transaction" SET amount_minor = 7.25 WHERE id = ?`)
        .run("tx-min"),
    ).toThrow(/CHECK constraint failed: transaction_amount_minor_is_accepted/);

    expect(readAmounts(connection)).toEqual([
      {
        id: "tx-min",
        amountMinor: MIN_TRANSACTION_MINOR,
        storedType: "integer",
      },
    ]);
  });

  it("still cascades only tag associations after the rebuilt table", () => {
    const connection = openDatabaseBeforeUpgrade();
    insertTransaction(connection, "tx-min", MIN_TRANSACTION_MINOR);
    connection.sqlite
      .prepare(
        `INSERT INTO tag (id, workspace_id, name, normalized_name)
         VALUES ('tag-home', ?, 'Casa', 'casa')`,
      )
      .run(WORKSPACE_ID);
    connection.sqlite
      .prepare(
        `INSERT INTO transaction_tag (transaction_id, tag_id, workspace_id)
         VALUES ('tx-min', 'tag-home', ?)`,
      )
      .run(WORKSPACE_ID);

    expect(upgrade(connection).ok).toBe(true);

    connection.sqlite
      .prepare(`DELETE FROM "transaction" WHERE id = 'tx-min'`)
      .run();

    expect(
      connection.sqlite
        .prepare("SELECT COUNT(*) AS total FROM transaction_tag")
        .get(),
    ).toEqual({ total: 0 });
    expect(
      connection.sqlite.prepare("SELECT COUNT(*) AS total FROM tag").get(),
    ).toEqual({ total: 1 });
  });

  it("refuses to upgrade a database that already stores a fractional amount", () => {
    const connection = openDatabaseBeforeUpgrade();
    insertTransaction(connection, "tx-fractional", 12.5);

    const migrated = upgrade(connection);

    expect(migrated).toEqual({
      ok: false,
      error: {
        code: "migrationFailed",
        tag: AMOUNT_UPGRADE_TAG,
        cause: expect.stringContaining(
          "CHECK constraint failed: transaction_amount_minor_is_accepted",
        ),
      },
    });
    expect(readAmounts(connection)).toEqual([
      { id: "tx-fractional", amountMinor: 12.5, storedType: "real" },
    ]);
    expect(appliedTags(connection)).toEqual([...MIGRATIONS_BEFORE_UPGRADE]);
    expect(
      connection.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '\\_\\_%' ESCAPE '\\'",
        )
        .all(),
    ).toEqual([]);
  });
});
