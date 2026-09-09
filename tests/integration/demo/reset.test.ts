/**
 * The demo reset path exercises real migrated SQLite files. It verifies the
 * dataset replacement boundary instead of mocking a repository or the clock.
 */

import { afterEach, describe, expect, it } from "vitest";

import * as resetRoute from "../../../src/app/api/demo/reset/route";
import { createGetAnalyticsAveragesHandler } from "../../../src/modules/analytics/server/analytics-http";
import { seedDemoDatabase } from "../../../src/modules/preferences/application/demo/seed-demo";
import { createPostDemoResetHandler } from "../../../src/modules/preferences/server/demo-reset-http";
import { createCreateTransactionHandler } from "../../../src/modules/transactions/server/transaction-http";
import { FixedClock } from "../../../src/shared/domain/clock";
import type { LocalDate } from "../../../src/shared/domain/dates";
import {
  closeSqliteConnection,
  getSqliteConnection,
} from "../../../src/shared/server/database";
import { initializeDatabase } from "../../../src/shared/server/initialize";
import { APP_ORIGIN, buildRequest, readEnvelope } from "../http/helpers";
import {
  createTemporarySqliteFile,
  createValidAppEnv,
  type TemporarySqliteFile,
} from "../helpers/sqlite";

const TODAY = "2026-03-14" as LocalDate;
const files: TemporarySqliteFile[] = [];

afterEach(() => {
  closeSqliteConnection();
  while (files.length > 0) {
    files.pop()?.cleanup();
  }
});

function fixture() {
  const personal = createTemporarySqliteFile();
  const demo = createTemporarySqliteFile();
  files.push(personal, demo);
  const env = createValidAppEnv(personal.filePath, {
    DEMO_DATABASE_PATH: demo.filePath,
    APP_URL: APP_ORIGIN,
  });
  const personalConnection = connection(env, "personal");
  const demoConnection = connection(env, "demo");

  expect(initializeDatabase(personalConnection).ok).toBe(true);
  expect(initializeDatabase(demoConnection).ok).toBe(true);

  return { env, personalConnection, demoConnection };
}

function connection(
  env: Record<string, string | undefined>,
  mode: "personal" | "demo",
) {
  const opened = getSqliteConnection(env, mode);
  if (!opened.ok) {
    throw new Error(`Expected connection: ${opened.error.code}`);
  }
  return opened.value;
}

function snapshot(connection: ReturnType<typeof fixture>["demoConnection"]) {
  return [
    "workspace",
    "preference",
    "category",
    "tag",
    "transaction",
    "transaction_tag",
    "recurring_rule",
    "recurring_rule_tag",
    "recurring_occurrence",
  ].map((table) =>
    connection.sqlite.prepare(`SELECT * FROM "${table}" ORDER BY 1`).all(),
  );
}

function resetRequest(confirmed: unknown, cookie = "mode=demo") {
  return buildRequest({
    method: "POST",
    path: "/api/demo/reset",
    headers: { cookie },
    body: JSON.stringify(confirmed),
  });
}

