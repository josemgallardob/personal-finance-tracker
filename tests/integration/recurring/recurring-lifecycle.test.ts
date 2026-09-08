/**
 * Recurrence lifecycle against a real, migrated SQLite file.
 *
 * Activation, listing, preview, edit and deactivation run on the production
 * adapters. Catch-up before an edit or a deactivation shares the same SQL
 * transaction as the change, and races use a second real connection.
 */

import { afterEach, describe, expect, it } from "vitest";

import { sqliteRecurringRuleRepository } from "../../../src/modules/recurring/infrastructure/sqlite-recurring-rule-repository";
import { autocommitUnitOfWork } from "../../../src/modules/recurring/infrastructure/sqlite-unit-of-work";
import { createUpdateTransaction } from "../../../src/modules/transactions/application/update-transaction";
import { sqliteCategoryRepository } from "../../../src/modules/classification/infrastructure/sqlite-category-repository";
import { sqliteTagRepository } from "../../../src/modules/classification/infrastructure/sqlite-tag-repository";
import { sqliteTransactionRepository } from "../../../src/modules/transactions/infrastructure/sqlite-transaction-repository";
import { runInTransaction as runTransactionWrite } from "../../../src/modules/transactions/infrastructure/sqlite-unit-of-work";
import { FixedClock } from "../../../src/shared/domain/clock";
import type { LocalDate } from "../../../src/shared/domain/dates";
import {
  type RecurringFixture,
  NOW,
  createGenerator,
  createLifecycle,
  createRecurringFixture,
  newTransaction,
  okValue,
  readOccurrences,
  readRule,
  readTransactions,
  runDomainTransaction,
  sequentialIds,
  storeCategory,
  storeRule,
  storeTag,
} from "./helpers";

const TODAY = "2026-09-08";

const fixtures: RecurringFixture[] = [];

afterEach(() => {
  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
});

function openedFixture(): RecurringFixture {
  const fixture = createRecurringFixture();
  fixtures.push(fixture);
  return fixture;
}

function saveMovement(
  fixture: RecurringFixture,
  values: Parameters<typeof newTransaction>[0],
) {
  return okValue(
    runTransactionWrite(fixture.connection, (unit) =>
      sqliteTransactionRepository.insertTransaction(unit, {
        workspaceId: fixture.workspaceId,
        transaction: newTransaction(values),
      }),
    ),
  );
}

describe("previewing the next due date", () => {
  it("returns the first date strictly after today and writes nothing", () => {
    const fixture = openedFixture();
    const lifecycle = createLifecycle(fixture.connection, { today: TODAY });

    expect(lifecycle.previewNextDueDate({ monthlyDay: 8 })).toEqual({
      ok: true,
      value: { nextDueDate: "2026-10-08" },
    });
    expect(lifecycle.previewNextDueDate({ monthlyDay: 15 })).toEqual({
      ok: true,
      value: { nextDueDate: "2026-09-15" },
    });
    expect(readTransactions(fixture.connection)).toEqual([]);
    expect(readOccurrences(fixture.connection)).toEqual([]);
  });

  it("rejects a day that a monthly rule does not accept", () => {
    const fixture = openedFixture();

    expect(
      createLifecycle(fixture.connection, { today: TODAY }).previewNextDueDate({
        monthlyDay: 0,
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "monthlyDay", code: "invalidMonthlyDay" }],
    });
  });
});

describe("activating a rule from an existing movement", () => {
  it("copies the movement into the template and never due-dates the same day", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    const tag = storeTag(fixture, "Casa");
    const movement = saveMovement(fixture, {
      id: "origin-1",
      category,
      amountMinor: 85_000,
      date: TODAY,
      concept: "Alquiler",
      note: "Piso",
      tagIds: [tag.id],
    });

    const rule = okValue(
      runDomainTransaction(fixture.connection, (unit) =>
        createLifecycle(fixture.connection, {
          today: TODAY,
          createId: sequentialIds("rule"),
        }).activateFromTransaction(unit, {
          workspaceId: fixture.workspaceId,
          transactionId: movement.id,
          monthlyDay: 8,
        }),
      ),
    );

    expect(rule.nextDueDate).toBe("2026-10-08");
    expect(rule.template.amountMinor).toBe(85_000);
    expect(rule.template.concept).toBe("Alquiler");
    expect(rule.template.tagIds).toEqual([tag.id]);
    expect(rule.sourceTransactionId).toBe(movement.id);
    expect(readTransactions(fixture.connection)).toHaveLength(1);
  });

  it("refuses a second active rule for the same origin", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    const origin = saveMovement(fixture, {
      id: "origin-1",
      category,
      date: TODAY,
    });
    storeRule(fixture, {
      id: "rule-1",
      sourceTransactionId: origin.id,
      category,
      monthlyDay: 8,
      nextDueDate: "2026-10-08",
    });

    expect(
      runDomainTransaction(fixture.connection, (unit) =>
        createLifecycle(fixture.connection, {
          today: TODAY,
        }).activateFromTransaction(unit, {
          workspaceId: fixture.workspaceId,
          transactionId: origin.id,
          monthlyDay: 15,
        }),
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "sourceTransactionId", code: "activeRuleExists" }],
    });
  });
});

