import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolvePersonalWorkspace } from "../../src/modules/preferences/server/workspace";
import { loadAppConfig } from "../../src/shared/server/config";
import {
  closeSqliteConnection,
  openSqliteConnection,
} from "../../src/shared/server/database";
import { initializeDatabase } from "../../src/shared/server/initialize";
import {
  DEFAULT_MIGRATIONS_FOLDER,
  SCHEMA_MIGRATION_TABLE,
  applyMigrations,
} from "../../src/shared/server/migrate";
import {
  COMMITTED_MIGRATION_TAGS,
  createTemporaryMigrationFolder,
  writeMigrationJournal,
} from "./helpers/migrations";
import { createTemporarySqliteFile, createValidAppEnv } from "./helpers/sqlite";

const cleanups: Array<{ cleanup(): void }> = [];

afterEach(() => {
  closeSqliteConnection();

  while (cleanups.length > 0) {
    cleanups.pop()?.cleanup();
  }
});

function temporarySqliteFile() {
  const file = createTemporarySqliteFile();
  cleanups.push(file);
  return file;
}

function temporaryMigrationFolder() {
  const folder = createTemporaryMigrationFolder();
  cleanups.push(folder);
  return folder;
}

function requireOpen(filePath: string) {
  const config = loadAppConfig(createValidAppEnv(filePath));

  if (!config.ok) {
    throw new Error(`Expected valid configuration: ${JSON.stringify(config)}`);
  }

  const opened = openSqliteConnection(config.value);

  if (!opened.ok) {
    throw new Error(`Expected an open connection: ${JSON.stringify(opened)}`);
  }

  return opened.value;
}

function recordedTags(connection: ReturnType<typeof requireOpen>): string[] {
  return connection.sqlite
    .prepare(`SELECT tag FROM ${SCHEMA_MIGRATION_TABLE} ORDER BY applied_at`)
    .all()
    .map((row) => (row as { tag: string }).tag);
}

