/**
 * Verifies that the committed migrations apply to a brand new SQLite file.
 *
 * The check runs the real `db:migrate` entry point twice against an isolated
 * temporary database, so continuous integration exercises the same command an
 * operator runs, not only the library functions covered by the test suite. The
 * first run must create every table named by the committed journal and the
 * implicit personal workspace; the second run must change nothing, because a
 * restart may never reapply a recorded migration.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsFolder = join(repositoryRoot, "db/migrations");

/** Tables the committed migrations must create, besides the ledger. */
const EXPECTED_TABLES = [
  "workspace",
  "preference",
  "category",
  "tag",
  "transaction",
  "transaction_tag",
] as const;

/** Table where the migration runner records finished files. */
const SCHEMA_MIGRATION_TABLE = "schema_migration";

interface MigrationRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface DatabaseState {
  readonly tables: readonly string[];
  readonly appliedTags: readonly string[];
  readonly workspaceCount: number;
}

function fail(message: string): never {
  console.error(`Clean migration verification failed: ${message}`);
  process.exit(1);
}

function readJournalTags(): readonly string[] {
  const journalPath = join(migrationsFolder, "meta/_journal.json");
  const parsed: unknown = JSON.parse(readFileSync(journalPath, "utf8"));

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("entries" in parsed) ||
    !Array.isArray(parsed.entries)
  ) {
    fail(`the drizzle-kit journal at ${journalPath} is not readable`);
  }

  const tags = parsed.entries.map((entry: unknown) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("tag" in entry) ||
      typeof entry.tag !== "string"
    ) {
      fail("the drizzle-kit journal contains an entry without a tag");
    }

    return entry.tag;
  });

  if (tags.length === 0) {
    fail("the drizzle-kit journal declares no migration to verify");
  }

  return tags;
}

function runMigrate(databasePath: string): MigrationRun {
  const result = spawnSync("npm", ["run", "db:migrate"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_PATH: databasePath,
      APP_URL: "http://localhost:3000",
      TZ: "Europe/Madrid",
    },
  });

  if (result.error) {
    fail(`the migration command could not start: ${result.error.message}`);
  }

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function readDatabaseState(databasePath: string): DatabaseState {
  const sqlite = new Database(databasePath, { readonly: true });

  try {
    const tables = sqlite
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => row.name);

    const appliedTags = sqlite
      .prepare<[], { tag: string }>(
        `SELECT tag FROM ${SCHEMA_MIGRATION_TABLE} ORDER BY tag`,
      )
      .all()
      .map((row) => row.tag);

    const workspaces = sqlite
      .prepare<[], { total: number }>("SELECT COUNT(*) AS total FROM workspace")
      .get();

    return {
      tables,
      appliedTags,
      workspaceCount: workspaces?.total ?? 0,
    };
  } finally {
    sqlite.close();
  }
}

function assertRunSucceeded(label: string, run: MigrationRun): void {
  if (run.status !== 0) {
    fail(
      `the ${label} migration run exited with ${String(run.status)}.\n` +
        `${run.stdout}${run.stderr}`,
    );
  }
}

function assertSchema(
  state: DatabaseState,
  journalTags: readonly string[],
): void {
  const missingTables = EXPECTED_TABLES.filter(
    (table) => !state.tables.includes(table),
  );

  if (missingTables.length > 0) {
    fail(`the new database is missing tables: ${missingTables.join(", ")}`);
  }

  if (!state.tables.includes(SCHEMA_MIGRATION_TABLE)) {
    fail(`the new database has no ${SCHEMA_MIGRATION_TABLE} ledger`);
  }

  const expectedTags = [...journalTags].sort();

  if (state.appliedTags.join("|") !== expectedTags.join("|")) {
    fail(
      `the ledger recorded [${state.appliedTags.join(", ")}] instead of ` +
        `[${expectedTags.join(", ")}]`,
    );
  }

  if (state.workspaceCount !== 1) {
    fail(
      `the bootstrap left ${String(state.workspaceCount)} workspaces instead of one`,
    );
  }
}

function main(): void {
  const journalTags = readJournalTags();
  const directory = mkdtempSync(join(tmpdir(), "pft-clean-migrations-"));
  const databasePath = join(directory, "personal-finance.db");

  try {
    if (existsSync(databasePath)) {
      fail("the temporary database path was not empty before the first run");
    }

    const first = runMigrate(databasePath);
    assertRunSucceeded("first", first);

    if (!existsSync(databasePath)) {
      fail("the first run did not create the database file");
    }

    const afterFirst = readDatabaseState(databasePath);
    assertSchema(afterFirst, journalTags);

    const second = runMigrate(databasePath);
    assertRunSucceeded("second", second);

    const afterSecond = readDatabaseState(databasePath);
    assertSchema(afterSecond, journalTags);

    if (afterSecond.tables.join("|") !== afterFirst.tables.join("|")) {
      fail("the second run changed the schema of an initialized database");
    }

    console.log(
      `Applied ${String(journalTags.length)} migrations to a new database and ` +
        "confirmed that a second run changes nothing.",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

main();
