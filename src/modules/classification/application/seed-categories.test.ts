import { describe, expect, it } from "vitest";

import type { InitialCategorySeed } from "../domain/initial-category-catalog";
import type { CategoryRepository } from "./ports/category-repository";
import { failed, succeeded } from "./ports/classification-repository";
import type { UnitOfWork } from "./ports/unit-of-work";
import { seedCategories } from "./seed-categories";

const transactional: UnitOfWork = { isTransactional: true };

const seedRow: InitialCategorySeed = {
  id: "seed-exp-alquiler",
  name: "Alquiler",
  type: "expense",
  iconKey: "rent",
  color: "#5B8CFF",
};

function unused(): never {
  throw new Error("Unexpected repository method");
}

function repository(
  overrides: Partial<CategoryRepository>,
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

describe("seedCategories refusals", () => {
  it("propagates a lookup failure before inserting anything", () => {
    const result = seedCategories(
      transactional,
      repository({
        findCategoryById: () => failed("storageFailure", "lookup"),
      }),
      { workspaceId: "workspace-1", catalog: [seedRow] },
    );

    expect(result).toEqual({
      ok: false,
      error: { code: "storageFailure", cause: "lookup" },
    });
  });

  it("propagates a name lookup failure without inserting the seed", () => {
    const result = seedCategories(
      transactional,
      repository({
        findCategoryById: () => succeeded(null),
        findActiveCategoryByNormalizedName: () =>
          failed("storageFailure", "name"),
      }),
      { workspaceId: "workspace-1", catalog: [seedRow] },
    );

    expect(result).toEqual({
      ok: false,
      error: { code: "storageFailure", cause: "name" },
    });
  });

  it("propagates an insert refusal", () => {
    const result = seedCategories(
      transactional,
      repository({
        findCategoryById: () => succeeded(null),
        findActiveCategoryByNormalizedName: () => succeeded(null),
        insertCategory: () => failed("duplicateId"),
      }),
      { workspaceId: "workspace-1", catalog: [seedRow] },
    );

    expect(result).toEqual({
      ok: false,
      error: { code: "duplicateId" },
    });
  });
});
