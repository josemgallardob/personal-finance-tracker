import { describe, expect, it } from "vitest";

import type { CategoryRepository } from "../../classification/application/ports/category-repository";
import {
  failed as classificationFailed,
  succeeded as classificationSucceeded,
} from "../../classification/application/ports/classification-repository";
import type { TagRepository } from "../../classification/application/ports/tag-repository";
import { createCategory } from "../../classification/domain/category";
import { createTag } from "../../classification/domain/tag";
import { FixedClock, SystemClock } from "../../../shared/domain/clock";
import type { LocalDate } from "../../../shared/domain/dates";
import { failed, succeeded } from "./ports/transaction-repository";
import type { TransactionRepository } from "./ports/transaction-repository";
import type { UnitOfWork } from "./ports/unit-of-work";
import {
  type CreateTransactionCommand,
  createCreateTransaction,
} from "./create-transaction";

const unit: UnitOfWork = { isTransactional: true };
const autocommit: UnitOfWork = { isTransactional: false };
const TODAY = "2026-09-06" as LocalDate;
const GENERATED_ID = "0193f0a1-6f3d-7c62-9a24-8f5b0e1c2d35";
const NOW = 1_746_268_800_000;

function unused(): never {
  throw new Error("Unexpected repository method");
}

function expenseCategory() {
  const built = createCategory({
    id: "category-expense",
    name: "Comida",
    type: "expense",
    sortOrder: 0,
    archivedAt: null,
  });

  if (!built.ok) {
    throw new Error(`Expected a valid category: ${JSON.stringify(built)}`);
  }

  return built.value;
}

function incomeCategory() {
  const built = createCategory({
    id: "category-income",
    name: "Nómina",
    type: "income",
    sortOrder: 0,
    archivedAt: null,
  });

  if (!built.ok) {
    throw new Error(`Expected a valid category: ${JSON.stringify(built)}`);
  }

  return built.value;
}

function activeTag() {
  const built = createTag({
    id: "tag-friends",
    name: "Con Amigos",
    archivedAt: null,
  });

  if (!built.ok) {
    throw new Error(`Expected a valid tag: ${JSON.stringify(built)}`);
  }

  return built.value;
}

function categories(
  overrides: Partial<CategoryRepository> = {},
): CategoryRepository {
  return {
    listCategories: unused,
    findCategoryById: unused,
    findActiveCategoryByNormalizedName: unused,
    insertCategory: unused,
    renameCategory: unused,
    reorderCategories: unused,
    archiveCategory: unused,
    ...overrides,
  };
}

function tags(overrides: Partial<TagRepository> = {}): TagRepository {
  return {
    listTags: unused,
    findTagById: unused,
    findActiveTagByNormalizedName: unused,
    insertTag: unused,
    renameTag: unused,
    archiveTag: unused,
    ...overrides,
  };
}

function transactions(
  overrides: Partial<TransactionRepository> = {},
): TransactionRepository {
  return {
    findTransactionById: unused,
    findTransactionsByIds: unused,
    insertTransaction: unused,
    updateTransaction: unused,
    deleteTransaction: unused,
    ...overrides,
  };
}

function service(
  categoryOverrides: Partial<CategoryRepository> = {},
  tagOverrides: Partial<TagRepository> = {},
  transactionOverrides: Partial<TransactionRepository> = {},
) {
  return createCreateTransaction({
    categories: categories(categoryOverrides),
    tags: tags(tagOverrides),
    transactions: transactions(transactionOverrides),
    clock: new FixedClock(TODAY),
    createId: () => GENERATED_ID,
    now: () => NOW,
  });
}

function command(
  overrides: Partial<CreateTransactionCommand> = {},
): CreateTransactionCommand {
  return {
    workspaceId: "workspace-1",
    type: "expense",
    amountMinor: 1,
    date: TODAY,
    categoryId: expenseCategory().id,
    concept: null,
    note: null,
    ...overrides,
  };
}