describe("creating a movement together with its rule", () => {
  it("lands both rows or neither", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Sueldo", "income");
    storeRule(fixture, {
      id: "life-2",
      category,
      monthlyDay: 1,
      nextDueDate: "2026-10-01",
    });

    const refused = runDomainTransaction(fixture.connection, (unit) =>
      createLifecycle(fixture.connection, {
        today: TODAY,
        createId: sequentialIds("life"),
      }).activateWithNewTransaction(unit, {
        workspaceId: fixture.workspaceId,
        type: "income",
        amountMinor: 250_000,
        date: TODAY,
        categoryId: category.id,
        concept: "Nómina",
        note: null,
        monthlyDay: 1,
      }),
    );

    expect(refused.ok).toBe(false);
    expect(readTransactions(fixture.connection)).toEqual([]);
    expect(
      fixture.connection.sqlite
        .prepare("SELECT count(*) AS count FROM recurring_rule")
        .get() as { count: number },
    ).toEqual({ count: 1 });
  });

  it("stores the new movement and a rule that copies it", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Sueldo", "income");

    const created = okValue(
      runDomainTransaction(fixture.connection, (unit) =>
        createLifecycle(fixture.connection, {
          today: TODAY,
          createId: sequentialIds("life"),
        }).activateWithNewTransaction(unit, {
          workspaceId: fixture.workspaceId,
          type: "income",
          amountMinor: 250_000,
          date: TODAY,
          categoryId: category.id,
          concept: "Nómina",
          note: null,
          monthlyDay: 1,
        }),
      ),
    );

    expect(created.transaction.amountMinor).toBe(250_000);
    expect(created.rule.sourceTransactionId).toBe(created.transaction.id);
    expect(created.rule.nextDueDate).toBe("2026-10-01");
    expect(created.rule.template.type).toBe("income");
  });
});

describe("listing and catch-up preview", () => {
  it("lists only active rules grouped by type and previews overdue dates without writing", () => {
    const fixture = openedFixture();
    const rent = storeCategory(fixture, "Alquiler", "expense");
    const salary = storeCategory(fixture, "Sueldo", "income");
    storeRule(fixture, {
      id: "rule-expense",
      category: rent,
      monthlyDay: 31,
      nextDueDate: "2026-07-31",
    });
    storeRule(fixture, {
      id: "rule-income",
      category: salary,
      amountMinor: 250_000,
      monthlyDay: 1,
      nextDueDate: "2026-09-01",
    });
    storeRule(fixture, {
      id: "rule-stopped",
      category: rent,
      monthlyDay: 15,
      nextDueDate: "2026-05-15",
      deactivatedAt: NOW,
    });

    const listed = okValue(
      createLifecycle(fixture.connection, { today: TODAY }).listActiveRules(
        autocommitUnitOfWork(fixture.connection),
        { workspaceId: fixture.workspaceId },
      ),
    );

    expect(listed.expenses.map((row) => row.rule.id)).toEqual(["rule-expense"]);
    expect(listed.incomes.map((row) => row.rule.id)).toEqual(["rule-income"]);

    const preview = okValue(
      createLifecycle(fixture.connection, { today: TODAY }).previewCatchUp(
        autocommitUnitOfWork(fixture.connection),
        { workspaceId: fixture.workspaceId, ruleId: "rule-expense" },
      ),
    );

    expect(preview.pending).toEqual(["2026-07-31", "2026-08-31"]);
    expect(readTransactions(fixture.connection)).toEqual([]);
  });
});

