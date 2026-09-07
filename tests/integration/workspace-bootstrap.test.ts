import { afterEach, describe, expect, it } from "vitest";

import {
  APPLICATION_CURRENCY,
  APPLICATION_LOCALE,
  PERSONAL_WORKSPACE_KIND,
} from "../../db/schema";
import { bootstrapPersonalWorkspace } from "../../src/modules/preferences/server/bootstrap";
import { resolvePersonalWorkspace } from "../../src/modules/preferences/server/workspace";
import { APPLICATION_TIME_ZONE } from "../../src/shared/domain/clock";
import { isIdentifier } from "../../src/shared/domain/text";
import { loadAppConfig } from "../../src/shared/server/config";
import {
  closeSqliteConnection,
  getSqliteConnection,
  openSqliteConnection,
} from "../../src/shared/server/database";
import { initializeDatabase } from "../../src/shared/server/initialize";
import { applyMigrations } from "../../src/shared/server/migrate";
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

describe("initializeDatabase", () => {
  it("migrates a fresh file and creates the personal workspace once", () => {
    const { filePath } = temporarySqliteFile();
    const connection = requireOpen(filePath);
    const createdAt = 1_746_268_800_000;
    const result = initializeDatabase(connection, { now: () => createdAt });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.applied).toEqual([...COMMITTED_MIGRATION_TAGS]);
    expect(result.value.skipped).toEqual([]);
    expect(result.value.createdWorkspace).toBe(true);
    expect(isIdentifier(result.value.workspaceId)).toBe(true);

    const resolved = resolvePersonalWorkspace(connection);
    expect(resolved).toEqual({
      ok: true,
      value: {
        id: result.value.workspaceId,
        kind: PERSONAL_WORKSPACE_KIND,
        locale: APPLICATION_LOCALE,
        currency: APPLICATION_CURRENCY,
        timeZone: APPLICATION_TIME_ZONE,
        createdAt,
      },
    });
    connection.close();
  });

  it("is safe to repeat after restart", () => {
    const { filePath } = temporarySqliteFile();
    const first = requireOpen(filePath);
    const created = initializeDatabase(first, { now: () => 100 });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    first.close();

    const second = requireOpen(filePath);
    const restarted = initializeDatabase(second, { now: () => 200 });

    expect(restarted).toEqual({
      ok: true,
      value: {
        applied: [],
        skipped: [...COMMITTED_MIGRATION_TAGS],
        workspaceId: created.value.workspaceId,
        createdWorkspace: false,
      },
    });
    expect(resolvePersonalWorkspace(second)).toEqual({
      ok: true,
      value: {
        id: created.value.workspaceId,
        kind: PERSONAL_WORKSPACE_KIND,
        locale: APPLICATION_LOCALE,
        currency: APPLICATION_CURRENCY,
        timeZone: APPLICATION_TIME_ZONE,
        createdAt: 100,
      },
    });
    second.close();
  });

  it("does not treat a bootstrap failure as a successful migration", () => {
    const { filePath } = temporarySqliteFile();
    const connection = requireOpen(filePath);
    const migrations = createTemporaryMigrationFolder();
    cleanups.push(migrations);
    writeMigrationJournal(migrations.folder, [
      {
        tag: "0000_unrelated",
        sql: "CREATE TABLE other (id INTEGER PRIMARY KEY);",
      },
    ]);

    const result = initializeDatabase(connection, {
      migrationsFolder: migrations.folder,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("bootstrapFailed");
    expect(
      connection.sqlite.prepare("SELECT tag FROM schema_migration").all(),
    ).toEqual([{ tag: "0000_unrelated" }]);
    connection.close();
  });

  it("does not bootstrap when a migration fails", () => {
    const { filePath } = temporarySqliteFile();
    const connection = requireOpen(filePath);
    const result = initializeDatabase(connection, {
      migrationsFolder: filePath,
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "journalMissing" },
    });
    expect(resolvePersonalWorkspace(connection)).toEqual({
      ok: false,
      error: { code: "workspaceNotFound" },
    });
    connection.close();
  });
});

