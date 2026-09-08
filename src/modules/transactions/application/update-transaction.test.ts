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
import type { Timestamp } from "../../../shared/domain/timestamp";
import { failed, succeeded } from "./ports/transaction-repository";
import type { TransactionRepository } from "./ports/transaction-repository";
import type { UnitOfWork } from "./ports/unit-of-work";
import type { Transaction } from "../domain/transaction";
import {
  type UpdateTransactionCommand,
  createUpdateTransaction,
} from "./update-transaction";

const unit: UnitOfWork = { isTransactional: true };
const autocommit: UnitOfWork = { isTransactional: false };
const TODAY = "2026-09-06" as LocalDate;
const TRANSACTION_ID = "0193f0a1-6f3d-7c62-9a24-8f5b0e1c2d35";
const CREATED_AT = 1_746_268_700_000;
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

function archivedExpenseCategory() {
  const built = createCategory({
    id: "category-expense",
    name: "Comida",
    type: "expense",
    sortOrder: 0,
    archivedAt: NOW,
  });

  if (!built.ok) {
    throw new Error(`Expected a valid category: ${JSON.stringify(built)}`);
  }

  return built.value;
}

function archivedOtherExpense() {
  const built = createCategory({
    id: "category-expense-other",
    name: "Ocio",
    type: "expense",
    sortOrder: 1,
    archivedAt: NOW,
  });

  if (!built.ok) {
    throw new Error(`Expected a valid category: ${JSON.stringify(built)}`);
  }

  return built.value;
}

function activeTag(id = "tag-friends", name = "Con Amigos") {
  const built = createTag({ id, name, archivedAt: null });

  if (!built.ok) {
    throw new Error(`Expected a valid tag: ${JSON.stringify(built)}`);
  }

  return built.value;
}

function archivedTag(id = "tag-archived", name = "Navidad") {
  const built = createTag({ id, name, archivedAt: NOW });

  if (!built.ok) {
    throw new Error(`Expected a valid tag: ${JSON.stringify(built)}`);
  }

  return built.value;
}

function storedMovement(overrides: Partial<Transaction> = {}): Transaction {
  const category = expenseCategory();

  return {
    id: TRANSACTION_ID as Transaction["id"],
    type: "expense",
    amountMinor: 1 as Transaction["amountMinor"],
    date: TODAY,
    categoryId: category.id,
    concept: null,
    note: null,
    tagIds: [],
    createdAt: CREATED_AT as Timestamp,
    updatedAt: CREATED_AT as Timestamp,
    ...overrides,
  };
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
  return createUpdateTransaction({
    categories: categories({
      findCategoryById: () => classificationSucceeded(expenseCategory()),
      ...categoryOverrides,
    }),
    tags: tags(tagOverrides),
    transactions: transactions({
      findTransactionById: () => succeeded(storedMovement()),
      updateTransaction: (_unit, update) => succeeded(update.transaction),
      ...transactionOverrides,
    }),
    clock: new FixedClock(TODAY),
    createId: () => "generated-tag",
    now: () => NOW,
  });
}

function command(
  overrides: Partial<UpdateTransactionCommand> = {},
): UpdateTransactionCommand {
  return {
    workspaceId: "workspace-1",
    transactionId: TRANSACTION_ID,
    type: "expense",
    amountMinor: 2_500,
    date: "2026-09-05",
    categoryId: expenseCategory().id,
    concept: "Café",
    note: "Editado",
    ...overrides,
  };
}