describe("editing a rule", () => {
  it("materialises overdue dates with the old template then stores the new one", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    storeRule(fixture, {
      id: "rule-1",
      category,
      amountMinor: 85_000,
      concept: "Alquiler",
      monthlyDay: 31,
      nextDueDate: "2026-07-31",
    });

    const changed = okValue(
      runDomainTransaction(fixture.connection, (unit) =>
        createLifecycle(fixture.connection, {
          today: TODAY,
          createId: sequentialIds("edit"),
        }).editRule(unit, {
          workspaceId: fixture.workspaceId,
          ruleId: "rule-1",
          templateVersion: 1,
          monthlyDay: 15,
          type: "expense",
          amountMinor: 90_000,
          categoryId: category.id,
          concept: "Alquiler actualizado",
          note: null,
        }),
      ),
    );

    expect(changed.generated.map((entry) => entry.scheduledFor)).toEqual([
      "2026-07-31",
      "2026-08-31",
    ]);
    expect(
      (
        readTransactions(fixture.connection) as Array<{
          amountMinor: number;
          concept: string | null;
          date: string;
        }>
      ).map((row) => ({
        amountMinor: row.amountMinor,
        concept: row.concept,
        date: row.date,
      })),
    ).toEqual([
      { amountMinor: 85_000, concept: "Alquiler", date: "2026-07-31" },
      { amountMinor: 85_000, concept: "Alquiler", date: "2026-08-31" },
    ]);
    expect(changed.rule.template.amountMinor).toBe(90_000);
    expect(changed.rule.template.concept).toBe("Alquiler actualizado");
    expect(changed.rule.nextDueDate).toBe("2026-09-15");
    expect(changed.rule.templateVersion).toBe(2);
  });

  it("rolls the catch-up and the template change back together, then retries once", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    storeRule(fixture, {
      id: "rule-1",
      category,
      amountMinor: 85_000,
      monthlyDay: 31,
      nextDueDate: "2026-08-31",
    });
    saveMovement(fixture, {
      id: "edit-2",
      category,
      date: "2026-01-15",
    });

    const failed = runDomainTransaction(fixture.connection, (unit) =>
      createLifecycle(fixture.connection, {
        today: TODAY,
        createId: sequentialIds("edit"),
      }).editRule(unit, {
        workspaceId: fixture.workspaceId,
        ruleId: "rule-1",
        templateVersion: 1,
        monthlyDay: 15,
        type: "expense",
        amountMinor: 90_000,
        categoryId: category.id,
        concept: "Alquiler actualizado",
        note: null,
      }),
    );

    expect(failed.ok).toBe(false);
    expect(readRule(fixture.connection, "rule-1")).toEqual({
      nextDueDate: "2026-08-31",
      deactivatedAt: null,
    });
    expect(
      (readTransactions(fixture.connection) as Array<{ id: string }>).map(
        (row) => row.id,
      ),
    ).toEqual(["edit-2"]);

    const retried = okValue(
      runDomainTransaction(fixture.connection, (unit) =>
        createLifecycle(fixture.connection, {
          today: TODAY,
          createId: sequentialIds("retry"),
        }).editRule(unit, {
          workspaceId: fixture.workspaceId,
          ruleId: "rule-1",
          templateVersion: 1,
          monthlyDay: 15,
          type: "expense",
          amountMinor: 90_000,
          categoryId: category.id,
          concept: "Alquiler actualizado",
          note: null,
        }),
      ),
    );

    expect(retried.generated.map((entry) => entry.scheduledFor)).toEqual([
      "2026-08-31",
    ]);
    expect(retried.rule.nextDueDate).toBe("2026-09-15");
  });

  it("does not duplicate dates another connection already generated", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    storeRule(fixture, {
      id: "rule-1",
      category,
      amountMinor: 85_000,
      concept: "Alquiler",
      monthlyDay: 31,
      nextDueDate: "2026-08-31",
    });
    okValue(
      createGenerator(fixture.connection, {
        today: TODAY,
        createId: sequentialIds("race"),
      }).execute({ workspaceId: fixture.workspaceId }),
    );

    const changed = okValue(
      runDomainTransaction(fixture.connection, (unit) =>
        createLifecycle(fixture.connection, {
          today: TODAY,
          createId: sequentialIds("edit"),
        }).editRule(unit, {
          workspaceId: fixture.workspaceId,
          ruleId: "rule-1",
          templateVersion: 1,
          monthlyDay: 15,
          type: "expense",
          amountMinor: 90_000,
          categoryId: category.id,
          concept: "Alquiler actualizado",
          note: null,
        }),
      ),
    );

    expect(changed.generated).toEqual([]);
    expect(readTransactions(fixture.connection)).toHaveLength(1);
    expect(changed.rule.template.amountMinor).toBe(90_000);
    expect(changed.rule.nextDueDate).toBe("2026-09-15");
  });
});

