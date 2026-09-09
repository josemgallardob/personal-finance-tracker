import { describe, expect, it } from "vitest";

import type { CategoryDto } from "../../classification/contracts/category";
import type { TagDto } from "../../classification/contracts/tag";
import { transactionFormCopy } from "../../transactions/ui/transaction-form-schema";
import type { RecurringRuleDto } from "../contracts/recurring";
import {
  createRecurringRuleFormSchema,
  isValidMonthlyDay,
  recurringFormCopy,
  recurringRuleToFormValues,
  toRecurringRuleWriteBody,
  type RecurringRuleFormValues,
} from "./recurring-rule-form-schema";

const categories: readonly CategoryDto[] = [
  { id: "cat-rent", name: "Alquiler", type: "expense", isArchived: false },
  { id: "cat-old", name: "Antigua", type: "expense", isArchived: true },
  { id: "cat-salary", name: "Sueldo", type: "income", isArchived: false },
];

const tags: readonly TagDto[] = [
  { id: "tag-home", name: "Hogar", isArchived: false },
  { id: "tag-old", name: "Antigua", isArchived: true },
];

const rule: RecurringRuleDto = {
  id: "rule-1",
  sourceTransactionId: "tx-1",
  type: "expense",
  amountMinor: 125_050,
  categoryId: "cat-old",
  concept: "Alquiler",
  note: "Nota",
  tagIds: ["tag-old"],
  monthlyDay: 31,
  nextDueDate: "2026-10-31",
  templateVersion: 4,
};

function values(
  overrides: Partial<RecurringRuleFormValues> = {},
): RecurringRuleFormValues {
  return {
    type: "expense",
    amountText: "1250,50",
    categoryId: "cat-rent",
    concept: "Alquiler",
    note: "",
    tagSelections: [{ kind: "existing", tagId: "tag-home", name: "Hogar" }],
    monthlyDay: 5,
    ...overrides,
  };
}

function messagesOf(
  input: RecurringRuleFormValues,
  context = {
    categories,
    tags,
    retainedCategoryId: undefined as string | undefined,
  },
): readonly string[] {
  const parsed = createRecurringRuleFormSchema({
    categories: context.categories,
    tags: context.tags,
    retainedCategoryId: context.retainedCategoryId,
  }).safeParse(input);
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => issue.message);
}

describe("recurring rule form schema", () => {
  it("accepts the whole monthly range and rejects everything outside it", () => {
    expect(isValidMonthlyDay(1)).toBe(true);
    expect(isValidMonthlyDay(31)).toBe(true);
    expect(isValidMonthlyDay(0)).toBe(false);
    expect(isValidMonthlyDay(32)).toBe(false);
    expect(isValidMonthlyDay(5.5)).toBe(false);
    expect(isValidMonthlyDay(Number.NaN)).toBe(false);
    expect(messagesOf(values({ monthlyDay: 32 }))).toContain(
      recurringFormCopy.monthlyDayInvalid,
    );
    expect(messagesOf(values({ monthlyDay: 31 }))).toEqual([]);
  });

  it("refuses an empty, malformed or out-of-range amount", () => {
    expect(messagesOf(values({ amountText: "  " }))).toContain(
      transactionFormCopy.amountRequired,
    );
    expect(messagesOf(values({ amountText: "abc" }))).toContain(
      transactionFormCopy.amountInvalid,
    );
    expect(messagesOf(values({ amountText: "0,00" }))).toContain(
      transactionFormCopy.amountTooSmall,
    );
  });

  it("requires a category of the same type as the template", () => {
    expect(messagesOf(values({ categoryId: "" }))).toContain(
      transactionFormCopy.categoryRequired,
    );
    expect(messagesOf(values({ categoryId: "cat-salary" }))).toContain(
      transactionFormCopy.categoryIncompatible,
    );
    expect(
      messagesOf(values({ type: "income", categoryId: "cat-salary" })),
    ).toEqual([]);
  });

  it("keeps the archived classification the template already uses selectable", () => {
    expect(messagesOf(values({ categoryId: "cat-old" }))).toContain(
      transactionFormCopy.categoryIncompatible,
    );
    expect(
      messagesOf(values({ categoryId: "cat-old" }), {
        categories,
        tags,
        retainedCategoryId: "cat-old",
      }),
    ).toEqual([]);
  });

  it("rejects unknown, archived and repeated tags", () => {
    expect(
      messagesOf(
        values({
          tagSelections: [{ kind: "existing", tagId: "tag-gone", name: "X" }],
        }),
      ),
    ).toContain(transactionFormCopy.tagInvalid);
    expect(
      messagesOf(
        values({
          tagSelections: [
            { kind: "existing", tagId: "tag-old", name: "Antigua" },
          ],
        }),
      ),
    ).toContain(transactionFormCopy.tagInvalid);
    expect(
      messagesOf(
        values({
          tagSelections: [
            { kind: "pending", name: "Nueva" },
            { kind: "pending", name: "nueva" },
          ],
        }),
      ),
    ).toContain(transactionFormCopy.tagsDuplicate);
    expect(
      messagesOf(values({ tagSelections: [{ kind: "pending", name: "  " }] })),
    ).toContain(transactionFormCopy.tagInvalid);
  });

  it("rejects free text that exceeds its limit", () => {
    expect(messagesOf(values({ concept: "a".repeat(201) }))).toContain(
      transactionFormCopy.conceptTooLong,
    );
    expect(messagesOf(values({ note: "a".repeat(2001) }))).toContain(
      transactionFormCopy.noteTooLong,
    );
  });

  it("shows the stored template, including a tag the catalog no longer names", () => {
    expect(recurringRuleToFormValues(rule, tags)).toEqual({
      type: "expense",
      amountText: "1250,50",
      categoryId: "cat-old",
      concept: "Alquiler",
      note: "Nota",
      tagSelections: [{ kind: "existing", tagId: "tag-old", name: "Antigua" }],
      monthlyDay: 31,
    });
    expect(recurringRuleToFormValues(rule, []).tagSelections).toEqual([
      { kind: "existing", tagId: "tag-old", name: "tag-old" },
    ]);
    expect(
      recurringRuleToFormValues({ ...rule, concept: null, note: null }, tags),
    ).toMatchObject({ concept: "", note: "" });
  });

  it("writes the complete template with the version it was read at", () => {
    expect(toRecurringRuleWriteBody(values(), 4)).toEqual({
      templateVersion: 4,
      type: "expense",
      amountMinor: 125_050,
      categoryId: "cat-rent",
      concept: "Alquiler",
      note: null,
      tagInputs: [{ tagId: "tag-home" }],
      monthlyDay: 5,
    });
  });

  it("refuses to build a body from an amount validation never accepted", () => {
    expect(() =>
      toRecurringRuleWriteBody(values({ amountText: "x" }), 1),
    ).toThrow(/Validated amount was rejected/u);
  });
});
