/**
 * Monthly recurrence rule and its template.
 *
 * A rule owns the template that every generated movement copies: type, exact
 * minor units, category, optional text and its set of tags. The template lives
 * in the rule and not in the transaction it was created from, so deleting that
 * origin movement clears the link without stopping the rule.
 *
 * A rule is active until it is deactivated, and deactivation is irreversible in
 * the MVP: no contract here returns a deactivated rule to the active state. The
 * template version increases with every accepted edit, which is what lets a
 * writer detect that the interface was looking at an older template.
 */

import {
  type CategoryId,
  type Category,
} from "../../classification/domain/category";
import type { TagId } from "../../classification/domain/tag";
import type { TransactionId } from "../../transactions/domain/transaction";
import {
  MAX_CONCEPT_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_TAGS_PER_TRANSACTION,
} from "../../transactions/domain/transaction";
import {
  type TransactionType,
  isTransactionType,
} from "../../transactions/domain/transaction-type";
import { type LocalDate, parseLocalDate } from "../../../shared/domain/dates";
import {
  type DomainError,
  type DomainResult,
  domainError,
  invalid,
  valid,
} from "../../../shared/domain/errors";
import {
  MAX_TRANSACTION_MINOR,
  MIN_TRANSACTION_MINOR,
  type MoneyMinor,
} from "../../../shared/domain/money";
import {
  characterLength,
  containsControlCharacters,
  isIdentifier,
  normalizeFreeText,
} from "../../../shared/domain/text";
import { type Timestamp, isTimestamp } from "../../../shared/domain/timestamp";
import { type MonthlyDay, isMonthlyDay } from "./recurrence-calendar";

declare const recurringRuleIdBrand: unique symbol;

/** Identifier of a recurrence rule. */
export type RecurringRuleId = string & {
  readonly [recurringRuleIdBrand]: true;
};

/** First version a stored template has. */
export const INITIAL_TEMPLATE_VERSION = 1;

/** Values every generated movement copies from its rule. */
export interface RecurringRuleTemplate {
  readonly type: TransactionType;
  readonly amountMinor: MoneyMinor;
  readonly categoryId: CategoryId;
  readonly concept: string | null;
  readonly note: string | null;
  /** Set of tags, without repetitions. */
  readonly tagIds: readonly TagId[];
}

