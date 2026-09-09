/**
 * Public recurrence representations of the HTTP API.
 *
 * A rule exposes its future template but never workspace or storage details.
 */

import type { RecurringRule } from "../domain/recurring-rule";
import type { TransactionType } from "../../transactions/domain/transaction-type";

/** Active monthly template as returned to the browser. */
export interface RecurringRuleDto {
  readonly id: string;
  readonly sourceTransactionId: string | null;
  readonly type: TransactionType;
  readonly amountMinor: number;
  readonly categoryId: string;
  readonly concept: string | null;
  readonly note: string | null;
  readonly tagIds: readonly string[];
  readonly monthlyDay: number;
  readonly nextDueDate: string;
  readonly templateVersion: number;
}

/** Active rules grouped for the Recurrentes tab. */
export interface RecurringRulesListDto {
  readonly expenses: readonly RecurringRuleDto[];
  readonly incomes: readonly RecurringRuleDto[];
}

/** Maps a domain rule to the documented HTTP representation. */
export function toRecurringRuleDto(rule: RecurringRule): RecurringRuleDto {
  return {
    id: rule.id,
    sourceTransactionId: rule.sourceTransactionId,
    type: rule.template.type,
    amountMinor: rule.template.amountMinor,
    categoryId: rule.template.categoryId,
    concept: rule.template.concept,
    note: rule.template.note,
    tagIds: [...rule.template.tagIds],
    monthlyDay: rule.monthlyDay,
    nextDueDate: rule.nextDueDate,
    templateVersion: rule.templateVersion,
  };
}
