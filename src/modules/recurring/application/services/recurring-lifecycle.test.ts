import { describe, expect, it } from "vitest";

import { createCategory } from "../../../classification/domain/category";
import { FixedClock } from "../../../../shared/domain/clock";
import type { LocalDate } from "../../../../shared/domain/dates";
import type { TransactionRepository } from "../../../transactions/application/ports/transaction-repository";
import {
  failed as transactionFailed,
  succeeded as transactionSucceeded,
} from "../../../transactions/application/ports/transaction-repository";
import { createTransaction } from "../../../transactions/domain/transaction";
import type { CategoryRepository } from "../../../classification/application/ports/category-repository";
import { succeeded as classificationSucceeded } from "../../../classification/application/ports/classification-repository";
import type { TagRepository } from "../../../classification/application/ports/tag-repository";
import type { RecurringOccurrenceRepository } from "../ports/recurring-repository";
import type { RecurringRuleRepository } from "../ports/recurring-repository";
import type { RecurringRepositoryErrorCode } from "../ports/recurring-repository";
import { failed, succeeded } from "../ports/recurring-repository";
import {
  createRecurringRule,
  deactivateRecurringRule,
} from "../../domain/recurring-rule";
import { createRecurringLifecycle } from "./recurring-lifecycle";

const TODAY = "2026-09-08" as LocalDate;
const NOW = 1_746_268_800_000;
const WORKSPACE_ID = "workspace-personal";

function unused(): never {
  throw new Error("Unexpected repository method");
}

function expenseCategory() {
  const built = createCategory({
    id: "category-expense",
    name: "Alquiler",
    type: "expense",
    sortOrder: 0,
    archivedAt: null,
  });

  if (!built.ok) {
    throw new Error(`Expected a valid category: ${JSON.stringify(built)}`);
  }

  return built.value;
}

function storedRule(nextDueDate = "2026-10-08") {
  const category = expenseCategory();
  const built = createRecurringRule({
    id: "rule-1",
    sourceTransactionId: "origin-1",
    type: "expense",
    amountMinor: 85_000,
    category,
    concept: "Alquiler",
    note: null,
    tagIds: [],
    monthlyDay: 8,
    nextDueDate,
    templateVersion: 1,
    deactivatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  });

  if (!built.ok) {
    throw new Error(`Expected a valid rule: ${JSON.stringify(built)}`);
  }

  return { rule: built.value, category };
}

function movement() {
  const built = createTransaction({
    id: "origin-1",
    type: "expense",
    amountMinor: 85_000,
    date: TODAY,
    category: expenseCategory(),
    concept: "Alquiler",
    note: null,
    tagIds: [],
    createdAt: NOW,
    updatedAt: NOW,
  });

  if (!built.ok) {
    throw new Error(`Expected a valid movement: ${JSON.stringify(built)}`);
  }

  return built.value;
}

function lifecycle(
  overrides: {
    readonly rules?: Partial<RecurringRuleRepository>;
    readonly occurrences?: Partial<RecurringOccurrenceRepository>;
    readonly transactions?: Partial<TransactionRepository>;
    readonly categories?: Partial<CategoryRepository>;
    readonly tags?: Partial<TagRepository>;
  } = {},
) {
  return createRecurringLifecycle({
    rules: {
      findDueRules: unused,
      findActiveRules: unused,
      findActiveRuleBySource: unused,
      findActiveRuleByCategory: unused,
      findActiveRuleByTag: unused,
      findRuleForUpdate: unused,
      insertRule: unused,
      replaceActiveRule: unused,
      deactivateRule: unused,
      advanceNextDueDate: unused,
      ...overrides.rules,
    },
    occurrences: {
      reserveOccurrence: unused,
      linkGeneratedTransaction: unused,
      clearGeneratedTransaction: unused,
      ...overrides.occurrences,
    },
    transactions: {
      findTransactionById: unused,
      findTransactionsByIds: unused,
      insertTransaction: unused,
      updateTransaction: unused,
      deleteTransaction: unused,
      ...overrides.transactions,
    },
    categories: {
      listCategories: unused,
      findCategoryById: unused,
      findActiveCategoryByNormalizedName: unused,
      insertCategory: unused,
      renameCategory: unused,
      reorderCategories: unused,
      archiveCategory: unused,
      ...overrides.categories,
    },
    tags: {
      listTags: unused,
      findTagById: unused,
      findActiveTagByNormalizedName: unused,
      insertTag: unused,
      renameTag: unused,
      archiveTag: unused,
      ...overrides.tags,
    },
    clock: new FixedClock(TODAY),
    createId: () => "rule-new",
    now: () => NOW,
  });
}