function recordedLedger(connection: ReturnType<typeof requireOpen>) {
  return connection.sqlite
    .prepare(
      `SELECT tag, hash FROM ${SCHEMA_MIGRATION_TABLE} ORDER BY applied_at`,
    )
    .all() as Array<{ tag: string; hash: string }>;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("applyMigrations", () => {
  it("applies the committed journal to a fresh database", () => {
    const { filePath } = temporarySqliteFile();
    const connection = requireOpen(filePath);
    const result = applyMigrations(connection);

    expect(result).toEqual({
      ok: true,
      value: {
        applied: [...COMMITTED_MIGRATION_TAGS],
        skipped: [],
      },
    });
    expect(recordedTags(connection)).toEqual([...COMMITTED_MIGRATION_TAGS]);
    expect(
      connection.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('workspace', 'category', 'tag', 'transaction', 'transaction_tag') ORDER BY name",
        )
        .all(),
    ).toEqual([
      { name: "category" },
      { name: "tag" },
      { name: "transaction" },
      { name: "transaction_tag" },
      { name: "workspace" },
    ]);
    connection.close();
  });

  it("skips already applied files after a restart when the hash matches", () => {
    const { filePath } = temporarySqliteFile();
    const hashes = COMMITTED_MIGRATION_TAGS.map((tag) => ({
      tag,
      hash: sha256(
        readFileSync(join(DEFAULT_MIGRATIONS_FOLDER, `${tag}.sql`), "utf8"),
      ),
    }));
    const first = requireOpen(filePath);
    expect(applyMigrations(first).ok).toBe(true);
    first.close();

    const second = requireOpen(filePath);
    const result = applyMigrations(second);

    expect(result).toEqual({
      ok: true,
      value: {
        applied: [],
        skipped: [...COMMITTED_MIGRATION_TAGS],
      },
    });
    expect(recordedLedger(second)).toEqual(hashes);
    second.close();
  });

  it("rejects a changed applied file without touching schema, data or ledger", () => {
    const { folder } = temporaryMigrationFolder();
    const originalSql = `CREATE TABLE probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL);
--> statement-breakpoint
INSERT INTO probe (id, label) VALUES (1, 'original');`;
    writeMigrationJournal(folder, [{ tag: "0000_ok", sql: originalSql }]);

    const { filePath } = temporarySqliteFile();
    const first = requireOpen(filePath);
    expect(applyMigrations(first, folder)).toEqual({
      ok: true,
      value: { applied: ["0000_ok"], skipped: [] },
    });
    const ledger = recordedLedger(first);
    first.close();

    writeFileSync(
      join(folder, "0000_ok.sql"),
      `${originalSql}
--> statement-breakpoint
CREATE TABLE rewritten (id INTEGER PRIMARY KEY);`,
    );

    const second = requireOpen(filePath);
    const result = applyMigrations(second, folder);

    expect(result).toEqual({
      ok: false,
      error: { code: "checksumMismatch", tag: "0000_ok" },
    });
    expect(recordedLedger(second)).toEqual(ledger);
    expect(second.sqlite.prepare("SELECT id, label FROM probe").all()).toEqual([
      { id: 1, label: "original" },
    ]);
    expect(
      second.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rewritten'",
        )
        .get(),
    ).toBeUndefined();
    second.close();
  });

  it("stops initializeDatabase before bootstrap when an applied file changes", () => {
    const { folder } = temporaryMigrationFolder();
    writeMigrationJournal(folder, [
      {
        tag: "0000_ok",
        sql: "CREATE TABLE probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL);",
      },
    ]);

    const { filePath } = temporarySqliteFile();
    const first = requireOpen(filePath);
    expect(applyMigrations(first, folder).ok).toBe(true);
    first.close();

    writeFileSync(
      join(folder, "0000_ok.sql"),
      "CREATE TABLE probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL, extra TEXT);",
    );

    const second = requireOpen(filePath);
    const result = initializeDatabase(second, { migrationsFolder: folder });

    expect(result).toEqual({
      ok: false,
      error: { code: "checksumMismatch", tag: "0000_ok" },
    });
    expect(resolvePersonalWorkspace(second)).toEqual({
      ok: false,
      error: { code: "workspaceNotFound" },
    });
    expect(recordedTags(second)).toEqual(["0000_ok"]);
    second.close();
  });

  it("does not mark a failed file successful and rolls it back", () => {
    const { folder } = temporaryMigrationFolder();
    writeMigrationJournal(folder, [
      {
        tag: "0000_ok",
        sql: "CREATE TABLE probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL);",
      },
      {
        tag: "0001_fail",
        sql: `CREATE TABLE should_not_remain (id INTEGER PRIMARY KEY);
--> statement-breakpoint
INSERT INTO probe (id, label) VALUES (1, 'kept only if this file succeeds');
--> statement-breakpoint
INSERT INTO probe (id, label) VALUES (1, 'duplicate primary key');`,
      },
    ]);

    const { filePath } = temporarySqliteFile();
    const connection = requireOpen(filePath);
    const result = applyMigrations(connection, folder);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("migrationFailed");
    expect(result.error.tag).toBe("0001_fail");
    expect(result.error.cause).toMatch(/UNIQUE|constraint/i);
    expect(recordedTags(connection)).toEqual(["0000_ok"]);
    expect(
      connection.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_not_remain'",
        )
        .get(),
    ).toBeUndefined();
    expect(
      connection.sqlite.prepare("SELECT COUNT(*) AS count FROM probe").get(),
    ).toEqual({ count: 0 });
    connection.close();
  });

  it("rejects a missing journal without creating application tables", () => {
    const { folder } = temporaryMigrationFolder();
    const { filePath } = temporarySqliteFile();
    const connection = requireOpen(filePath);
    const result = applyMigrations(connection, folder);

    expect(result).toEqual({
      ok: false,
      error: { code: "journalMissing" },
    });
    expect(
      connection.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspace'",
        )
        .get(),
    ).toBeUndefined();
    connection.close();
  });

  it("rejects an invalid journal", () => {
    const { folder } = temporaryMigrationFolder();
    writeFileSync(join(folder, "meta/_journal.json"), "{ not-json");
    const { filePath } = temporarySqliteFile();
    const connection = requireOpen(filePath);

    expect(applyMigrations(connection, folder)).toEqual({
      ok: false,
      error: { code: "invalidJournal" },
    });
    connection.close();
  });

  it("rejects a journal that names a missing SQL file", () => {
    const { folder } = temporaryMigrationFolder();
    writeMigrationJournal(folder, [{ tag: "0000_missing", sql: "" }]);
    writeFileSync(join(folder, "0000_missing.sql"), "");
    const journal = join(folder, "meta/_journal.json");
    writeFileSync(
      journal,
      JSON.stringify({
        entries: [{ tag: "0000_missing" }, { tag: "0001_absent" }],
      }),
    );

    const { filePath } = temporarySqliteFile();
    const connection = requireOpen(filePath);
    const result = applyMigrations(connection, folder);

    expect(result).toEqual({
      ok: false,
      error: { code: "migrationFileMissing", tag: "0001_absent" },
    });
    expect(recordedTags(connection)).toEqual(["0000_missing"]);
    connection.close();
  });

  it("accepts an empty journal without applying files", () => {
    const { folder } = temporaryMigrationFolder();
    writeFileSync(
      join(folder, "meta/_journal.json"),
      JSON.stringify({ entries: [] }),
    );
    const { filePath } = temporarySqliteFile();
    const connection = requireOpen(filePath);

    expect(applyMigrations(connection, folder)).toEqual({
      ok: true,
      value: { applied: [], skipped: [] },
    });
    connection.close();
  });

  it.each([
    [{ entries: [{ when: 1 }] }],
    [{ entries: [{ tag: "" }] }],
    [{ entries: "nope" }],
    [[]],
    [null],
  ])("rejects the invalid journal %o", (body) => {
    const { folder } = temporaryMigrationFolder();
    writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify(body));
    const { filePath } = temporarySqliteFile();
    const connection = requireOpen(filePath);

    expect(applyMigrations(connection, folder)).toEqual({
      ok: false,
      error: { code: "invalidJournal" },
    });
    connection.close();
  });
});

describe("request and build isolation", () => {
  it("does not migrate when a connection is opened", () => {
    const { filePath } = temporarySqliteFile();
    const connection = requireOpen(filePath);

    expect(
      connection.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('workspace', 'schema_migration')",
        )
        .all(),
    ).toEqual([]);
    connection.close();
  });

  it("does not open a database while resolving the default migrations folder", () => {
    const { filePath } = temporarySqliteFile();

    expect(DEFAULT_MIGRATIONS_FOLDER.endsWith("/db/migrations")).toBe(true);
    expect(existsSync(filePath)).toBe(false);
  });
});
