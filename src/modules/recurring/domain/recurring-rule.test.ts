import { describe, expect, it } from "vitest";

import type { Category } from "../../classification/domain/category";
import { createCategory } from "../../classification/domain/category";
import {
  MAX_CONCEPT_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_TAGS_PER_TRANSACTION,
} from "../../transactions/domain/transaction";
import {
  MAX_TRANSACTION_MINOR,
  MIN_TRANSACTION_MINOR,
} from "../../../shared/domain/money";
import { MAX_MONTHLY_DAY } from "./recurrence-calendar";
import type { RecurringRuleInput } from "./recurring-rule";
import {
  INITIAL_TEMPLATE_VERSION,
  createRecurringRule,
  deactivateRecurringRule,
  isActiveRecurringRule,
} from "./recurring-rule";

function categoryOf(type: string, name: string): Category {
  const result = createCategory({
    id: "0193f0a1-6f3d-7c62-9a24-8f5b0e1c2d34",
    name,
    type,
    sortOrder: 0,
    archivedAt: null,
  });

  if (!result.ok) {
    throw new Error(
      `Expected a valid category, got ${JSON.stringify(result.errors)}`,
    );
  }

  return result.value;
}

const EXPENSE_CATEGORY = categoryOf("expense", "Suscripciones");
const INCOME_CATEGORY = categoryOf("income", "Sueldo");
const NOW = 1_757_145_600_000;

