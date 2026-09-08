import { describe, expect, it } from "vitest";

import { createCategory } from "../domain/category";
import { toCategoryDto } from "./category";

function category(name: string, archivedAt: number | null) {
  const built = createCategory({
    id: "category-1",
    name,
    type: "expense",
    sortOrder: 4,
    archivedAt,
  });

  if (!built.ok) {
    throw new Error(`Expected a valid category: ${JSON.stringify(built)}`);
  }

  return built.value;
}

describe("toCategoryDto", () => {
  it("exposes isArchived and hides storage fields of an active category", () => {
    const dto = toCategoryDto(category("  Casa  ", null));

    expect(dto).toEqual({
      id: "category-1",
      name: "Casa",
      type: "expense",
      isArchived: false,
    });
    expect(Object.keys(dto).sort()).toEqual([
      "id",
      "isArchived",
      "name",
      "type",
    ]);
  });

  it("marks an archived category without echoing the archive timestamp", () => {
    const dto = toCategoryDto(category("Ocio", 1_746_268_800_000));

    expect(dto).toEqual({
      id: "category-1",
      name: "Ocio",
      type: "expense",
      isArchived: true,
    });
    expect(dto).not.toHaveProperty("archivedAt");
    expect(dto).not.toHaveProperty("workspaceId");
    expect(dto).not.toHaveProperty("normalizedName");
    expect(dto).not.toHaveProperty("sortOrder");
  });
});
