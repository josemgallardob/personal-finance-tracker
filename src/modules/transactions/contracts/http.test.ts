import { describe, expect, it } from "vitest";

import {
  transactionCursorPageDtoSchema,
  transactionDtoSchema,
  transactionListQuerySchema,
  transactionWriteBodySchema,
} from "./http";

const movement = {
  id: "tx-1",
  type: "expense",
  amountMinor: 1250,
  date: "2026-09-06",
  categoryId: "cat-1",
  concept: null,
  note: null,
  tagIds: [],
};

describe("transaction HTTP contracts", () => {
  it("accepts a documented movement and an empty cursor page", () => {
    expect(transactionDtoSchema.parse(movement)).toEqual(movement);
    expect(
      transactionCursorPageDtoSchema.parse({ items: [], nextCursor: null }),
    ).toEqual({ items: [], nextCursor: null });
  });

  it("refuses a movement that carries a storage timestamp", () => {
    expect(
      transactionDtoSchema.safeParse({ ...movement, createdAt: 1 }).success,
    ).toBe(false);
  });

  it("accepts a repeated tagId query and a write body with mixed tag inputs", () => {
    expect(
      transactionListQuerySchema.parse({
        tagId: ["a", "b"],
        untagged: "false",
        limit: "20",
      }),
    ).toEqual({ tagId: ["a", "b"], untagged: "false", limit: 20 });
    expect(
      transactionWriteBodySchema.parse({
        type: "income",
        amountMinor: 100,
        date: "2026-09-06",
        categoryId: "cat-1",
        tagInputs: [{ tagId: "t1" }, { name: "Nuevo" }],
      }),
    ).toMatchObject({
      tagInputs: [{ tagId: "t1" }, { name: "Nuevo" }],
    });
  });

  it("refuses a write body that tries to choose the workspace", () => {
    expect(
      transactionWriteBodySchema.safeParse({
        type: "expense",
        amountMinor: 1,
        date: "2026-09-06",
        categoryId: "cat-1",
        workspaceId: "w-1",
      }).success,
    ).toBe(false);
  });
});