describe("createRecurringLifecycle", () => {
  it("previews a due date after an explicit day without touching storage", () => {
    expect(
      lifecycle().previewNextDueDate({
        monthlyDay: 31,
        after: "2026-01-31",
      }),
    ).toEqual({ ok: true, value: { nextDueDate: "2026-02-28" } });
  });

  it("rejects an unusable preview day", () => {
    expect(
      lifecycle().previewNextDueDate({ monthlyDay: 15, after: "not-a-day" }),
    ).toEqual({
      ok: false,
      errors: [{ field: "after", code: "invalidDate" }],
    });
  });

  it("refuses mutations that cannot roll back", () => {
    const unit = { isTransactional: false };

    expect(
      lifecycle().activateFromTransaction(unit, {
        workspaceId: WORKSPACE_ID,
        transactionId: "origin-1",
        monthlyDay: 8,
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
    expect(
      lifecycle().editRule(unit, {
        workspaceId: WORKSPACE_ID,
        ruleId: "rule-1",
        templateVersion: 1,
        monthlyDay: 8,
        type: "expense",
        amountMinor: 1,
        categoryId: "category-expense",
        concept: null,
        note: null,
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
  });

  it("activates from an existing movement", () => {
    const stored = storedRule();
    const created = movement();

    expect(
      lifecycle({
        rules: {
          findActiveRuleBySource: () => succeeded(null),
          insertRule: (_unit, command) => succeeded(command.rule),
        },
        transactions: {
          findTransactionById: () => transactionSucceeded(created),
        },
        categories: {
          findCategoryById: () => classificationSucceeded(stored.category),
        },
      }).activateFromTransaction(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          transactionId: "origin-1",
          monthlyDay: 8,
        },
      ),
    ).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          sourceTransactionId: "origin-1",
          nextDueDate: "2026-10-08",
        }),
      }),
    );
  });

  it("refuses a missing origin movement", () => {
    expect(
      lifecycle({
        rules: { findActiveRuleBySource: () => succeeded(null) },
        transactions: {
          findTransactionById: () => transactionSucceeded(null),
        },
      }).activateFromTransaction(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          transactionId: "origin-1",
          monthlyDay: 8,
        },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "transactionId", code: "notFound" }],
    });
  });

  it("maps a stale template version before writing", () => {
    expect(
      lifecycle({
        rules: {
          findRuleForUpdate: () => succeeded(storedRule()),
        },
      }).deactivateRule(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          ruleId: "rule-1",
          templateVersion: 2,
        },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "templateVersion", code: "invalidTemplateVersion" }],
    });
  });

  it("maps a repository listing failure", () => {
    expect(
      lifecycle({
        rules: { findActiveRules: () => failed("storageFailure") },
      }).listActiveRules(
        { isTransactional: false },
        { workspaceId: WORKSPACE_ID },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
  });

  it("maps every repository listing refusal onto a domain field error", () => {
    const mapping: ReadonlyArray<{
      readonly code: RecurringRepositoryErrorCode;
      readonly field: string;
      readonly domain: string;
    }> = [
      { code: "ruleNotFound", field: "id", domain: "notFound" },
      { code: "duplicateId", field: "id", domain: "invalidIdentifier" },
      {
        code: "activeRuleExists",
        field: "sourceTransactionId",
        domain: "activeRuleExists",
      },
      {
        code: "alreadyProcessed",
        field: "templateVersion",
        domain: "invalidTemplateVersion",
      },
      {
        code: "staleNextDueDate",
        field: "templateVersion",
        domain: "invalidTemplateVersion",
      },
      {
        code: "staleTemplateVersion",
        field: "templateVersion",
        domain: "invalidTemplateVersion",
      },
      {
        code: "alreadyDeactivated",
        field: "deactivatedAt",
        domain: "alreadyDeactivated",
      },
      { code: "occurrenceNotFound", field: "id", domain: "notFound" },
      { code: "unknownWorkspace", field: "workspaceId", domain: "notFound" },
      { code: "unknownCategory", field: "categoryId", domain: "notFound" },
      { code: "unknownTag", field: "tagId", domain: "notFound" },
      {
        code: "unknownTransaction",
        field: "transactionId",
        domain: "notFound",
      },
      { code: "transactionRequired", field: "storage", domain: "unavailable" },
      { code: "invalidStoredRow", field: "storage", domain: "unavailable" },
      { code: "storageFailure", field: "storage", domain: "unavailable" },
    ];

    for (const row of mapping) {
      expect(
        lifecycle({
          rules: { findActiveRules: () => failed(row.code) },
        }).listActiveRules(
          { isTransactional: false },
          { workspaceId: WORKSPACE_ID },
        ),
      ).toEqual({
        ok: false,
        errors: [{ field: row.field, code: row.domain }],
      });
    }
  });

  it("groups listed templates by type", () => {
    const expense = storedRule();
    const salary = createCategory({
      id: "category-income",
      name: "Sueldo",
      type: "income",
      sortOrder: 0,
      archivedAt: null,
    });

    if (!salary.ok) {
      throw new Error(`Expected a valid category: ${JSON.stringify(salary)}`);
    }

    const income = createRecurringRule({
      id: "rule-income",
      sourceTransactionId: null,
      type: "income",
      amountMinor: 250_000,
      category: salary.value,
      concept: null,
      note: null,
      tagIds: [],
      monthlyDay: 1,
      nextDueDate: "2026-10-01",
      templateVersion: 1,
      deactivatedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });

    if (!income.ok) {
      throw new Error(`Expected a valid rule: ${JSON.stringify(income)}`);
    }

    const listed = lifecycle({
      rules: {
        findActiveRules: () =>
          succeeded([
            { rule: expense.rule, category: expense.category },
            { rule: income.value, category: salary.value },
          ]),
      },
    }).listActiveRules(
      { isTransactional: false },
      { workspaceId: WORKSPACE_ID },
    );

    expect(listed.ok).toBe(true);
    if (!listed.ok) {
      return;
    }

    expect(listed.value.expenses.map((row) => row.rule.id)).toEqual(["rule-1"]);
    expect(listed.value.incomes.map((row) => row.rule.id)).toEqual([
      "rule-income",
    ]);
  });

  it("previews overdue dates of an active rule without writing", () => {
    expect(
      lifecycle({
        rules: {
          findRuleForUpdate: () => succeeded(storedRule("2026-07-31")),
        },
      }).previewCatchUp(
        { isTransactional: false },
        { workspaceId: WORKSPACE_ID, ruleId: "rule-1" },
      ),
    ).toEqual({
      ok: true,
      value: expect.objectContaining({
        pending: ["2026-07-31", "2026-08-08", "2026-09-08"],
      }),
    });
  });

  it("refuses catch-up preview of a missing, stopped or unreadable rule", () => {
    expect(
      lifecycle().previewCatchUp(
        { isTransactional: false },
        { workspaceId: WORKSPACE_ID, ruleId: "not a rule" },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "id", code: "invalidIdentifier" }],
    });
    expect(
      lifecycle({
        rules: { findRuleForUpdate: () => succeeded(null) },
      }).previewCatchUp(
        { isTransactional: false },
        { workspaceId: WORKSPACE_ID, ruleId: "rule-1" },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "id", code: "notFound" }],
    });
    expect(
      lifecycle({
        rules: { findRuleForUpdate: () => failed("storageFailure") },
      }).previewCatchUp(
        { isTransactional: false },
        { workspaceId: WORKSPACE_ID, ruleId: "rule-1" },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });

    const stopped = deactivateRecurringRule(storedRule().rule, NOW);

    if (!stopped.ok) {
      throw new Error(`Expected a stopped rule: ${JSON.stringify(stopped)}`);
    }

    expect(
      lifecycle({
        rules: {
          findRuleForUpdate: () =>
            succeeded({ rule: stopped.value, category: expenseCategory() }),
        },
      }).previewCatchUp(
        { isTransactional: false },
        { workspaceId: WORKSPACE_ID, ruleId: "rule-1" },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "deactivatedAt", code: "alreadyDeactivated" }],
    });
  });

  it("refuses an origin identifier a rule cannot store", () => {
    expect(
      lifecycle().activateFromTransaction(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          transactionId: "not an id",
          monthlyDay: 8,
        },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "transactionId", code: "invalidIdentifier" }],
    });
  });

  it("maps origin lookup refusals onto domain errors", () => {
    expect(
      lifecycle({
        rules: { findActiveRuleBySource: () => succeeded(null) },
        transactions: {
          findTransactionById: () => transactionFailed("duplicateId"),
        },
      }).activateFromTransaction(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          transactionId: "origin-1",
          monthlyDay: 8,
        },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "id", code: "invalidIdentifier" }],
    });
    expect(
      lifecycle({
        rules: { findActiveRuleBySource: () => succeeded(null) },
        transactions: {
          findTransactionById: () => transactionFailed("transactionNotFound"),
        },
      }).activateFromTransaction(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          transactionId: "origin-1",
          monthlyDay: 8,
        },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "transactionId", code: "notFound" }],
    });
    expect(
      lifecycle({
        rules: { findActiveRuleBySource: () => succeeded(null) },
        transactions: {
          findTransactionById: () => transactionFailed("unknownCategory"),
        },
      }).activateFromTransaction(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          transactionId: "origin-1",
          monthlyDay: 8,
        },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "categoryId", code: "notFound" }],
    });
    expect(
      lifecycle({
        rules: { findActiveRuleBySource: () => succeeded(null) },
        transactions: {
          findTransactionById: () => transactionFailed("unknownTag"),
        },
      }).activateFromTransaction(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          transactionId: "origin-1",
          monthlyDay: 8,
        },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "tagId", code: "notFound" }],
    });
    expect(
      lifecycle({
        rules: { findActiveRuleBySource: () => succeeded(null) },
        transactions: {
          findTransactionById: () => transactionFailed("unknownWorkspace"),
        },
      }).activateFromTransaction(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          transactionId: "origin-1",
          monthlyDay: 8,
        },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "workspaceId", code: "notFound" }],
    });
    expect(
      lifecycle({
        rules: { findActiveRuleBySource: () => succeeded(null) },
        transactions: {
          findTransactionById: () => transactionFailed("transactionRequired"),
        },
      }).activateFromTransaction(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          transactionId: "origin-1",
          monthlyDay: 8,
        },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
    expect(
      lifecycle({
        rules: { findActiveRuleBySource: () => succeeded(null) },
        transactions: {
          findTransactionById: () => transactionFailed("invalidStoredRow"),
        },
      }).activateFromTransaction(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          transactionId: "origin-1",
          monthlyDay: 8,
        },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
    expect(
      lifecycle({
        rules: { findActiveRuleBySource: () => succeeded(null) },
        transactions: {
          findTransactionById: () => transactionFailed("storageFailure"),
        },
      }).activateFromTransaction(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          transactionId: "origin-1",
          monthlyDay: 8,
        },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
  });

  it("refuses a second active rule while looking up the origin", () => {
    expect(
      lifecycle({
        rules: { findActiveRuleBySource: () => succeeded(storedRule()) },
      }).activateFromTransaction(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          transactionId: "origin-1",
          monthlyDay: 8,
        },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "sourceTransactionId", code: "activeRuleExists" }],
    });
  });

  it("maps a failed uniqueness lookup before copying a movement", () => {
    expect(
      lifecycle({
        rules: { findActiveRuleBySource: () => failed("storageFailure") },
      }).activateFromTransaction(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          transactionId: "origin-1",
          monthlyDay: 8,
        },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
  });

  it("refuses an unusable monthly day on activation", () => {
    expect(
      lifecycle().activateFromTransaction(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          transactionId: "origin-1",
          monthlyDay: 0,
        },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "monthlyDay", code: "invalidMonthlyDay" }],
    });
  });

  it("maps a refused insert after copying a movement", () => {
    const stored = storedRule();
    const created = movement();

    expect(
      lifecycle({
        rules: {
          findActiveRuleBySource: () => succeeded(null),
          insertRule: () => failed("unknownWorkspace"),
        },
        transactions: {
          findTransactionById: () => transactionSucceeded(created),
        },
        categories: {
          findCategoryById: () => classificationSucceeded(stored.category),
        },
      }).activateFromTransaction(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          transactionId: "origin-1",
          monthlyDay: 8,
        },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "workspaceId", code: "notFound" }],
    });
  });

  it("edits an active rule after a catch-up that has nothing overdue", () => {
    const stored = storedRule();

    expect(
      lifecycle({
        rules: {
          findRuleForUpdate: () => succeeded(stored),
          replaceActiveRule: (_unit, command) => succeeded(command.rule),
        },
        categories: {
          findCategoryById: () => classificationSucceeded(stored.category),
        },
      }).editRule(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          ruleId: "rule-1",
          templateVersion: 1,
          monthlyDay: 15,
          type: "expense",
          amountMinor: 90_000,
          categoryId: "category-expense",
          concept: "Alquiler actualizado",
          note: null,
        },
      ),
    ).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          generated: [],
          rule: expect.objectContaining({
            nextDueDate: "2026-09-15",
            templateVersion: 2,
          }),
        }),
      }),
    );
  });

  it("maps a catch-up refusal before replacing the template", () => {
    let reads = 0;

    expect(
      lifecycle({
        rules: {
          findRuleForUpdate: () => {
            reads += 1;
            return reads === 1
              ? succeeded(storedRule())
              : failed("alreadyProcessed");
          },
        },
        categories: {
          findCategoryById: () => classificationSucceeded(expenseCategory()),
        },
      }).editRule(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          ruleId: "rule-1",
          templateVersion: 1,
          monthlyDay: 15,
          type: "expense",
          amountMinor: 90_000,
          categoryId: "category-expense",
          concept: null,
          note: null,
        },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "templateVersion", code: "invalidTemplateVersion" }],
    });
  });

  it("maps a refused template replacement after catch-up", () => {
    expect(
      lifecycle({
        rules: {
          findRuleForUpdate: () => succeeded(storedRule()),
          replaceActiveRule: () => failed("alreadyDeactivated"),
        },
        categories: {
          findCategoryById: () => classificationSucceeded(expenseCategory()),
        },
      }).editRule(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          ruleId: "rule-1",
          templateVersion: 1,
          monthlyDay: 15,
          type: "expense",
          amountMinor: 90_000,
          categoryId: "category-expense",
          concept: null,
          note: null,
        },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "deactivatedAt", code: "alreadyDeactivated" }],
    });
  });

  it("deactivates an active rule after a catch-up that has nothing overdue", () => {
    expect(
      lifecycle({
        rules: {
          findRuleForUpdate: () => succeeded(storedRule()),
          deactivateRule: (_unit, command) => {
            const stopped = deactivateRecurringRule(
              storedRule().rule,
              command.deactivatedAt,
            );

            if (!stopped.ok) {
              throw new Error(
                `Expected a stopped rule: ${JSON.stringify(stopped)}`,
              );
            }

            return succeeded(stopped.value);
          },
        },
      }).deactivateRule(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          ruleId: "rule-1",
          templateVersion: 1,
        },
      ),
    ).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          generated: [],
          rule: expect.objectContaining({ deactivatedAt: NOW }),
        }),
      }),
    );
  });

  it("maps a refused deactivation write", () => {
    expect(
      lifecycle({
        rules: {
          findRuleForUpdate: () => succeeded(storedRule()),
          deactivateRule: () => failed("ruleNotFound"),
        },
      }).deactivateRule(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          ruleId: "rule-1",
          templateVersion: 1,
        },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "id", code: "notFound" }],
    });
  });

  it("refuses to edit a missing or already stopped rule", () => {
    expect(
      lifecycle({
        rules: { findRuleForUpdate: () => succeeded(null) },
      }).editRule(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          ruleId: "rule-1",
          templateVersion: 1,
          monthlyDay: 8,
          type: "expense",
          amountMinor: 1,
          categoryId: "category-expense",
          concept: null,
          note: null,
        },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "id", code: "notFound" }],
    });

    const stopped = deactivateRecurringRule(storedRule().rule, NOW);

    if (!stopped.ok) {
      throw new Error(`Expected a stopped rule: ${JSON.stringify(stopped)}`);
    }

    expect(
      lifecycle({
        rules: {
          findRuleForUpdate: () =>
            succeeded({ rule: stopped.value, category: expenseCategory() }),
        },
      }).deactivateRule(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          ruleId: "rule-1",
          templateVersion: 1,
        },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "deactivatedAt", code: "alreadyDeactivated" }],
    });
  });

  it("refuses creating a movement and a rule outside a transaction", () => {
    expect(
      lifecycle().activateWithNewTransaction(
        { isTransactional: false },
        {
          workspaceId: WORKSPACE_ID,
          type: "expense",
          amountMinor: 85_000,
          date: TODAY,
          categoryId: "category-expense",
          concept: null,
          note: null,
          monthlyDay: 8,
        },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
  });

  it("refuses an unusable monthly day before creating the origin movement", () => {
    expect(
      lifecycle().activateWithNewTransaction(
        { isTransactional: true },
        {
          workspaceId: WORKSPACE_ID,
          type: "expense",
          amountMinor: 85_000,
          date: TODAY,
          categoryId: "category-expense",
          concept: null,
          note: null,
          monthlyDay: 0,
        },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "monthlyDay", code: "invalidMonthlyDay" }],
    });
  });
});