const VALID_INPUT: RecurringRuleInput = {
  id: "0193f0a1-6f3d-7c62-9a24-8f5b0e1c2d40",
  sourceTransactionId: "0193f0a1-6f3d-7c62-9a24-8f5b0e1c2d41",
  type: "expense",
  amountMinor: 1299,
  category: EXPENSE_CATEGORY,
  concept: "Suscripción mensual",
  note: null,
  tagIds: ["tag-casa", "tag-ocio"],
  monthlyDay: 31,
  nextDueDate: "2026-09-30",
  templateVersion: INITIAL_TEMPLATE_VERSION,
  deactivatedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function created(input: Partial<RecurringRuleInput> = {}) {
  const result = createRecurringRule({ ...VALID_INPUT, ...input });

  if (!result.ok) {
    throw new Error(
      `Expected a valid rule, got ${JSON.stringify(result.errors)}`,
    );
  }

  return result.value;
}

function rejected(input: Partial<RecurringRuleInput>) {
  const result = createRecurringRule({ ...VALID_INPUT, ...input });

  if (result.ok) {
    throw new Error("Expected the rule to be rejected");
  }

  return result.errors;
}

describe("createRecurringRule", () => {
  it("keeps the template the generated movements copy", () => {
    const rule = created();

    expect(rule.template).toEqual({
      type: "expense",
      amountMinor: 1299,
      categoryId: EXPENSE_CATEGORY.id,
      concept: "Suscripción mensual",
      note: null,
      tagIds: ["tag-casa", "tag-ocio"],
    });
    expect(rule.monthlyDay).toBe(MAX_MONTHLY_DAY);
    expect(rule.nextDueDate).toBe("2026-09-30");
    expect(rule.templateVersion).toBe(INITIAL_TEMPLATE_VERSION);
    expect(isActiveRecurringRule(rule)).toBe(true);
  });

  it("copies the tag set instead of aliasing the caller list", () => {
    const tagIds = ["tag-casa"];
    const rule = created({ tagIds });

    tagIds.push("tag-added-later");

    expect(rule.template.tagIds).toEqual(["tag-casa"]);
  });

  it("keeps generating after its origin movement is deleted", () => {
    const rule = created({ sourceTransactionId: null });

    expect(rule.sourceTransactionId).toBeNull();
    expect(isActiveRecurringRule(rule)).toBe(true);
  });

  it("accepts a rule that was already deactivated", () => {
    const rule = created({ deactivatedAt: NOW });

    expect(rule.deactivatedAt).toBe(NOW);
    expect(isActiveRecurringRule(rule)).toBe(false);
  });

  it("trims the optional template text and drops empty values", () => {
    const rule = created({ concept: "  Alquiler piso  ", note: "  \n" });

    expect(rule.template.concept).toBe("Alquiler piso");
    expect(rule.template.note).toBeNull();
  });

  it("accepts the extremes of the accepted amount", () => {
    expect(
      created({ amountMinor: MIN_TRANSACTION_MINOR }).template.amountMinor,
    ).toBe(MIN_TRANSACTION_MINOR);
    expect(
      created({ amountMinor: MAX_TRANSACTION_MINOR }).template.amountMinor,
    ).toBe(MAX_TRANSACTION_MINOR);
  });

  it("rejects an identifier that is not an accepted identifier", () => {
    expect(rejected({ id: "not a valid id" })).toContainEqual({
      field: "id",
      code: "invalidIdentifier",
    });
    expect(rejected({ sourceTransactionId: "not a valid id" })).toContainEqual({
      field: "sourceTransactionId",
      code: "invalidIdentifier",
    });
  });

  it("rejects an unsupported type", () => {
    expect(rejected({ type: "transfer" })).toContainEqual({
      field: "type",
      code: "invalidTransactionType",
    });
  });

  it("rejects a category whose type does not match the template", () => {
    expect(rejected({ category: INCOME_CATEGORY })).toContainEqual({
      field: "categoryId",
      code: "incompatibleCategoryType",
    });
  });

  it("rejects an amount outside the accepted range", () => {
    expect(rejected({ amountMinor: 0 })).toContainEqual({
      field: "amountMinor",
      code: "invalidAmount",
    });
    expect(rejected({ amountMinor: MAX_TRANSACTION_MINOR + 1 })).toContainEqual(
      { field: "amountMinor", code: "invalidAmount" },
    );
    expect(rejected({ amountMinor: 12.5 })).toContainEqual({
      field: "amountMinor",
      code: "invalidAmount",
    });
  });

  it("rejects template text that is too long or has control characters", () => {
    expect(rejected({ concept: "a".repeat(MAX_CONCEPT_LENGTH + 1) })).toEqual([
      { field: "concept", code: "tooLong" },
    ]);
    expect(rejected({ note: "a".repeat(MAX_NOTE_LENGTH + 1) })).toEqual([
      { field: "note", code: "tooLong" },
    ]);
    expect(rejected({ concept: "Alquiler\u0007piso" })).toEqual([
      { field: "concept", code: "invalidCharacter" },
    ]);
  });

  it("rejects an unusable tag set", () => {
    expect(
      rejected({
        tagIds: Array.from(
          { length: MAX_TAGS_PER_TRANSACTION + 1 },
          (_, index) => `tag-${String(index)}`,
        ),
      }),
    ).toContainEqual({ field: "tagIds", code: "tooManyTags" });
    expect(rejected({ tagIds: ["tag casa"] })).toContainEqual({
      field: "tagIds",
      code: "invalidIdentifier",
    });
    expect(rejected({ tagIds: ["tag-casa", "tag-casa"] })).toContainEqual({
      field: "tagIds",
      code: "duplicateTag",
    });
  });

  it("rejects a monthly day the calendar does not accept", () => {
    expect(rejected({ monthlyDay: 0 })).toContainEqual({
      field: "monthlyDay",
      code: "invalidMonthlyDay",
    });
    expect(rejected({ monthlyDay: MAX_MONTHLY_DAY + 1 })).toContainEqual({
      field: "monthlyDay",
      code: "invalidMonthlyDay",
    });
  });

  it("rejects a next due date that is not a real calendar day", () => {
    expect(rejected({ nextDueDate: "2026-02-30" })).toContainEqual({
      field: "nextDueDate",
      code: "invalidDate",
    });
  });

  it("rejects a template version before the first stored one", () => {
    expect(
      rejected({ templateVersion: INITIAL_TEMPLATE_VERSION - 1 }),
    ).toContainEqual({
      field: "templateVersion",
      code: "invalidTemplateVersion",
    });
    expect(rejected({ templateVersion: 1.5 })).toContainEqual({
      field: "templateVersion",
      code: "invalidTemplateVersion",
    });
  });

  it("rejects technical marks that are not exact Unix milliseconds", () => {
    expect(rejected({ deactivatedAt: -1 })).toContainEqual({
      field: "deactivatedAt",
      code: "invalidTimestamp",
    });
    expect(rejected({ createdAt: 1.5 })).toContainEqual({
      field: "createdAt",
      code: "invalidTimestamp",
    });
    expect(rejected({ updatedAt: Number.NaN })).toContainEqual({
      field: "updatedAt",
      code: "invalidTimestamp",
    });
  });

  it("reports every rejected field at once", () => {
    expect(
      rejected({
        id: "not a valid id",
        monthlyDay: 40,
        nextDueDate: "ayer",
      }).map((error) => error.field),
    ).toEqual(["id", "monthlyDay", "nextDueDate"]);
  });
});

describe("deactivateRecurringRule", () => {
  it("stops an active rule and stamps when it happened", () => {
    const stopped = deactivateRecurringRule(created(), NOW + 1000);

    expect(stopped).toEqual({
      ok: true,
      value: {
        ...created(),
        deactivatedAt: NOW + 1000,
        updatedAt: NOW + 1000,
      },
    });
    expect(stopped.ok && isActiveRecurringRule(stopped.value)).toBe(false);
  });

  it("keeps the template and the origin link of the stopped rule", () => {
    const stopped = deactivateRecurringRule(created(), NOW + 1000);

    expect(stopped.ok && stopped.value.template).toEqual(created().template);
    expect(stopped.ok && stopped.value.sourceTransactionId).toBe(
      VALID_INPUT.sourceTransactionId,
    );
  });

  it("refuses to stamp a rule that is already deactivated", () => {
    expect(
      deactivateRecurringRule(created({ deactivatedAt: NOW }), NOW + 1000),
    ).toEqual({
      ok: false,
      errors: [{ field: "deactivatedAt", code: "alreadyDeactivated" }],
    });
  });

  it("rejects a mark that is not an exact Unix millisecond", () => {
    expect(deactivateRecurringRule(created(), -1)).toEqual({
      ok: false,
      errors: [{ field: "deactivatedAt", code: "invalidTimestamp" }],
    });
  });
});