/** Recurrence rule as the domain knows it. */
export interface RecurringRule {
  readonly id: RecurringRuleId;
  /** Movement the rule was created from, or `null` once it is deleted. */
  readonly sourceTransactionId: TransactionId | null;
  readonly template: RecurringRuleTemplate;
  readonly monthlyDay: MonthlyDay;
  readonly nextDueDate: LocalDate;
  readonly templateVersion: number;
  readonly deactivatedAt: Timestamp | null;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/** Raw values a rule is built from. */
export interface RecurringRuleInput {
  readonly id: string;
  readonly sourceTransactionId: string | null;
  readonly type: string;
  readonly amountMinor: number;
  readonly category: Category;
  readonly concept: string | null;
  readonly note: string | null;
  readonly tagIds: readonly string[];
  readonly monthlyDay: number;
  readonly nextDueDate: string;
  readonly templateVersion: number;
  readonly deactivatedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface OptionalTextRules {
  readonly field: string;
  readonly maxLength: number;
  readonly allowLineBreaks: boolean;
}

/**
 * Validates optional template text with the rules of a movement: empty text
 * becomes `null`, accents survive and only the note accepts line breaks.
 */
function normalizeOptionalText(
  raw: string | null,
  rules: OptionalTextRules,
  errors: DomainError[],
): string | null {
  if (raw === null) {
    return null;
  }

  const text = normalizeFreeText(raw, rules.allowLineBreaks);

  if (text === "") {
    return null;
  }

  if (characterLength(text) > rules.maxLength) {
    errors.push(domainError(rules.field, "tooLong"));
    return null;
  }

  if (containsControlCharacters(text, rules.allowLineBreaks)) {
    errors.push(domainError(rules.field, "invalidCharacter"));
    return null;
  }

  return text;
}

function validateTagIds(
  tagIds: readonly string[],
  errors: DomainError[],
): void {
  if (tagIds.length > MAX_TAGS_PER_TRANSACTION) {
    errors.push(domainError("tagIds", "tooManyTags"));
  }

  if (tagIds.some((tagId) => !isIdentifier(tagId))) {
    errors.push(domainError("tagIds", "invalidIdentifier"));
  }

  if (new Set(tagIds).size !== tagIds.length) {
    errors.push(domainError("tagIds", "duplicateTag"));
  }
}

/** Builds a recurrence rule, collecting every rejected field. */
export function createRecurringRule(
  input: RecurringRuleInput,
): DomainResult<RecurringRule> {
  const errors: DomainError[] = [];

  if (!isIdentifier(input.id)) {
    errors.push(domainError("id", "invalidIdentifier"));
  }

  if (
    input.sourceTransactionId !== null &&
    !isIdentifier(input.sourceTransactionId)
  ) {
    errors.push(domainError("sourceTransactionId", "invalidIdentifier"));
  }

  if (!isTransactionType(input.type)) {
    errors.push(domainError("type", "invalidTransactionType"));
  } else if (input.type !== input.category.type) {
    errors.push(domainError("categoryId", "incompatibleCategoryType"));
  }

  if (
    !Number.isSafeInteger(input.amountMinor) ||
    input.amountMinor < MIN_TRANSACTION_MINOR ||
    input.amountMinor > MAX_TRANSACTION_MINOR
  ) {
    errors.push(domainError("amountMinor", "invalidAmount"));
  }

  const concept = normalizeOptionalText(
    input.concept,
    {
      field: "concept",
      maxLength: MAX_CONCEPT_LENGTH,
      allowLineBreaks: false,
    },
    errors,
  );
  const note = normalizeOptionalText(
    input.note,
    { field: "note", maxLength: MAX_NOTE_LENGTH, allowLineBreaks: true },
    errors,
  );

  validateTagIds(input.tagIds, errors);

  if (!isMonthlyDay(input.monthlyDay)) {
    errors.push(domainError("monthlyDay", "invalidMonthlyDay"));
  }

  if (!parseLocalDate(input.nextDueDate).ok) {
    errors.push(domainError("nextDueDate", "invalidDate"));
  }

  if (
    !Number.isSafeInteger(input.templateVersion) ||
    input.templateVersion < INITIAL_TEMPLATE_VERSION
  ) {
    errors.push(domainError("templateVersion", "invalidTemplateVersion"));
  }

  if (input.deactivatedAt !== null && !isTimestamp(input.deactivatedAt)) {
    errors.push(domainError("deactivatedAt", "invalidTimestamp"));
  }

  if (!isTimestamp(input.createdAt)) {
    errors.push(domainError("createdAt", "invalidTimestamp"));
  }

  if (!isTimestamp(input.updatedAt)) {
    errors.push(domainError("updatedAt", "invalidTimestamp"));
  }

  if (errors.length > 0) {
    return invalid(errors);
  }

  return valid({
    id: input.id as RecurringRuleId,
    sourceTransactionId: input.sourceTransactionId as TransactionId | null,
    template: {
      type: input.type as TransactionType,
      amountMinor: input.amountMinor as MoneyMinor,
      categoryId: input.category.id,
      concept,
      note,
      tagIds: [...input.tagIds] as TagId[],
    },
    monthlyDay: input.monthlyDay as MonthlyDay,
    nextDueDate: input.nextDueDate as LocalDate,
    templateVersion: input.templateVersion,
    deactivatedAt: input.deactivatedAt as Timestamp | null,
    createdAt: input.createdAt as Timestamp,
    updatedAt: input.updatedAt as Timestamp,
  });
}

/** Tells whether a rule still generates movements. */
export function isActiveRecurringRule(rule: RecurringRule): boolean {
  return rule.deactivatedAt === null;
}

/**
 * Stops a rule for good. Deactivation is irreversible, so a rule that is
 * already deactivated is rejected instead of being stamped again.
 */
export function deactivateRecurringRule(
  rule: RecurringRule,
  at: number,
): DomainResult<RecurringRule> {
  if (!isActiveRecurringRule(rule)) {
    return invalid([domainError("deactivatedAt", "alreadyDeactivated")]);
  }

  if (!isTimestamp(at)) {
    return invalid([domainError("deactivatedAt", "invalidTimestamp")]);
  }

  return valid({ ...rule, deactivatedAt: at, updatedAt: at });
}
