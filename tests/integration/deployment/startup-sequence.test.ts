/**
 * Durable startup sequence against real SQLite files.
 *
 * The deployment contract is exercised end to end: both databases are migrated
 * and bootstrapped before the server would start, recreating the process keeps
 * the rows of each file, the personal and demonstration files never share
 * storage, and a database that cannot be migrated stops the sequence so the
 * deployment never serves a half-migrated schema.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { EnvSource } from "../../../src/shared/server/config";
import {
  closeSqliteConnection,
  openSqliteConnection,
  type SqliteConnection,
} from "../../../src/shared/server/database";
import { loadAppConfig } from "../../../src/shared/server/config";
import { prepareServer } from "../../../src/shared/server/startup";
import {
  createTemporarySqliteFile,
  createValidAppEnv,
} from "../helpers/sqlite";

const cleanups: Array<{ cleanup(): void }> = [];

afterEach(() => {
  closeSqliteConnection();

  while (cleanups.length > 0) {
    cleanups.pop()?.cleanup();
  }
});

function temporaryEnv(overrides: EnvSource = {}): EnvSource {
  const file = createTemporarySqliteFile();
  cleanups.push(file);

  return createValidAppEnv(file.filePath, overrides);
}

function openFile(path: string): SqliteConnection {
  const config = loadAppConfig(createValidAppEnv(path));

  if (!config.ok) {
    throw new Error("the temporary environment must be valid");
  }

  const opened = openSqliteConnection(config.value);

  if (!opened.ok) {
    throw new Error(`could not open the temporary file: ${opened.error.code}`);
  }

  cleanups.push({ cleanup: () => opened.value.close() });
  return opened.value;
}

function readWorkspaceId(path: string): string {
  const connection = openFile(path);
  const row = connection.sqlite
    .prepare("select id from workspace limit 1")
    .get() as { id: string } | undefined;
  connection.close();

  return row?.id ?? "";
}

function storeTag(path: string, workspaceId: string, name: string): void {
  const connection = openFile(path);
  connection.sqlite
    .prepare(
      "insert into tag (id, workspace_id, name, normalized_name, archived_at)" +
        " values (?, ?, ?, ?, null)",
    )
    .run(`tag-${name}`, workspaceId, name, name);
  connection.close();
}

function readTagNames(path: string): readonly string[] {
  const connection = openFile(path);
  const rows = connection.sqlite
    .prepare("select name from tag order by name")
    .all() as Array<{ name: string }>;
  connection.close();

  return rows.map((row) => row.name);
}

function dropTable(path: string, table: string): void {
  const connection = openFile(path);
  connection.sqlite.exec(`drop table "${table}"`);
  connection.close();
}

describe("private deployment startup sequence", () => {
  it("migrates, bootstraps and catches up before the server could serve", () => {
    const env = temporaryEnv();
    const lines: string[] = [];

    const prepared = prepareServer({ env, logger: (line) => lines.push(line) });

    expect(prepared.ok).toBe(true);

    if (!prepared.ok) {
      return;
    }

    expect(prepared.value.steps.map((step) => step.step)).toEqual([
      "migratePersonal",
      "migrateDemo",
      "recurringCatchUp",
    ]);
    expect(prepared.value.steps[0]?.createdWorkspace).toBe(true);
    expect(prepared.value.steps[0]?.applied).toBeGreaterThan(0);
    expect(prepared.value.steps[2]?.generated).toBe(0);
    expect(prepared.value.binding).toEqual({
      host: "127.0.0.1",
      port: 3000,
      loopback: true,
    });
    expect(existsSync(String(env.DATABASE_PATH))).toBe(true);
    expect(existsSync(String(env.DEMO_DATABASE_PATH))).toBe(true);
    expect(lines.at(-1)).toContain('"outcome":"ready"');
  });

  it("never prints a database path or a driver message", () => {
    const env = temporaryEnv();
    const lines: string[] = [];

    prepareServer({ env, logger: (line) => lines.push(line) });

    for (const line of lines) {
      expect(line).not.toContain(String(env.DATABASE_PATH));
      expect(line).not.toContain(String(env.DEMO_DATABASE_PATH));
    }
  });

  it("keeps the rows of both databases when the process is recreated", () => {
    const env = temporaryEnv();
    const personalPath = String(env.DATABASE_PATH);
    const demoPath = String(env.DEMO_DATABASE_PATH);

    expect(prepareServer({ env, logger: () => {} }).ok).toBe(true);

    const personalWorkspace = readWorkspaceId(personalPath);
    const demoWorkspace = readWorkspaceId(demoPath);
    storeTag(personalPath, personalWorkspace, "personal-marker");
    storeTag(demoPath, demoWorkspace, "demo-marker");

    const restarted = prepareServer({ env, logger: () => {} });

    expect(restarted.ok).toBe(true);

    if (!restarted.ok) {
      return;
    }

    expect(restarted.value.steps[0]?.createdWorkspace).toBe(false);
    expect(restarted.value.steps[1]?.createdWorkspace).toBe(false);
    expect(restarted.value.steps[0]?.applied).toBe(0);
    expect(readWorkspaceId(personalPath)).toBe(personalWorkspace);
    expect(readWorkspaceId(demoPath)).toBe(demoWorkspace);
    expect(readTagNames(personalPath)).toEqual(["personal-marker"]);
    expect(readTagNames(demoPath)).toEqual(["demo-marker"]);
  });

  it("refuses to serve when the personal database cannot be opened", () => {
    const env = temporaryEnv();
    const personalPath = String(env.DATABASE_PATH);
    mkdirSync(personalPath, { recursive: true });

    const prepared = prepareServer({ env, logger: () => {} });

    expect(prepared).toEqual({
      ok: false,
      error: {
        code: "stepFailed",
        step: "migratePersonal",
        reason: "invalidPath",
      },
    });
    expect(existsSync(String(env.DEMO_DATABASE_PATH))).toBe(false);
  });

  it("refuses to serve when a migration fails on the personal file", () => {
    const env = temporaryEnv();
    const personalPath = String(env.DATABASE_PATH);
    const connection = openFile(personalPath);
    connection.sqlite.exec('create table "workspace" (unrelated text)');
    connection.close();

    const prepared = prepareServer({ env, logger: () => {} });

    expect(prepared).toEqual({
      ok: false,
      error: {
        code: "stepFailed",
        step: "migratePersonal",
        reason: "migrationFailed",
      },
    });
  });

  it("refuses to serve when the demonstration file cannot be migrated", () => {
    const env = temporaryEnv();
    const demoPath = String(env.DEMO_DATABASE_PATH);
    const connection = openFile(demoPath);
    connection.sqlite.exec('create table "workspace" (unrelated text)');
    connection.close();

    const prepared = prepareServer({ env, logger: () => {} });

    expect(prepared).toEqual({
      ok: false,
      error: {
        code: "stepFailed",
        step: "migrateDemo",
        reason: "migrationFailed",
      },
    });
  });

  it("refuses to serve when the configuration is incomplete", () => {
    const env = temporaryEnv();
    const incomplete = { ...env, APP_URL: undefined };

    const prepared = prepareServer({ env: incomplete, logger: () => {} });

    expect(prepared).toEqual({
      ok: false,
      error: {
        code: "stepFailed",
        step: "migratePersonal",
        reason: "invalidConfig",
      },
    });
  });

  it("refuses to serve when the catch-up cannot read the recurrence tables", () => {
    const env = temporaryEnv();
    const personalPath = String(env.DATABASE_PATH);

    expect(prepareServer({ env, logger: () => {} }).ok).toBe(true);

    closeSqliteConnection();
    dropTable(personalPath, "recurring_rule");

    const prepared = prepareServer({ env, logger: () => {} });

    expect(prepared).toEqual({
      ok: false,
      error: {
        code: "stepFailed",
        step: "recurringCatchUp",
        reason: "storageFailure",
      },
    });
  });

  it("refuses a non-loopback bind before it opens any database", () => {
    const env = temporaryEnv({ HOST: "0.0.0.0" });

    // The default logger writes the refusal to the process output, which is
    // what an operator reading container logs sees.
    const prepared = prepareServer({ env });

    expect(prepared).toEqual({
      ok: false,
      error: { code: "invalidBinding", reason: "nonLoopbackBindNotAllowed" },
    });
    expect(existsSync(String(env.DATABASE_PATH))).toBe(false);
    expect(existsSync(String(env.DEMO_DATABASE_PATH))).toBe(false);
  });

  it("reads the process environment when no map is supplied", () => {
    const env = temporaryEnv();
    const restore = new Map<string, string | undefined>();

    for (const name of [
      "DATABASE_PATH",
      "DEMO_DATABASE_PATH",
      "APP_URL",
      "TZ",
      "HOST",
      "PORT",
    ]) {
      restore.set(name, process.env[name]);
      const value = env[name];

      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }

    try {
      const prepared = prepareServer({ logger: () => {} });

      expect(prepared.ok).toBe(true);
      expect(existsSync(String(env.DATABASE_PATH))).toBe(true);
    } finally {
      for (const [name, value] of restore) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });

  it("keeps the personal and demonstration files on separate storage", () => {
    const file = createTemporarySqliteFile();
    cleanups.push(file);
    const personalPath = join(file.directory, "personal", "personal.sqlite");
    const demoPath = join(file.directory, "demo", "demo.sqlite");
    mkdirSync(join(file.directory, "personal"));
    mkdirSync(join(file.directory, "demo"));
    const env = createValidAppEnv(personalPath, {
      DEMO_DATABASE_PATH: demoPath,
    });

    expect(prepareServer({ env, logger: () => {} }).ok).toBe(true);

    storeTag(personalPath, readWorkspaceId(personalPath), "only-personal");

    expect(readTagNames(personalPath)).toEqual(["only-personal"]);
    expect(readTagNames(demoPath)).toEqual([]);
  });
});