describe("bootstrapPersonalWorkspace", () => {
  it("can use the machine clock when no timestamp source is passed", () => {
    const { filePath } = temporarySqliteFile();
    const connection = requireOpen(filePath);
    expect(applyMigrations(connection).ok).toBe(true);

    const before = Date.now();
    const result = bootstrapPersonalWorkspace(connection);
    const after = Date.now();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const resolved = resolvePersonalWorkspace(connection);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value.createdAt).toBeGreaterThanOrEqual(before);
      expect(resolved.value.createdAt).toBeLessThanOrEqual(after);
    }
    connection.close();
  });

  it("returns a controlled error when preference insert cannot finish", () => {
    const { filePath } = temporarySqliteFile();
    const connection = requireOpen(filePath);
    const migrations = createTemporaryMigrationFolder();
    cleanups.push(migrations);
    writeMigrationJournal(migrations.folder, [
      {
        tag: "0000_workspace_only",
        sql: `CREATE TABLE workspace (
          id TEXT PRIMARY KEY NOT NULL,
          kind TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );`,
      },
    ]);
    expect(applyMigrations(connection, migrations.folder).ok).toBe(true);

    const result = bootstrapPersonalWorkspace(connection, () => 1);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("bootstrapFailed");
      expect(result.error.cause).toMatch(/no such table/i);
    }
    expect(
      connection.sqlite
        .prepare("SELECT COUNT(*) AS count FROM workspace")
        .get(),
    ).toEqual({ count: 0 });
    connection.close();
  });

  it("returns a controlled error when the schema is missing", () => {
    const { filePath } = temporarySqliteFile();
    const connection = requireOpen(filePath);
    const result = bootstrapPersonalWorkspace(connection);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("bootstrapFailed");
    expect(result.error.cause).toMatch(/no such table/i);
    connection.close();
  });

  it("does not create a second personal workspace", () => {
    const { filePath } = temporarySqliteFile();
    const connection = requireOpen(filePath);
    const initialized = initializeDatabase(connection, { now: () => 1 });
    expect(initialized.ok).toBe(true);

    const again = bootstrapPersonalWorkspace(connection, () => 2);
    expect(again.ok).toBe(true);
    if (!initialized.ok || !again.ok) {
      return;
    }

    expect(again.value).toEqual({
      workspaceId: initialized.value.workspaceId,
      created: false,
    });
    expect(
      connection.sqlite
        .prepare("SELECT COUNT(*) AS count FROM workspace")
        .get(),
    ).toEqual({ count: 1 });
    connection.close();
  });
});

describe("resolvePersonalWorkspace", () => {
  it("finds no workspace after migrate before bootstrap", () => {
    const { filePath } = temporarySqliteFile();
    const connection = requireOpen(filePath);
    expect(applyMigrations(connection).ok).toBe(true);

    expect(resolvePersonalWorkspace(connection)).toEqual({
      ok: false,
      error: { code: "workspaceNotFound" },
    });
    connection.close();
  });

  it("does not create rows and does not migrate", () => {
    const { filePath } = temporarySqliteFile();
    const connection = requireOpen(filePath);

    expect(resolvePersonalWorkspace(connection)).toEqual({
      ok: false,
      error: { code: "workspaceNotFound" },
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

  it("is not invoked by opening the process connection", () => {
    const { filePath } = temporarySqliteFile();
    const opened = getSqliteConnection(createValidAppEnv(filePath));

    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }

    expect(resolvePersonalWorkspace(opened.value)).toEqual({
      ok: false,
      error: { code: "workspaceNotFound" },
    });
  });
});

describe("workspace and preference constraints", () => {
  it("rejects a second personal workspace and an invalid preference row", () => {
    const { filePath } = temporarySqliteFile();
    const connection = requireOpen(filePath);
    expect(initializeDatabase(connection, { now: () => 1 }).ok).toBe(true);

    expect(() =>
      connection.sqlite
        .prepare(
          "INSERT INTO workspace (id, kind, created_at) VALUES (?, ?, ?)",
        )
        .run("second-workspace", PERSONAL_WORKSPACE_KIND, 2),
    ).toThrow(/UNIQUE/i);

    expect(() =>
      connection.sqlite
        .prepare(
          `INSERT INTO preference (
            workspace_id, locale, currency, time_zone, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run("missing-workspace", "en-US", "USD", "UTC", 1, 1),
    ).toThrow();

    expect(
      connection.sqlite
        .prepare("SELECT COUNT(*) AS count FROM workspace")
        .get(),
    ).toEqual({ count: 1 });
    expect(
      connection.sqlite
        .prepare("SELECT locale, currency, time_zone FROM preference")
        .get(),
    ).toEqual({
      locale: APPLICATION_LOCALE,
      currency: APPLICATION_CURRENCY,
      time_zone: APPLICATION_TIME_ZONE,
    });
    connection.close();
  });
});
