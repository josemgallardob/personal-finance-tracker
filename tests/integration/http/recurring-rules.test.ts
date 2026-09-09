/**
 * Recurrence HTTP endpoints against a real migrated SQLite database.
 *
 * These tests keep parsing, origin policy, workspace resolution, lifecycle
 * services and SQLite adapters live. Only clock, identifiers and log output
 * are deterministic process boundaries.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createActivateRecurringRuleHandler,
  createDeactivateRecurringRuleHandler,
  createGetRecurringRuleHandler,
  createListRecurringRulesHandler,
  createPreviewCatchUpHandler,
  createPreviewNextDueDateHandler,
  createUpdateRecurringRuleHandler,
} from "../../../src/modules/recurring/server/recurring-http";
import { createCreateTransactionHandler } from "../../../src/modules/transactions/server/transaction-http";
import { FixedClock } from "../../../src/shared/domain/clock";
import type { LocalDate } from "../../../src/shared/domain/dates";
import {
  buildRequest,
  createHttpFixture,
  openConnectionFrom,
  readEnvelope,
  storeCategory,
  storeTransaction,
  type HttpFixture,
} from "./helpers";

const TODAY = "2026-09-06" as LocalDate;
const NOW = 1_746_268_800_000;

let fixture: HttpFixture;
let sequence: number;

beforeEach(() => {
  fixture = createHttpFixture();
  sequence = 0;
});

afterEach(() => fixture.cleanup());

function createId(): string {
  sequence += 1;
  return `00000000-0000-4000-8000-000000000${String(sequence).padStart(3, "0")}`;
}

function deps() {
  return {
    env: fixture.env,
    openConnection: openConnectionFrom,
    clock: new FixedClock(TODAY),
    createId,
    now: () => NOW,
    logger: () => undefined,
  };
}

function request(
  method: string,
  path: string,
  body?: unknown,
  origin: string | null | undefined = undefined,
) {
  return buildRequest({
    method,
    path,
    origin,
    body: body === undefined ? null : JSON.stringify(body),
  });
}

function count(table: "transaction" | "recurring_rule"): number {
  const row = fixture.connection.sqlite
    .prepare(`SELECT COUNT(*) AS total FROM "${table}"`)
    .get() as { total: number };
  return row.total;
}

describe("recurring rule endpoints", () => {
  it("does not expose the scheduled runner through a public API route", () => {
    expect(
      existsSync(resolve(process.cwd(), "src/app/api/recurring-rules/run")),
    ).toBe(false);
    expect(
      existsSync(resolve(process.cwd(), "src/app/api/recurring-rules/cron")),
    ).toBe(false);
  });

  it("activates, lists and reads an existing movement template", async () => {
    const category = storeCategory(fixture, "Vivienda", "expense");
    const origin = storeTransaction(fixture, { category, concept: "Alquiler" });

    const activate = await createActivateRecurringRuleHandler(deps())(
      request("POST", "/api/recurring-rules", {
        transactionId: origin.id,
        monthlyDay: 5,
      }),
    );
    expect(activate.status).toBe(201);
    const activated = (await readEnvelope(activate)) as {
      data: { id: string; nextDueDate: string; sourceTransactionId: string };
    };
    expect(activated.data).toMatchObject({
      sourceTransactionId: origin.id,
      nextDueDate: "2026-10-05",
    });

    const listed = await createListRecurringRulesHandler(deps())(
      request("GET", "/api/recurring-rules"),
    );
    expect(await readEnvelope(listed)).toMatchObject({
      data: { expenses: [{ id: activated.data.id }], incomes: [] },
    });

    const found = await createGetRecurringRuleHandler(deps())(
      request("GET", `/api/recurring-rules/${activated.data.id}`),
    );
    expect(found.status).toBe(200);
    expect(await readEnvelope(found)).toMatchObject({
      data: { id: activated.data.id, concept: "Alquiler" },
    });
  });

  it("rejects invalid days, strict unknown fields, foreign origins and active conflicts", async () => {
    const category = storeCategory(fixture, "Vivienda", "expense");
    const origin = storeTransaction(fixture, { category });
    const handler = createActivateRecurringRuleHandler(deps());

    const invalidDay = await handler(
      request("POST", "/api/recurring-rules", {
        transactionId: origin.id,
        monthlyDay: 32,
      }),
    );
    expect(invalidDay.status).toBe(422);
    await expect(readEnvelope(invalidDay)).resolves.toMatchObject({
      error: { details: [{ field: "monthlyDay", code: "invalidMonthlyDay" }] },
    });

    const unknown = await handler(
      request("POST", "/api/recurring-rules", {
        transactionId: origin.id,
        monthlyDay: 5,
        workspaceId: "other",
      }),
    );
    expect(unknown.status).toBe(422);

    const foreign = await handler(
      request(
        "POST",
        "/api/recurring-rules",
        { transactionId: origin.id, monthlyDay: 5 },
        "https://evil.example",
      ),
    );
    expect(foreign.status).toBe(403);

    expect(
      (
        await handler(
          request("POST", "/api/recurring-rules", {
            transactionId: origin.id,
            monthlyDay: 5,
          }),
        )
      ).status,
    ).toBe(201);
    const conflict = await handler(
      request("POST", "/api/recurring-rules", {
        transactionId: origin.id,
        monthlyDay: 5,
      }),
    );
    expect(conflict.status).toBe(409);
    expect(count("recurring_rule")).toBe(1);
  });

  it("previews server-calculated dates without creating a rule or movement", async () => {
    const beforeRules = count("recurring_rule");
    const beforeTransactions = count("transaction");
    const response = await createPreviewNextDueDateHandler(deps())(
      request("POST", "/api/recurring-rules/preview", { monthlyDay: 31 }),
    );

    expect(response.status).toBe(200);
    await expect(readEnvelope(response)).resolves.toMatchObject({
      data: { nextDueDate: "2026-09-30" },
    });
    expect(count("recurring_rule")).toBe(beforeRules);
    expect(count("transaction")).toBe(beforeTransactions);
  });

  it("updates, previews catch-up and deactivates an active rule", async () => {
    const category = storeCategory(fixture, "Vivienda", "expense");
    const origin = storeTransaction(fixture, { category, concept: "Alquiler" });
    const activation = await createActivateRecurringRuleHandler(deps())(
      request("POST", "/api/recurring-rules", {
        transactionId: origin.id,
        monthlyDay: 5,
      }),
    );
    const { data: rule } = (await readEnvelope(activation)) as {
      data: { id: string; templateVersion: number };
    };

    const preview = await createPreviewCatchUpHandler(deps())(
      request("POST", `/api/recurring-rules/${rule.id}/preview`),
    );
    expect(preview.status).toBe(200);
    await expect(readEnvelope(preview)).resolves.toMatchObject({
      data: { rule: { id: rule.id }, pendingDueDates: [] },
    });

    const updated = await createUpdateRecurringRuleHandler(deps())(
      request("PUT", `/api/recurring-rules/${rule.id}`, {
        templateVersion: rule.templateVersion,
        type: "expense",
        amountMinor: 150_000,
        categoryId: category.id,
        concept: "Alquiler actualizado",
        monthlyDay: 8,
      }),
    );
    expect(updated.status).toBe(200);
    const updatedRule = (await readEnvelope(updated)) as {
      data: { rule: { templateVersion: number; nextDueDate: string } };
    };
    expect(updatedRule.data.rule).toMatchObject({
      templateVersion: 2,
      nextDueDate: "2026-09-08",
    });

    const stopped = await createDeactivateRecurringRuleHandler(deps())(
      request("POST", `/api/recurring-rules/${rule.id}/deactivate`, {
        templateVersion: updatedRule.data.rule.templateVersion,
      }),
    );
    expect(stopped.status).toBe(200);
    expect(
      (
        await createListRecurringRulesHandler(deps())(
          request("GET", "/api/recurring-rules"),
        )
      ).status,
    ).toBe(200);
    await expect(
      readEnvelope(
        await createListRecurringRulesHandler(deps())(
          request("GET", "/api/recurring-rules"),
        ),
      ),
    ).resolves.toEqual({
      data: { expenses: [], incomes: [] },
      requestId: expect.any(String),
    });
  });

  it("creates a movement and rule atomically, returning its next due date", async () => {
    const category = storeCategory(fixture, "Vivienda", "expense");
    const response = await createCreateTransactionHandler(deps())(
      request("POST", "/api/transactions", {
        type: "expense",
        amountMinor: 150_000,
        date: "2026-09-06",
        categoryId: category.id,
        recurrence: { monthlyDay: 5 },
      }),
    );

    expect(response.status).toBe(201);
    await expect(readEnvelope(response)).resolves.toMatchObject({
      data: { recurrence: { nextDueDate: "2026-10-05" } },
    });
    expect(count("transaction")).toBe(1);
    expect(count("recurring_rule")).toBe(1);
  });

  it("rolls an atomic create back when recurrence validation refuses it", async () => {
    const category = storeCategory(fixture, "Vivienda", "expense");
    const response = await createCreateTransactionHandler(deps())(
      request("POST", "/api/transactions", {
        type: "expense",
        amountMinor: 150_000,
        date: "2026-09-06",
        categoryId: category.id,
        recurrence: { monthlyDay: 0 },
      }),
    );

    expect(response.status).toBe(422);
    expect(count("transaction")).toBe(0);
    expect(count("recurring_rule")).toBe(0);
  });
});
