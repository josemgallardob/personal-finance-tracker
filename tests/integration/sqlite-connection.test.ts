import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { loadAppConfig } from "../../src/shared/server/config";
import {
  NEXT_PRODUCTION_BUILD_PHASE,
  SQLITE_BUSY_TIMEOUT_MS,
  closeSqliteConnection,
  getSqliteConnection,
  openSqliteConnection,
} from "../../src/shared/server/database";
import { createTemporarySqliteFile, createValidAppEnv } from "./helpers/sqlite";

const temporaryFiles: Array<{ cleanup(): void }> = [];

afterEach(() => {
  closeSqliteConnection();

  while (temporaryFiles.length > 0) {
    temporaryFiles.pop()?.cleanup();
  }
});

function temporarySqliteFile() {
  const file = createTemporarySqliteFile();
  temporaryFiles.push(file);
  return file;
}

function requireConfig(filePath: string) {
  const result = loadAppConfig(createValidAppEnv(filePath));

  if (!result.ok) {
    throw new Error(
      `Expected valid configuration, got ${JSON.stringify(result.errors)}`,
    );
  }

  return result.value;
}

function requireOpen(filePath: string) {
  const result = openSqliteConnection(requireConfig(filePath));

  if (!result.ok) {
    throw new Error(
      `Expected an open connection, got ${JSON.stringify(result.error)}`,
    );
  }

  return result.value;
}

describe("openSqliteConnection", () => {
  it("applies WAL, foreign keys and busy_timeout on a real file", () => {
    const { filePath } = temporarySqliteFile();
    const connection = requireOpen(filePath);

    expect(existsSync(filePath)).toBe(true);
    expect(connection.sqlite.pragma("journal_mode", { simple: true })).toBe(
      "wal",
    );
    expect(connection.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(connection.sqlite.pragma("busy_timeout", { simple: true })).toBe(
      SQLITE_BUSY_TIMEOUT_MS,
    );

    connection.close();
  });

  it("keeps written rows after the connection is closed and opened again", () => {
    const { filePath } = temporarySqliteFile();
    const first = requireOpen(filePath);

    first.sqlite.exec(
      "CREATE TABLE persistence_probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL)",
    );
    first.sqlite
      .prepare("INSERT INTO persistence_probe (id, label) VALUES (?, ?)")
      .run(1, "kept after reopen");
    first.close();
    expect(first.sqlite.open).toBe(false);

    const second = requireOpen(filePath);
    const row = second.sqlite
      .prepare("SELECT label FROM persistence_probe WHERE id = 1")
      .get() as { label: string };

    expect(row.label).toBe("kept after reopen");
    expect(second.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(second.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    second.close();
  });

  it("rejects a database path that is already a directory", () => {
    const { directory } = temporarySqliteFile();
    const result = openSqliteConnection(requireConfig(directory));

    expect(result).toEqual({
      ok: false,
      error: { code: "invalidPath", path: directory },
    });
    expect(existsSync(join(directory, "personal-finance.sqlite"))).toBe(false);
  });

  it("returns a controlled error when SQLite cannot open the file", () => {
    const { directory } = temporarySqliteFile();
    const missingParent = join(directory, "missing-parent", "app.sqlite");
    const result = openSqliteConnection(requireConfig(missingParent));

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("openFailed");
    expect(result.error.path).toBe(missingParent);
    expect(result.error.cause).toMatch(/directory does not exist/i);
    expect(existsSync(missingParent)).toBe(false);
  });

  it("returns a controlled error when the parent path is a file", () => {
    const { directory } = temporarySqliteFile();
    const parentFile = join(directory, "not-a-directory");
    writeFileSync(parentFile, "blocked");
    const blockedPath = join(parentFile, "app.sqlite");

    const result = openSqliteConnection(requireConfig(blockedPath));

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("openFailed");
    expect(result.error.path).toBe(blockedPath);
    expect(result.error.cause).toBeTruthy();
  });

  it("closes an unused handle without throwing", () => {
    const { filePath } = temporarySqliteFile();
    const connection = requireOpen(filePath);

    connection.close();
    connection.close();
    expect(connection.sqlite.open).toBe(false);
  });
});

describe("getSqliteConnection", () => {
  it("opens the process connection lazily and reuses it", () => {
    const { filePath } = temporarySqliteFile();
    const env = createValidAppEnv(filePath);

    expect(existsSync(filePath)).toBe(false);

    const first = getSqliteConnection(env);
    const second = getSqliteConnection({
      ...createValidAppEnv(join(filePath, "ignored.sqlite")),
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }

    expect(first.value).toBe(second.value);
    expect(first.value.filePath).toBe(filePath);
    expect(existsSync(filePath)).toBe(true);
    expect(first.value.db.run(sql`SELECT 1`).changes).toBe(0);
  });

  it("reopens the same file after a safe process close", () => {
    const { filePath } = temporarySqliteFile();
    const env = createValidAppEnv(filePath);
    const first = getSqliteConnection(env);

    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }

    first.value.sqlite.exec(
      "CREATE TABLE process_probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL)",
    );
    first.value.sqlite
      .prepare("INSERT INTO process_probe (id, label) VALUES (?, ?)")
      .run(1, "process reopen");

    closeSqliteConnection();
    closeSqliteConnection();
    expect(first.value.sqlite.open).toBe(false);

    const second = getSqliteConnection(env);
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }

    expect(second.value).not.toBe(first.value);
    const row = second.value.sqlite
      .prepare("SELECT label FROM process_probe WHERE id = 1")
      .get() as { label: string };
    expect(row.label).toBe("process reopen");
  });

  it("does not cache a process connection when opening fails", () => {
    const blocked = temporarySqliteFile();
    const failed = getSqliteConnection(createValidAppEnv(blocked.directory));

    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error).toEqual({
        code: "invalidPath",
        path: blocked.directory,
      });
    }

    const { filePath } = temporarySqliteFile();
    const retry = getSqliteConnection(createValidAppEnv(filePath));

    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.value.filePath).toBe(filePath);
    }
  });

  it("does not open a file when configuration is invalid", () => {
    const { filePath } = temporarySqliteFile();
    const result = getSqliteConnection({
      DATABASE_PATH: filePath,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalidConfig",
        configErrors: [
          { field: "appUrl", code: "required" },
          { field: "timeZone", code: "required" },
        ],
      },
    });
    expect(existsSync(filePath)).toBe(false);
  });

  it("does not touch the database file during a Next.js production build", () => {
    const { filePath } = temporarySqliteFile();
    const result = getSqliteConnection(
      createValidAppEnv(filePath, {
        NEXT_PHASE: NEXT_PRODUCTION_BUILD_PHASE,
      }),
    );

    expect(result).toEqual({
      ok: false,
      error: { code: "buildTimeAccess" },
    });
    expect(existsSync(filePath)).toBe(false);
  });

  it("is safe to close when nothing was opened", () => {
    expect(() => closeSqliteConnection()).not.toThrow();
  });
});
