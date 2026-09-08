import { describe, expect, it } from "vitest";

import { createCategory } from "../../domain/category";
import { createTag } from "../../domain/tag";
import { failed, succeeded } from "../ports/classification-repository";
import type { CategoryRepository } from "../ports/category-repository";
import type { TagRepository } from "../ports/tag-repository";
import type { UnitOfWork } from "../ports/unit-of-work";
import { createClassificationMaintenance } from "./classification-maintenance";

const unit: UnitOfWork = { isTransactional: true };
const autocommit: UnitOfWork = { isTransactional: false };

function unused(): never {
  throw new Error("Unexpected repository method");
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

function services(
  categoryOverrides: Partial<CategoryRepository> = {},
  tagOverrides: Partial<TagRepository> = {},
) {
  return createClassificationMaintenance({
    categories: categories(categoryOverrides),
    tags: tags(tagOverrides),
    createId: () => "generated-id",
    now: () => 1_746_268_800_000,
  });
}

describe("classification maintenance error translation", () => {
  it("translates a duplicate name into a field error, not an unexpected failure", () => {
    const maintenance = services({
      listCategories: () => succeeded([]),
      insertCategory: () => failed("duplicateName"),
    });

    expect(
      maintenance.createCategory(unit, {
        workspaceId: "workspace-1",
        name: "Casa",
        type: "expense",
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "name", code: "duplicateName" }],
    });
  });

  it("translates every named repository refusal into a domain field error", () => {
    const maintenance = services(
      {
        listCategories: () => failed("storageFailure", "disk"),
        findCategoryById: () => failed("invalidStoredRow", "mismatch"),
        reorderCategories: () => failed("invalidCategoryOrder"),
        archiveCategory: () => failed("alreadyArchived"),
        insertCategory: () => failed("duplicateId"),
      },
      {
        findTagById: () => failed("tagNotFound"),
        insertTag: () => failed("unknownWorkspace"),
        archiveTag: () => failed("alreadyArchived"),
      },
    );

    expect(
      maintenance.createCategory(unit, {
        workspaceId: "workspace-1",
        name: "Casa",
        type: "expense",
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
    expect(
      maintenance.renameCategory(unit, {
        workspaceId: "workspace-1",
        categoryId: "category-1",
        name: "Casa",
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
    expect(
      maintenance.reorderCategories(autocommit, {
        workspaceId: "workspace-1",
        type: "expense",
        orderedCategoryIds: ["category-1"],
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "orderedCategoryIds", code: "invalidSortOrder" }],
    });
    expect(
      maintenance.archiveCategory(unit, {
        workspaceId: "workspace-1",
        categoryId: "category-1",
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "categoryId", code: "alreadyArchived" }],
    });
    expect(
      services({
        listCategories: () => succeeded([]),
        insertCategory: () => failed("duplicateId"),
      }).createCategory(unit, {
        workspaceId: "workspace-1",
        name: "Casa",
        type: "expense",
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "id", code: "invalidIdentifier" }],
    });
    expect(
      maintenance.requireAssignableTag(unit, {
        workspaceId: "workspace-1",
        tagId: "tag-1",
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "tagId", code: "notFound" }],
    });
    expect(
      maintenance.createTag(unit, {
        workspaceId: "missing-workspace",
        name: "Navidad",
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "workspaceId", code: "notFound" }],
    });
    expect(
      maintenance.archiveTag(unit, {
        workspaceId: "workspace-1",
        tagId: "tag-1",
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "tagId", code: "alreadyArchived" }],
    });
  });

  it("uses the default identifier and clock sources on a successful write", () => {
    const maintenance = createClassificationMaintenance({
      categories: categories({
        listCategories: () => succeeded([]),
        insertCategory: (_unit, command) => succeeded(command.category),
      }),
      tags: tags({
        findTagById: () => failed("storageFailure", "closed"),
        insertTag: (_unit, command) => succeeded(command.tag),
      }),
    });

    const created = maintenance.createCategory(unit, {
      workspaceId: "workspace-1",
      name: "Casa",
      type: "expense",
    });
    const tag = maintenance.createTag(unit, {
      workspaceId: "workspace-1",
      name: "Navidad",
    });

    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value.id.length).toBeGreaterThan(0);
      expect(created.value.sortOrder).toBe(0);
    }

    expect(tag.ok).toBe(true);
    expect(
      maintenance.requireAssignableTag(unit, {
        workspaceId: "workspace-1",
        tagId: "tag-1",
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
  });

  it("translates a missing category on archive and a required transaction on reorder", () => {
    const maintenance = services({
      archiveCategory: () => failed("categoryNotFound"),
      reorderCategories: () => failed("transactionRequired"),
    });

    expect(
      maintenance.archiveCategory(unit, {
        workspaceId: "workspace-1",
        categoryId: "category-1",
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "categoryId", code: "notFound" }],
    });
    expect(
      maintenance.reorderCategories(autocommit, {
        workspaceId: "workspace-1",
        type: "expense",
        orderedCategoryIds: ["category-1"],
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "orderedCategoryIds", code: "invalidSortOrder" }],
    });
  });

  it("translates lookup failures on rename and assignability", () => {
    const maintenance = services(
      {
        findCategoryById: () => failed("storageFailure", "closed"),
      },
      {
        findTagById: () => failed("storageFailure", "closed"),
      },
    );

    expect(
      maintenance.renameCategory(unit, {
        workspaceId: "workspace-1",
        categoryId: "category-1",
        name: "Casa",
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
    expect(
      maintenance.renameTag(unit, {
        workspaceId: "workspace-1",
        tagId: "tag-1",
        name: "Navidad",
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
    expect(
      maintenance.requireAssignableCategory(unit, {
        workspaceId: "workspace-1",
        categoryId: "category-1",
        type: "expense",
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
  });

  it("rejects a blank rename through the domain contract", () => {
    const category = createCategory({
      id: "category-1",
      name: "Casa",
      type: "expense",
      sortOrder: 0,
      archivedAt: null,
    });
    const tag = createTag({
      id: "tag-1",
      name: "Navidad",
      archivedAt: null,
    });

    if (!category.ok || !tag.ok) {
      throw new Error("Expected valid fixtures");
    }

    const maintenance = services(
      { findCategoryById: () => succeeded(category.value) },
      { findTagById: () => succeeded(tag.value) },
    );

    expect(
      maintenance.renameCategory(unit, {
        workspaceId: "workspace-1",
        categoryId: "category-1",
        name: "  ",
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "name", code: "required" }],
    });
    expect(
      maintenance.renameTag(unit, {
        workspaceId: "workspace-1",
        tagId: "tag-1",
        name: "  ",
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "name", code: "required" }],
    });
  });
});