describe("deactivating a rule", () => {
  it("catches up overdue dates then stops the rule for good", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    storeRule(fixture, {
      id: "rule-1",
      category,
      amountMinor: 85_000,
      monthlyDay: 31,
      nextDueDate: "2026-08-31",
    });

    const stopped = okValue(
      runDomainTransaction(fixture.connection, (unit) =>
        createLifecycle(fixture.connection, {
          today: TODAY,
          createId: sequentialIds("stop"),
        }).deactivateRule(unit, {
          workspaceId: fixture.workspaceId,
          ruleId: "rule-1",
          templateVersion: 1,
        }),
      ),
    );

    expect(stopped.generated.map((entry) => entry.scheduledFor)).toEqual([
      "2026-08-31",
    ]);
    expect(stopped.rule.deactivatedAt).toBe(NOW);
    expect(
      createLifecycle(fixture.connection, { today: TODAY }).listActiveRules(
        autocommitUnitOfWork(fixture.connection),
        { workspaceId: fixture.workspaceId },
      ),
    ).toEqual({ ok: true, value: { expenses: [], incomes: [] } });

    expect(
      runDomainTransaction(fixture.connection, (unit) =>
        createLifecycle(fixture.connection, { today: TODAY }).deactivateRule(
          unit,
          {
            workspaceId: fixture.workspaceId,
            ruleId: "rule-1",
            templateVersion: 1,
          },
        ),
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "deactivatedAt", code: "alreadyDeactivated" }],
    });

    expect(
      okValue(
        createGenerator(fixture.connection, { today: TODAY }).execute({
          workspaceId: fixture.workspaceId,
        }),
      ),
    ).toEqual({ generated: [], skipped: [], failed: [] });
  });
});

describe("origin deletion and copies", () => {
  it("keeps the rule active after the origin movement is deleted", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    const origin = saveMovement(fixture, {
      id: "origin-1",
      category,
      date: TODAY,
    });
    storeRule(fixture, {
      id: "rule-1",
      sourceTransactionId: origin.id,
      category,
      monthlyDay: 8,
      nextDueDate: TODAY,
    });

    okValue(
      runTransactionWrite(fixture.connection, (unit) =>
        sqliteTransactionRepository.deleteTransaction(unit, {
          workspaceId: fixture.workspaceId,
          transactionId: origin.id,
        }),
      ),
    );

    expect(
      fixture.connection.sqlite
        .prepare(
          "SELECT source_transaction_id AS source FROM recurring_rule WHERE id = ?",
        )
        .get("rule-1") as { source: string | null },
    ).toEqual({ source: null });
    expect(readRule(fixture.connection, "rule-1")).toEqual({
      nextDueDate: TODAY,
      deactivatedAt: null,
    });

    const report = okValue(
      createGenerator(fixture.connection, {
        today: TODAY,
        createId: sequentialIds("gen"),
      }).execute({ workspaceId: fixture.workspaceId }),
    );

    expect(report.generated).toHaveLength(1);
  });

  it("does not attach a copied movement to the origin rule", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    const origin = saveMovement(fixture, {
      id: "origin-1",
      category,
      date: TODAY,
    });
    storeRule(fixture, {
      id: "rule-1",
      sourceTransactionId: origin.id,
      category,
      monthlyDay: 8,
      nextDueDate: "2026-10-08",
    });
    const copy = saveMovement(fixture, {
      id: "copy-1",
      category,
      date: TODAY,
    });

    expect(
      okValue(
        sqliteRecurringRuleRepository.findActiveRuleBySource(
          autocommitUnitOfWork(fixture.connection),
          {
            workspaceId: fixture.workspaceId,
            sourceTransactionId: copy.id,
          },
        ),
      ),
    ).toBeNull();
  });
});

describe("generated entries", () => {
  it("can be edited without changing the template", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    storeRule(fixture, {
      id: "rule-1",
      category,
      amountMinor: 85_000,
      concept: "Alquiler",
      monthlyDay: 31,
      nextDueDate: "2026-08-31",
    });
    okValue(
      createGenerator(fixture.connection, {
        today: TODAY,
        createId: sequentialIds("gen"),
      }).execute({ workspaceId: fixture.workspaceId }),
    );

    okValue(
      runDomainTransaction(fixture.connection, (unit) =>
        createUpdateTransaction({
          transactions: sqliteTransactionRepository,
          categories: sqliteCategoryRepository,
          tags: sqliteTagRepository,
          clock: new FixedClock(TODAY as LocalDate),
          now: () => NOW,
        }).execute(unit, {
          workspaceId: fixture.workspaceId,
          transactionId: "gen-2",
          type: "expense",
          amountMinor: 10_000,
          date: "2026-08-31",
          categoryId: category.id,
          concept: "Ajuste puntual",
          note: null,
        }),
      ),
    );

    const stored = okValue(
      sqliteRecurringRuleRepository.findRuleForUpdate(
        autocommitUnitOfWork(fixture.connection),
        { workspaceId: fixture.workspaceId, ruleId: "rule-1" as never },
      ),
    );

    expect(stored?.rule.template.amountMinor).toBe(85_000);
    expect(stored?.rule.template.concept).toBe("Alquiler");
    expect(
      (
        readTransactions(fixture.connection) as Array<{
          amountMinor: number;
          concept: string | null;
        }>
      ).map((row) => ({
        amountMinor: row.amountMinor,
        concept: row.concept,
      })),
    ).toEqual([{ amountMinor: 10_000, concept: "Ajuste puntual" }]);
  });
});
