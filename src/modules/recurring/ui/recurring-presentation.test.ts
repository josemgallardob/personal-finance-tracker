import { describe, expect, it } from "vitest";

import type { CategoryDto } from "../../classification/contracts/category";
import type { TagDto } from "../../classification/contracts/tag";
import type { RecurringRuleDto } from "../contracts/recurring";
import { recurringCopy } from "./recurring-copy";
import {
  catchUpAnnouncement,
  generatedAnnouncement,
  recurringCategoryLabel,
  recurringNextDueLabel,
  recurringPrimaryLabel,
  recurringSignedAmount,
  recurringTagNames,
} from "./recurring-presentation";

const categories: readonly CategoryDto[] = [
  { id: "cat-rent", name: "Alquiler", type: "expense", isArchived: false },
  { id: "cat-salary", name: "Sueldo", type: "income", isArchived: false },
];

const tags: readonly TagDto[] = [
  { id: "tag-home", name: "Hogar", isArchived: false },
  { id: "tag-fixed", name: "Fijos", isArchived: true },
];

function rule(overrides: Partial<RecurringRuleDto> = {}): RecurringRuleDto {
  return {
    id: "rule-1",
    sourceTransactionId: "tx-1",
    type: "expense",
    amountMinor: 125_050,
    categoryId: "cat-rent",
    concept: "Alquiler",
    note: null,
    tagIds: ["tag-home"],
    monthlyDay: 5,
    nextDueDate: "2026-10-05",
    templateVersion: 1,
    ...overrides,
  };
}

describe("recurring presentation", () => {
  it("titles a template by concept and falls back to category then to the generic label", () => {
    expect(recurringPrimaryLabel(rule(), categories)).toBe("Alquiler");
    expect(recurringPrimaryLabel(rule({ concept: "   " }), categories)).toBe(
      "Alquiler",
    );
    expect(
      recurringPrimaryLabel(
        rule({ concept: null, categoryId: "cat-removed" }),
        categories,
      ),
    ).toBe(recurringCopy.fallbackLabel);
    expect(
      recurringCategoryLabel(rule({ categoryId: "cat-removed" }), categories),
    ).toBe(recurringCopy.fallbackLabel);
  });

  it("signs the amount and writes the next date in Spanish", () => {
    // Spanish currency copy separates the symbol with a non-breaking space.
    const plain = (text: string) => text.replaceAll("\u00a0", " ");
    expect(plain(recurringSignedAmount(rule()))).toBe("\u22121250,50 €");
    expect(plain(recurringSignedAmount(rule({ type: "income" })))).toBe(
      "+1250,50 €",
    );
    expect(
      plain(recurringSignedAmount(rule({ amountMinor: 12_345_678 }))),
    ).toBe("\u2212123.456,78 €");
    expect(recurringNextDueLabel(rule())).toBe("Próxima: 05/10/2026");
  });

  it("names only the tags the catalog still knows", () => {
    expect(
      recurringTagNames(rule({ tagIds: ["tag-home", "tag-gone"] }), tags),
    ).toEqual(["Hogar"]);
    expect(recurringTagNames(rule({ tagIds: [] }), tags)).toEqual([]);
  });

  it("states how many overdue entries a change would create and on which dates", () => {
    expect(catchUpAnnouncement([])).toBeNull();
    expect(catchUpAnnouncement(["2026-08-05"])).toBe(
      `${recurringCopy.catchUpOne} 05/08/2026.`,
    );
    expect(catchUpAnnouncement(["2026-08-05", "2026-09-05"])).toBe(
      `${recurringCopy.catchUpMany(2)} 05/08/2026, 05/09/2026.`,
    );
  });

  it("reports what an applied change actually created", () => {
    expect(generatedAnnouncement([])).toBe(recurringCopy.createdNone);
    expect(generatedAnnouncement(["2026-08-05"])).toBe(
      recurringCopy.createdOne,
    );
    expect(generatedAnnouncement(["2026-08-05", "2026-09-05"])).toBe(
      recurringCopy.createdMany(2),
    );
  });
});