describe("createUpdateTransaction", () => {
  it("replaces type, date, category, tags and keeps the original createdAt", () => {
    const income = incomeCategory();
    const tag = activeTag();
    const updated = service(
      {
        findCategoryById: () => classificationSucceeded(income),
      },
      {
        findTagById: () => classificationSucceeded(tag),
      },
      {
        findTransactionById: () => succeeded(storedMovement()),
      },
    ).execute(
      unit,
      command({
        type: "income",
        categoryId: income.id,
        amountMinor: 250_000,
        tags: [{ tagId: tag.id }],
      }),
    );

    expect(updated).toEqual({
      ok: true,
      value: {
        id: TRANSACTION_ID,
        type: "income",
        amountMinor: 250_000,
        date: "2026-09-05",
        categoryId: income.id,
        concept: "Café",
        note: "Editado",
        tagIds: [tag.id],
        createdAt: CREATED_AT,
        updatedAt: NOW,
      },
    });
  });

  it("uses today's date and a system clock when none is injected", () => {
    const updated = createUpdateTransaction({
      categories: categories({
        findCategoryById: () => classificationSucceeded(expenseCategory()),
      }),
      tags: tags(),
      transactions: transactions({
        findTransactionById: () => succeeded(storedMovement()),
        updateTransaction: (_unit, update) => succeeded(update.transaction),
      }),
    }).execute(unit, command({ date: new SystemClock().today() }));

    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.date).toBe(new SystemClock().today());
      expect(updated.value.updatedAt).toBeGreaterThan(0);
    }
  });

  it("keeps the archived category the movement already has", () => {
    const archived = archivedExpenseCategory();
    const updated = service(
      {
        findCategoryById: () => classificationSucceeded(archived),
      },
      {},
      {
        findTransactionById: () =>
          succeeded(storedMovement({ categoryId: archived.id })),
      },
    ).execute(unit, command({ categoryId: archived.id }));

    expect(updated).toEqual({
      ok: true,
      value: expect.objectContaining({
        categoryId: archived.id,
        type: "expense",
      }),
    });
  });

  it("refuses a different archived category of the same type", () => {
    const other = archivedOtherExpense();
    const updated = service({
      findCategoryById: () => classificationSucceeded(other),
    }).execute(unit, command({ categoryId: other.id }));

    expect(updated).toEqual({
      ok: false,
      errors: [{ field: "categoryId", code: "archived" }],
    });
  });

  it("keeps an archived tag that was already linked and refuses a new archived one", () => {
    const linked = archivedTag("tag-linked", "Viaje");
    const extra = archivedTag("tag-extra", "Ocio");
    const kept = service(
      {},
      {
        findTagById: (_unit, query) => {
          if (query.tagId === linked.id) {
            return classificationSucceeded(linked);
          }

          if (query.tagId === extra.id) {
            return classificationSucceeded(extra);
          }

          return classificationSucceeded(null);
        },
      },
      {
        findTransactionById: () =>
          succeeded(storedMovement({ tagIds: [linked.id] })),
      },
    ).execute(unit, command({ tags: [{ tagId: linked.id }] }));

    expect(kept).toEqual({
      ok: true,
      value: expect.objectContaining({ tagIds: [linked.id] }),
    });

    const refused = service(
      {},
      {
        findTagById: () => classificationSucceeded(extra),
      },
      {
        findTransactionById: () =>
          succeeded(storedMovement({ tagIds: [linked.id] })),
      },
    ).execute(unit, command({ tags: [{ tagId: extra.id }] }));

    expect(refused).toEqual({
      ok: false,
      errors: [{ field: "tagId", code: "archived" }],
    });
  });

  it("collapses a repeated already-linked archived tag", () => {
    const linked = archivedTag();
    const updated = service(
      {},
      {
        findTagById: () => classificationSucceeded(linked),
      },
      {
        findTransactionById: () =>
          succeeded(storedMovement({ tagIds: [linked.id] })),
      },
    ).execute(
      unit,
      command({ tags: [{ tagId: linked.id }, { tagId: linked.id }] }),
    );

    expect(updated).toEqual({
      ok: true,
      value: expect.objectContaining({ tagIds: [linked.id] }),
    });
  });

  it("lets an already-linked active tag go through ordinary resolution", () => {
    const linked = activeTag();
    const updated = service(
      {},
      {
        findTagById: () => classificationSucceeded(linked),
      },
      {
        findTransactionById: () =>
          succeeded(storedMovement({ tagIds: [linked.id] })),
      },
    ).execute(unit, command({ tags: [{ tagId: linked.id }] }));

    expect(updated).toEqual({
      ok: true,
      value: expect.objectContaining({ tagIds: [linked.id] }),
    });
  });

  it("refuses a type change that keeps an incompatible category", () => {
    const updated = service().execute(
      unit,
      command({ type: "income", categoryId: expenseCategory().id }),
    );

    expect(updated).toEqual({
      ok: false,
      errors: [{ field: "type", code: "incompatibleCategoryType" }],
    });
  });

  it("refuses a date after today in Madrid", () => {
    const updated = service().execute(unit, command({ date: "2026-09-07" }));

    expect(updated).toEqual({
      ok: false,
      errors: [{ field: "date", code: "futureDate" }],
    });
  });

  it("refuses an invalid civil date before looking up tags", () => {
    const updated = service().execute(unit, command({ date: "2026-13-40" }));

    expect(updated).toEqual({
      ok: false,
      errors: [{ field: "date", code: "invalidDate" }],
    });
  });

  it("refuses a malformed movement identifier without reading storage", () => {
    const updated = service().execute(
      unit,
      command({ transactionId: "not a uuid" }),
    );

    expect(updated).toEqual({
      ok: false,
      errors: [{ field: "id", code: "invalidIdentifier" }],
    });
  });

  it("refuses a movement the workspace does not have", () => {
    const updated = service(
      {},
      {},
      {
        findTransactionById: () => succeeded(null),
      },
    ).execute(unit, command());

    expect(updated).toEqual({
      ok: false,
      errors: [{ field: "id", code: "notFound" }],
    });
  });

  it("refuses a category the workspace does not own", () => {
    const updated = service({
      findCategoryById: () => classificationSucceeded(null),
    }).execute(unit, command({ categoryId: "foreign-category" }));

    expect(updated).toEqual({
      ok: false,
      errors: [{ field: "categoryId", code: "notFound" }],
    });
  });

  it("refuses a malformed category identifier", () => {
    const updated = service().execute(
      unit,
      command({ categoryId: "not a category" }),
    );

    expect(updated).toEqual({
      ok: false,
      errors: [{ field: "categoryId", code: "invalidIdentifier" }],
    });
  });

  it("refuses an invalid transaction type before looking the category up", () => {
    const updated = service().execute(unit, command({ type: "transfer" }));

    expect(updated).toEqual({
      ok: false,
      errors: [{ field: "type", code: "invalidTransactionType" }],
    });
  });

  it("refuses to write when the unit cannot roll back", () => {
    const updated = service().execute(autocommit, command());

    expect(updated).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
  });

  it("refuses an amount that is not exact transaction money", () => {
    const updated = service().execute(unit, command({ amountMinor: 0 }));

    expect(updated).toEqual({
      ok: false,
      errors: [{ field: "amountMinor", code: "invalidAmount" }],
    });
  });

  it("refuses an injected instant that is not a timestamp", () => {
    const updated = createUpdateTransaction({
      categories: categories({
        findCategoryById: () => classificationSucceeded(expenseCategory()),
      }),
      tags: tags(),
      transactions: transactions({
        findTransactionById: () => succeeded(storedMovement()),
      }),
      clock: new FixedClock(TODAY),
      now: () => -1,
    }).execute(unit, command());

    expect(updated).toEqual({
      ok: false,
      errors: [{ field: "updatedAt", code: "invalidTimestamp" }],
    });
  });

  it("returns a storage failure when the stored movement cannot be rebuilt", () => {
    const updated = service(
      {},
      {},
      {
        findTransactionById: () => failed("invalidStoredRow"),
      },
    ).execute(unit, command());

    expect(updated).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
  });

  it("returns a category lookup failure as a field error", () => {
    const updated = service({
      findCategoryById: () => classificationFailed("storageFailure"),
    }).execute(unit, command());

    expect(updated).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
  });

  it("returns a missing already-linked tag as not found", () => {
    const linked = archivedTag();
    const updated = service(
      {},
      {
        findTagById: () => classificationSucceeded(null),
      },
      {
        findTransactionById: () =>
          succeeded(storedMovement({ tagIds: [linked.id] })),
      },
    ).execute(unit, command({ tags: [{ tagId: linked.id }] }));

    expect(updated).toEqual({
      ok: false,
      errors: [{ field: "tagId", code: "notFound" }],
    });
  });

  it("returns an already-linked tag lookup failure and a new tag refusal together", () => {
    const linked = archivedTag();
    const updated = service(
      {},
      {
        findTagById: () => classificationFailed("storageFailure"),
      },
      {
        findTransactionById: () =>
          succeeded(storedMovement({ tagIds: [linked.id] })),
      },
    ).execute(
      unit,
      command({
        tags: [{ tagId: linked.id }, { tagId: "not a tag" }],
      }),
    );

    expect(updated).toEqual({
      ok: false,
      errors: [
        { field: "storage", code: "unavailable" },
        { field: "tagId", code: "invalidIdentifier" },
      ],
    });
  });

  it("refuses more than twenty tags after keeping archived ones", () => {
    const linked = Array.from({ length: 20 }, (_, index) =>
      archivedTag(`tag-archived-${index}`, `Etiqueta ${index}`),
    );
    const byId = new Map(linked.map((tag) => [tag.id, tag]));
    const created = activeTag("generated-tag", "Nueva");
    const updated = service(
      {},
      {
        findTagById: (_unit, query) =>
          classificationSucceeded(byId.get(query.tagId) ?? null),
        findActiveTagByNormalizedName: () => classificationSucceeded(null),
        insertTag: () => classificationSucceeded(created),
      },
      {
        findTransactionById: () =>
          succeeded(storedMovement({ tagIds: linked.map((tag) => tag.id) })),
      },
    ).execute(
      unit,
      command({
        tags: [...linked.map((tag) => ({ tagId: tag.id })), { name: "Nueva" }],
      }),
    );

    expect(updated).toEqual({
      ok: false,
      errors: [{ field: "tags", code: "tooManyTags" }],
    });
  });

  it("translates every named update refusal into a domain field error", () => {
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
      const updated = service(
        {},
        {},
        {
          updateTransaction: () => failed(code),
        },
      ).execute(unit, command());

      expect(updated).toEqual({
        ok: false,
        errors: [{ field, code: expected }],
      });
    }
  });

  it("translates every named category lookup refusal", () => {
    const codes = [
      ["duplicateName", "categoryId", "duplicateName"],
      ["duplicateId", "id", "invalidIdentifier"],
      ["categoryNotFound", "categoryId", "notFound"],
      ["tagNotFound", "tagId", "notFound"],
      ["alreadyArchived", "categoryId", "alreadyArchived"],
      ["invalidCategoryOrder", "orderedCategoryIds", "invalidSortOrder"],
      ["transactionRequired", "orderedCategoryIds", "invalidSortOrder"],
      ["unknownWorkspace", "workspaceId", "notFound"],
      ["invalidStoredRow", "storage", "unavailable"],
    ] as const;

    for (const [code, field, expected] of codes) {
      const updated = service({
        findCategoryById: () => classificationFailed(code),
      }).execute(unit, command());

      expect(updated).toEqual({
        ok: false,
        errors: [{ field, code: expected }],
      });
    }
  });

  it("translates every named already-linked tag lookup refusal", () => {
    const linked = archivedTag();
    const codes = [
      ["duplicateName", "tagId", "duplicateName"],
      ["duplicateId", "id", "invalidIdentifier"],
      ["categoryNotFound", "categoryId", "notFound"],
      ["tagNotFound", "tagId", "notFound"],
      ["alreadyArchived", "tagId", "alreadyArchived"],
      ["invalidCategoryOrder", "orderedCategoryIds", "invalidSortOrder"],
      ["unknownWorkspace", "workspaceId", "notFound"],
      ["invalidStoredRow", "storage", "unavailable"],
    ] as const;

    for (const [code, field, expected] of codes) {
      const updated = service(
        {},
        {
          findTagById: () => classificationFailed(code),
        },
        {
          findTransactionById: () =>
            succeeded(storedMovement({ tagIds: [linked.id] })),
        },
      ).execute(unit, command({ tags: [{ tagId: linked.id }] }));

      expect(updated).toEqual({
        ok: false,
        errors: [{ field, code: expected }],
      });
    }
  });
});