describe("demo seed and reset", () => {
  it("creates a clock-relative fixture with empty months, archived classifications and exact averages", async () => {
    const { env, demoConnection } = fixture();
    expect(seedDemoDatabase(demoConnection, new FixedClock(TODAY))).toEqual({
      ok: true,
      value: { transactionCount: 40, recurringRuleCount: 1 },
    });

    expect(
      demoConnection.sqlite
        .prepare(
          "SELECT count(*) AS count FROM category WHERE archived_at IS NOT NULL",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      demoConnection.sqlite
        .prepare(
          "SELECT count(*) AS count FROM tag WHERE archived_at IS NOT NULL",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      demoConnection.sqlite
        .prepare(
          `SELECT count(*) AS count
           FROM transaction_tag
           WHERE transaction_id = 'demo-01-groceries'`,
        )
        .get(),
    ).toEqual({ count: 2 });

    const averages = await createGetAnalyticsAveragesHandler({
      env,
      clock: new FixedClock(TODAY),
    })(
      buildRequest({
        path: "/api/analytics/averages",
        headers: { cookie: "mode=demo" },
      }),
    );
    expect(await readEnvelope(averages)).toMatchObject({
      data: {
        kind: "months",
        context: { monthCount: 12 },
        totalExpense: { totalMinor: 596330, monthCount: 12 },
        net: { totalMinor: 1853670, monthCount: 12 },
      },
    });
  });

  it("replaces demo deterministically while preserving personal rows", async () => {
    const { env, personalConnection, demoConnection } = fixture();
    personalConnection.sqlite.exec(
      "INSERT INTO \"transaction\" (id, workspace_id, type, amount_minor, date, category_id, concept, created_at, updated_at) VALUES ('personal-row', (SELECT id FROM workspace), 'expense', 100, '2026-03-01', (SELECT id FROM category WHERE type = 'expense' LIMIT 1), 'Privado', 1, 1)",
    );

    const handler = createPostDemoResetHandler({
      env,
      clock: new FixedClock(TODAY),
    });
    expect((await handler(resetRequest({ confirmed: true }))).status).toBe(200);
    const first = snapshot(demoConnection);
    demoConnection.sqlite.exec('DELETE FROM "transaction" LIMIT 1');
    expect((await handler(resetRequest({ confirmed: true }))).status).toBe(200);

    expect(snapshot(demoConnection)).toEqual(first);
    expect(
      personalConnection.sqlite
        .prepare('SELECT id, concept FROM "transaction"')
        .all(),
    ).toEqual([{ id: "personal-row", concept: "Privado" }]);
  });

  it("requires confirmation and refuses personal-mode reset requests", async () => {
    const { env, demoConnection } = fixture();
    const handler = createPostDemoResetHandler({
      env,
      clock: new FixedClock(TODAY),
    });

    const unconfirmed = await handler(resetRequest({ confirmed: false }));
    expect(unconfirmed.status).toBe(422);
    expect(
      demoConnection.sqlite
        .prepare("SELECT count(*) AS count FROM workspace")
        .get(),
    ).toEqual({ count: 1 });

    const personal = await handler(
      resetRequest({ confirmed: true }, "mode=personal"),
    );
    expect(personal.status).toBe(403);
  });

  it("leaves a valid complete dataset when a reset and a demo write arrive together", async () => {
    const { env, demoConnection } = fixture();
    const reset = createPostDemoResetHandler({
      env,
      clock: new FixedClock(TODAY),
    });
    const create = createCreateTransactionHandler({
      env,
      clock: new FixedClock(TODAY),
      createId: () => "concurrent-demo-write",
      now: () => 1,
    });

    const [, created] = await Promise.all([
      reset(resetRequest({ confirmed: true })),
      create(
        buildRequest({
          method: "POST",
          path: "/api/transactions",
          headers: { cookie: "mode=demo" },
          body: JSON.stringify({
            type: "expense",
            amountMinor: 300,
            date: TODAY,
            categoryId: "demo-expense-food",
            tagInputs: [],
          }),
        }),
      ),
    ]);

    expect(created.status).toBe(201);
    expect(
      demoConnection.sqlite.prepare("PRAGMA foreign_key_check").all(),
    ).toEqual([]);
    expect(
      demoConnection.sqlite
        .prepare('SELECT count(*) AS count FROM "transaction"')
        .get(),
    ).toEqual({ count: 41 });
  });

  it("exposes only the POST node route contract", () => {
    expect(resetRoute.runtime).toBe("nodejs");
    expect(resetRoute.dynamic).toBe("force-dynamic");
    expect(resetRoute.revalidate).toBe(0);
    expect(resetRoute).toHaveProperty("POST");
    expect(resetRoute).not.toHaveProperty("GET");
  });
});
