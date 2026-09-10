/**
 * Personal catch-up command, startup hook and log line on a real SQLite file.
 *
 * The process entry opens the configured file, never prints paths or template
 * copy, and does not touch SQLite during a production Next.js build. Repeated
 * runs on the same file stay idempotent. The npm command is spawned as an
 * operator would run it.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { register } from "../../../src/instrumentation";
import {
  catchUpPersonalRecurring,
  formatRecurringCatchUpLog,
} from "../../../src/modules/recurring/application/run-personal-recurring";
import { runPersonalRecurringCatchUp } from "../../../src/modules/recurring/server/run-personal-recurring";
import { FixedClock } from "../../../src/shared/domain/clock";
import type { LocalDate } from "../../../src/shared/domain/dates";
import {
  closeSqliteConnection,
  NEXT_PRODUCTION_BUILD_PHASE,
} from "../../../src/shared/server/database";
import type { EnvSource } from "../../../src/shared/server/config";
import {
  type RecurringFixture,
  NOW,
  createRecurringFixture,
  newTransaction,
  okValue,
  readOccurrences,
  readTransactions,
  rewindNextDueDate,
  runDomainTransaction,
  sequentialIds,
  storeCategory,
  storeRule,
} from "./helpers";
import { createDeleteTransaction } from "../../../src/modules/transactions/application/delete-transaction";
import { sqliteRecurringOccurrenceRepository } from "../../../src/modules/recurring/infrastructure/sqlite-recurring-occurrence-repository";
import {
  createTemporarySqliteFile,
  createValidAppEnv,
} from "../helpers/sqlite";
import { sqliteTransactionRepository } from "../../../src/modules/transactions/infrastructure/sqlite-transaction-repository";
import { runInTransaction } from "../../../src/modules/transactions/infrastructure/sqlite-unit-of-work";

const TODAY = "2026-09-08" as LocalDate;
const repositoryRoot = dirname(
  dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
);

const fixtures: RecurringFixture[] = [];

afterEach(() => {
  closeSqliteConnection();

  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
});

function openedFixture(): RecurringFixture {
  const fixture = createRecurringFixture();
  fixtures.push(fixture);
  return fixture;
}

function envOf(fixture: RecurringFixture, overrides: EnvSource = {}) {
  return createValidAppEnv(fixture.connection.filePath, overrides);
}

function collectLogs(
  run: (log: (line: string) => void) => { readonly ok: boolean },
): { readonly lines: string[]; readonly ok: boolean } {
  const lines: string[] = [];
  const result = run((line) => {
    lines.push(line);
  });
  return { lines, ok: result.ok };
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

describe("formatRecurringCatchUpLog", () => {
  it("prints only the event, counts and a closed reason code", () => {
    expect(
      JSON.parse(
        formatRecurringCatchUpLog({
          ok: false,
          generated: 2,
          skipped: 1,
          failed: 1,
          code: "generationFailed",
        }),
      ),
    ).toEqual({
      event: "recurring_run",
      ok: false,
      generated: 2,
      skipped: 1,
      failed: 1,
      code: "generationFailed",
    });
  });
});

describe("catchUpPersonalRecurring", () => {
  it("does not recreate a generated movement after it was deleted", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    storeRule(fixture, {
      id: "rule-1",
      category,
      concept: "Alquiler secreto",
      amountMinor: 85_000,
      monthlyDay: 31,
      nextDueDate: "2026-08-31",
    });

    const first = catchUpPersonalRecurring(fixture.connection, {
      clock: new FixedClock(TODAY),
      now: () => NOW,
      createId: sequentialIds("gen"),
    });
    okValue(
      runDomainTransaction(fixture.connection, (unit) =>
        createDeleteTransaction({
          transactions: sqliteTransactionRepository,
          occurrences: sqliteRecurringOccurrenceRepository,
        }).execute(unit, {
          workspaceId: fixture.workspaceId,
          transactionId: "gen-2",
        }),
      ),
    );
    rewindNextDueDate(fixture.connection, "rule-1", "2026-08-31");
    const second = catchUpPersonalRecurring(fixture.connection, {
      clock: new FixedClock(TODAY),
      now: () => NOW,
      createId: sequentialIds("retry"),
    });

    expect(first).toEqual({
      ok: true,
      generated: 1,
      skipped: 0,
      failed: 0,
    });
    expect(second).toEqual({
      ok: true,
      generated: 0,
      skipped: 1,
      failed: 0,
    });
    expect(readTransactions(fixture.connection)).toEqual([]);
    expect(readOccurrences(fixture.connection)).toEqual([
      {
        id: "gen-1",
        recurringRuleId: "rule-1",
        scheduledFor: "2026-08-31",
        transactionId: null,
      },
    ]);
  });

  it("reports a generation failure without copying template values", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    storeRule(fixture, {
      id: "rule-1",
      category,
      concept: "token-should-not-leak",
      monthlyDay: 31,
      nextDueDate: "2026-08-31",
    });
    okValue(
      runInTransaction(fixture.connection, (unit) =>
        sqliteTransactionRepository.insertTransaction(unit, {
          workspaceId: fixture.workspaceId,
          transaction: newTransaction({
            id: "fail-2",
            category,
            date: "2026-01-15",
          }),
        }),
      ) as never,
    );

    const summary = catchUpPersonalRecurring(fixture.connection, {
      clock: new FixedClock(TODAY),
      now: () => NOW,
      createId: sequentialIds("fail"),
    });

    expect(summary).toEqual({
      ok: false,
      generated: 0,
      skipped: 0,
      failed: 1,
      code: "generationFailed",
    });
  });
});

describe("runPersonalRecurringCatchUp", () => {
  it("logs counts and keeps a repeated startup run from creating a second movement", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    storeRule(fixture, {
      id: "rule-1",
      category,
      monthlyDay: 31,
      nextDueDate: "2026-08-31",
    });
    const env = envOf(fixture);

    const first = collectLogs((logger) =>
      runPersonalRecurringCatchUp({
        env,
        clock: new FixedClock(TODAY),
        now: () => NOW,
        createId: sequentialIds("start"),
        keepConnectionOpen: true,
        logger,
      }),
    );
    const second = collectLogs((logger) =>
      runPersonalRecurringCatchUp({
        env,
        clock: new FixedClock(TODAY),
        now: () => NOW,
        createId: sequentialIds("again"),
        keepConnectionOpen: true,
        logger,
      }),
    );

    expect(first.ok).toBe(true);
    expect(JSON.parse(first.lines[0] ?? "")).toEqual({
      event: "recurring_run",
      ok: true,
      generated: 1,
      skipped: 0,
      failed: 0,
    });
    expect(JSON.parse(second.lines[0] ?? "")).toEqual({
      event: "recurring_run",
      ok: true,
      generated: 0,
      skipped: 0,
      failed: 0,
    });
    expect(readTransactions(fixture.connection)).toHaveLength(1);
    expect(first.lines.join("\n")).not.toContain(fixture.connection.filePath);
  });

  it("refuses invalid configuration without printing the database path", () => {
    const secretPath = "/tmp/super-secret-db-token/personal-finance.sqlite";
    const logged = collectLogs((logger) =>
      runPersonalRecurringCatchUp({
        env: { DATABASE_PATH: secretPath },
        logger,
      }),
    );

    expect(logged.ok).toBe(false);
    expect(JSON.parse(logged.lines[0] ?? "")).toEqual({
      event: "recurring_run",
      ok: false,
      generated: 0,
      skipped: 0,
      failed: 0,
      code: "invalidConfig",
    });
    expect(logged.lines.join("\n")).not.toContain("super-secret-db-token");
    expect(existsSync(secretPath)).toBe(false);
  });

  it("reports a missing personal workspace without opening a second file", () => {
    const file = createTemporarySqliteFile();

    try {
      const logged = collectLogs((logger) =>
        runPersonalRecurringCatchUp({
          env: createValidAppEnv(file.filePath),
          logger,
        }),
      );

      expect(JSON.parse(logged.lines[0] ?? "")).toEqual({
        event: "recurring_run",
        ok: false,
        generated: 0,
        skipped: 0,
        failed: 0,
        code: "workspaceNotFound",
      });
    } finally {
      closeSqliteConnection();
      file.cleanup();
    }
  });

  it("does not open SQLite during a production Next.js build", () => {
    const fixture = openedFixture();
    const logged = collectLogs((logger) =>
      runPersonalRecurringCatchUp({
        env: envOf(fixture, { NEXT_PHASE: NEXT_PRODUCTION_BUILD_PHASE }),
        logger,
      }),
    );

    expect(logged.ok).toBe(true);
    expect(JSON.parse(logged.lines[0] ?? "")).toEqual({
      event: "recurring_run",
      ok: true,
      generated: 0,
      skipped: 0,
      failed: 0,
      code: "buildTimeAccess",
    });
    expect(readTransactions(fixture.connection)).toEqual([]);
  });
});

describe("register", () => {
  it("skips catch-up while Next.js is building", async () => {
    const previous = process.env.NEXT_PHASE;
    process.env.NEXT_PHASE = NEXT_PRODUCTION_BUILD_PHASE;

    try {
      await register();
    } finally {
      if (previous === undefined) {
        delete process.env.NEXT_PHASE;
      } else {
        process.env.NEXT_PHASE = previous;
      }
    }
  });

  it("runs catch-up on a Node server start without duplicating a later retry", async () => {
    const fixture = openedFixture();
    storeRule(fixture, {
      id: "rule-1",
      category: storeCategory(fixture, "Alquiler", "expense"),
      monthlyDay: 31,
      nextDueDate: "2099-01-31",
    });
    const env = envOf(fixture);
    const previous = {
      DATABASE_PATH: process.env.DATABASE_PATH,
      APP_URL: process.env.APP_URL,
      TZ: process.env.TZ,
      NEXT_PHASE: process.env.NEXT_PHASE,
      NEXT_RUNTIME: process.env.NEXT_RUNTIME,
    };

    process.env.DATABASE_PATH = env.DATABASE_PATH;
    process.env.APP_URL = env.APP_URL;
    process.env.TZ = env.TZ;
    delete process.env.NEXT_PHASE;
    process.env.NEXT_RUNTIME = "nodejs";

    try {
      await register();
      const afterFirst = readTransactions(fixture.connection).length;
      await register();
      expect(readTransactions(fixture.connection)).toHaveLength(afterFirst);
      expect(afterFirst).toBe(0);
    } finally {
      closeSqliteConnection();
      restoreEnv("DATABASE_PATH", previous.DATABASE_PATH);
      restoreEnv("APP_URL", previous.APP_URL);
      restoreEnv("TZ", previous.TZ);
      restoreEnv("NEXT_PHASE", previous.NEXT_PHASE);
      restoreEnv("NEXT_RUNTIME", previous.NEXT_RUNTIME);
    }
  });
});

describe("npm run recurring:run", () => {
  it("exits 0 and prints a sanitized JSON line on a migrated file", () => {
    const fixture = openedFixture();
    const result = spawnSync("npm", ["run", "recurring:run"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ...envOf(fixture),
      },
    });
    const line = (result.stdout + result.stderr)
      .split("\n")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith('{"event":"recurring_run"'));

    expect(result.status).toBe(0);
    expect(line).toBeDefined();
    expect(JSON.parse(line ?? "")).toMatchObject({
      event: "recurring_run",
      ok: true,
      generated: 0,
      failed: 0,
    });
    expect(`${result.stdout}${result.stderr}`).not.toContain(
      fixture.connection.filePath,
    );
  });

  it("exits 1 on invalid configuration without leaking the path", () => {
    const secretPath = "/tmp/cron-secret-path-token/personal-finance.sqlite";
    const result = spawnSync("npm", ["run", "recurring:run"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_PATH: secretPath,
        APP_URL: "",
        TZ: "",
      },
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).not.toContain(
      "cron-secret-path-token",
    );
    expect(existsSync(secretPath)).toBe(false);
  });
});