describe("createCreateTransaction", () => {
  it("assigns a server identifier when the caller does not supply one", () => {
    const created = createCreateTransaction({
      categories: categories({
        findCategoryById: () => classificationSucceeded(expenseCategory()),
      }),
      tags: tags(),
      transactions: transactions({
        insertTransaction: (_unit, insert) => succeeded(insert.transaction),
      }),
    }).execute(unit, command({ date: new SystemClock().today() }));

    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      expect(created.value.date).toBe(new SystemClock().today());
      expect(created.value.createdAt).toBe(created.value.updatedAt);
    }
  });

  it("creates an expense with a server identifier and exact minor units", () => {
    const category = expenseCategory();
    const created = service(
      {
        findCategoryById: () => classificationSucceeded(category),
      },
      {},
      {
        insertTransaction: (_unit, insert) => succeeded(insert.transaction),
      },
    ).execute(unit, command({ amountMinor: 1 }));

    expect(created).toEqual({
      ok: true,
      value: {
        id: GENERATED_ID,
        type: "expense",
        amountMinor: 1,
        date: TODAY,
        categoryId: category.id,
        concept: null,
        note: null,
        tagIds: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
  });

  it("creates an income of the compatible category", () => {
    const category = incomeCategory();
    const created = service(
      {
        findCategoryById: () => classificationSucceeded(category),
      },
      {},
      {
        insertTransaction: (_unit, insert) => succeeded(insert.transaction),
      },
    ).execute(
      unit,
      command({
        type: "income",
        categoryId: category.id,
        amountMinor: 250_000,
      }),
    );

    expect(created).toEqual({
      ok: true,
      value: expect.objectContaining({
        id: GENERATED_ID,
        type: "income",
        amountMinor: 250_000,
        categoryId: category.id,
      }),
    });
  });

  it("keeps optional concept, note and resolved tags on the stored movement", () => {
    const category = expenseCategory();
    const tag = activeTag();
    const created = service(
      {
        findCategoryById: () => classificationSucceeded(category),
      },
      {
        findTagById: () => classificationSucceeded(tag),
      },
      {
        insertTransaction: (_unit, insert) => succeeded(insert.transaction),
      },
    ).execute(
      unit,
      command({
        concept: "  Café con leche  ",
        note: "Primera línea\nSegunda línea",
        tags: [{ tagId: tag.id }],
      }),
    );

    expect(created).toEqual({
      ok: true,
      value: expect.objectContaining({
        concept: "Café con leche",
        note: "Primera línea\nSegunda línea",
        tagIds: [tag.id],
      }),
    });
  });

  it("refuses a date after today in Madrid", () => {
    const created = service({
      findCategoryById: () => classificationSucceeded(expenseCategory()),
    }).execute(unit, command({ date: "2026-09-07" }));

    expect(created).toEqual({
      ok: false,
      errors: [{ field: "date", code: "futureDate" }],
    });
  });

  it("refuses an invalid civil date before looking up tags", () => {
    const created = service({
      findCategoryById: () => classificationSucceeded(expenseCategory()),
    }).execute(unit, command({ date: "2026-13-40" }));

    expect(created).toEqual({
      ok: false,
      errors: [{ field: "date", code: "invalidDate" }],
    });
  });

  it("refuses an archived category", () => {
    const archived = createCategory({
      id: "category-expense",
      name: "Comida",
      type: "expense",
      sortOrder: 0,
      archivedAt: NOW,
    });

    if (!archived.ok) {
      throw new Error(`Expected a valid category: ${JSON.stringify(archived)}`);
    }

    const created = service({
      findCategoryById: () => classificationSucceeded(archived.value),
    }).execute(unit, command({ categoryId: archived.value.id }));

    expect(created).toEqual({
      ok: false,
      errors: [{ field: "categoryId", code: "archived" }],
    });
  });

  it("refuses a category the workspace does not own", () => {
    const created = service({
      findCategoryById: () => classificationSucceeded(null),
    }).execute(unit, command({ categoryId: "foreign-category" }));

    expect(created).toEqual({
      ok: false,
      errors: [{ field: "categoryId", code: "notFound" }],
    });
  });

  it("refuses a category of the opposite type", () => {
    const created = service({
      findCategoryById: () => classificationSucceeded(incomeCategory()),
    }).execute(
      unit,
      command({ type: "expense", categoryId: incomeCategory().id }),
    );

    expect(created).toEqual({
      ok: false,
      errors: [{ field: "type", code: "incompatibleCategoryType" }],
    });
  });

  it("refuses to write when the unit cannot roll back", () => {
    const created = service().execute(autocommit, command());

    expect(created).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
  });

  it("refuses an amount that is not exact transaction money", () => {
    const created = service({
      findCategoryById: () => classificationSucceeded(expenseCategory()),
    }).execute(unit, command({ amountMinor: 0 }));

    expect(created).toEqual({
      ok: false,
      errors: [{ field: "amountMinor", code: "invalidAmount" }],
    });
  });

  it("refuses an injected instant that is not a timestamp", () => {
    const created = createCreateTransaction({
      categories: categories({
        findCategoryById: () => classificationSucceeded(expenseCategory()),
      }),
      tags: tags(),
      transactions: transactions(),
      clock: new FixedClock(TODAY),
      now: () => -1,
    }).execute(unit, command());

    expect(created).toEqual({
      ok: false,
      errors: [{ field: "createdAt", code: "invalidTimestamp" }],
    });
  });

  it("returns tag field errors instead of inserting the movement", () => {
    const created = service(
      {
        findCategoryById: () => classificationSucceeded(expenseCategory()),
      },
      {
        findTagById: () => classificationFailed("tagNotFound"),
      },
    ).execute(unit, command({ tags: [{ tagId: "tag-missing" }] }));

    expect(created).toEqual({
      ok: false,
      errors: [{ field: "tagId", code: "notFound" }],
    });
  });

  it("translates every named insert refusal into a domain field error", () => {
    const category = expenseCategory();
    const codes = [
      ["duplicateId", "id", "invalidIdentifier"],
      ["transactionNotFound", "id", "notFound"],
      ["unknownCategory", "categoryId", "notFound"],
      ["unknownTag", "tagId", "notFound"],
      ["unknownWorkspace", "workspaceId", "notFound"],
      ["transactionRequired", "storage", "unavailable"],
      ["invalidStoredRow", "storage", "unavailable"],
      ["storageFailure", "storage", "unavailable"],
    ] as const;

    for (const [code, field, expected] of codes) {
      const created = service(
        {
          findCategoryById: () => classificationSucceeded(category),
        },
        {},
        {
          insertTransaction: () => failed(code),
        },
      ).execute(unit, command());

      expect(created).toEqual({
        ok: false,
        errors: [{ field, code: expected }],
      });
    }
  });
});
