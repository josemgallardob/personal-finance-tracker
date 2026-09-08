import { describe, expect, it } from "vitest";

import {
  categoryDtoSchema,
  categoryListQuerySchema,
  createCategoryBodySchema,
  tagDtoSchema,
} from "./http";

describe("classification HTTP contracts", () => {
  it("accepts a documented category and tag representation", () => {
    expect(
      categoryDtoSchema.parse({
        id: "cat-1",
        name: "Casa",
        type: "expense",
        isArchived: false,
      }),
    ).toEqual({
      id: "cat-1",
      name: "Casa",
      type: "expense",
      isArchived: false,
    });
    expect(
      tagDtoSchema.parse({
        id: "tag-1",
        name: "Viajes",
        isArchived: true,
      }),
    ).toMatchObject({ isArchived: true });
  });

  it("refuses a category that carries a workspace identifier", () => {
    expect(
      categoryDtoSchema.safeParse({
        id: "cat-1",
        name: "Casa",
        type: "expense",
        isArchived: false,
        workspaceId: "w-1",
      }).success,
    ).toBe(false);
  });

  it("refuses an unknown list filter and an unknown create field", () => {
    expect(
      categoryListQuerySchema.safeParse({ status: "active", foo: "1" }).success,
    ).toBe(false);
    expect(
      createCategoryBodySchema.safeParse({
        name: "Casa",
        type: "expense",
        workspaceId: "w-1",
      }).success,
    ).toBe(false);
  });
});
