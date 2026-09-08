import { describe, expect, it } from "vitest";

import { createCategory } from "../../classification/domain/category";
import { createTransaction } from "../domain/transaction";
import { toTransactionCursorPageDto, toTransactionDto } from "./transaction";

function transaction() {
  const category = createCategory({
    id: "category-1",
    name: "Comida",
    type: "expense",
    sortOrder: 0,
    archivedAt: null,
  });

  if (!category.ok) {
    throw new Error(`Expected a valid category: ${JSON.stringify(category)}`);
  }

  const built = createTransaction({
    id: "0193f0a1-6f3d-7c62-9a24-8f5b0e1c2d35",
    type: "expense",
    amountMinor: 1_250,
    date: "2026-09-06",
    category: category.value,
    concept: "Pan",
    note: "Compra del día",
    tagIds: ["tag-1"],
    createdAt: 1_746_268_800_000,
    updatedAt: 1_746_268_900_000,
  });

  if (!built.ok) {
    throw new Error(`Expected a valid transaction: ${JSON.stringify(built)}`);
  }

  return built.value;
}

describe("toTransactionDto", () => {
  it("exposes minor units and an ISO date and hides storage fields", () => {
    const dto = toTransactionDto(transaction());

    expect(dto).toEqual({
      id: "0193f0a1-6f3d-7c62-9a24-8f5b0e1c2d35",
      type: "expense",
      amountMinor: 1_250,
      date: "2026-09-06",
      categoryId: "category-1",
      concept: "Pan",
      note: "Compra del día",
      tagIds: ["tag-1"],
    });
    expect(Object.keys(dto).sort()).toEqual([
      "amountMinor",
      "categoryId",
      "concept",
      "date",
      "id",
      "note",
      "tagIds",
      "type",
    ]);
    expect(dto).not.toHaveProperty("createdAt");
    expect(dto).not.toHaveProperty("updatedAt");
    expect(dto).not.toHaveProperty("workspaceId");
    expect(dto).not.toHaveProperty("recurringRuleId");
  });
});

describe("toTransactionCursorPageDto", () => {
  it("maps items and keeps the opaque cursor without leaking internals", () => {
    const page = toTransactionCursorPageDto([transaction()], "opaque-cursor");

    expect(page).toEqual({
      items: [toTransactionDto(transaction())],
      nextCursor: "opaque-cursor",
    });
    expect(JSON.stringify(page)).not.toContain("createdAt");
    expect(JSON.stringify(page)).not.toContain("workspace");
  });
});
