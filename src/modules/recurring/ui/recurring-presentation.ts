/**
 * Presentation of one recurrence template from its public DTO.
 *
 * A template has no date of its own: what identifies it for the owner is the
 * monthly ordinal and the next due date the server calculated. Amount keeps a
 * visible sign and a written type word, so meaning never depends on colour.
 */

import type { CategoryDto } from "../../classification/contracts/category";
import type { TagDto } from "../../classification/contracts/tag";
import {
  formatMoneyMinorAsEur,
  type MoneyMinor,
} from "../../../shared/domain/money";
import { formatLocalDateAsSpanish } from "../../transactions/ui/transaction-form-schema";
import type { RecurringRuleDto } from "../contracts/recurring";
import { recurringCopy } from "./recurring-copy";

/** Category name of a template, or the generic fallback when it is unknown. */
export function recurringCategoryLabel(
  rule: RecurringRuleDto,
  categories: readonly CategoryDto[],
): string {
  return (
    categories.find((category) => category.id === rule.categoryId)?.name ??
    recurringCopy.fallbackLabel
  );
}

/** Visible title of a template: concept, otherwise category, otherwise fallback. */
export function recurringPrimaryLabel(
  rule: RecurringRuleDto,
  categories: readonly CategoryDto[],
): string {
  const concept = rule.concept?.trim();
  return concept ? concept : recurringCategoryLabel(rule, categories);
}

/** Signed EUR amount with a visible `+` or `−`, independent of colour. */
export function recurringSignedAmount(rule: RecurringRuleDto): string {
  const amount = formatMoneyMinorAsEur(rule.amountMinor as MoneyMinor);
  return rule.type === "expense" ? `−${amount}` : `+${amount}`;
}

/** Tag names of a template, skipping identifiers the catalog does not name. */
export function recurringTagNames(
  rule: RecurringRuleDto,
  tags: readonly TagDto[],
): readonly string[] {
  const namesById = new Map(tags.map((tag) => [tag.id, tag.name]));
  return rule.tagIds.flatMap((tagId) => {
    const name = namesById.get(tagId);
    return name === undefined ? [] : [name];
  });
}

/** Spanish civil date of the next generation of a template. */
export function recurringNextDueLabel(rule: RecurringRuleDto): string {
  return recurringCopy.nextDueLabel(formatLocalDateAsSpanish(rule.nextDueDate));
}

/**
 * Announcement of the overdue dates a change would create.
 *
 * The count and the dates are both stated: the plan requires the confirmation
 * to say how many entries appear and with which dates, not only that some do.
 */
export function catchUpAnnouncement(
  pendingDueDates: readonly string[],
): string | null {
  if (pendingDueDates.length === 0) {
    return null;
  }

  const heading =
    pendingDueDates.length === 1
      ? recurringCopy.catchUpOne
      : recurringCopy.catchUpMany(pendingDueDates.length);

  return `${heading} ${pendingDueDates.map(formatLocalDateAsSpanish).join(", ")}.`;
}

/** Announcement of the overdue dates a change has just created. */
export function generatedAnnouncement(
  generatedDueDates: readonly string[],
): string {
  if (generatedDueDates.length === 0) {
    return recurringCopy.createdNone;
  }

  return generatedDueDates.length === 1
    ? recurringCopy.createdOne
    : recurringCopy.createdMany(generatedDueDates.length);
}
