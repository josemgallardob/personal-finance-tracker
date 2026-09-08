/**
 * Record that a rule already processed one due date.
 *
 * An occurrence is deliberately minimal: the rule, the scheduled day and a
 * nullable link to the movement that was created. It stores no amount, concept,
 * note or tag, so deleting a generated movement can clear the link and still
 * leave the proof that the date was processed. That proof is what makes the
 * generator idempotent and what keeps a deleted entry from coming back.
 */

import type { TransactionId } from "../../transactions/domain/transaction";
import { type LocalDate, parseLocalDate } from "../../../shared/domain/dates";
import {
  type DomainError,
  type DomainResult,
  domainError,
  invalid,
  valid,
} from "../../../shared/domain/errors";
import { isIdentifier } from "../../../shared/domain/text";
import { type Timestamp, isTimestamp } from "../../../shared/domain/timestamp";
import type { RecurringRuleId } from "./recurring-rule";

declare const recurringOccurrenceIdBrand: unique symbol;

/** Identifier of an occurrence. */
export type RecurringOccurrenceId = string & {
  readonly [recurringOccurrenceIdBrand]: true;
};

/** Proof that one due date of one rule was processed. */
export interface RecurringOccurrence {
  readonly id: RecurringOccurrenceId;
  readonly recurringRuleId: RecurringRuleId;
  readonly scheduledFor: LocalDate;
  /** Generated movement, or `null` once the user deletes it. */
  readonly transactionId: TransactionId | null;
  readonly createdAt: Timestamp;
}

/** Raw values an occurrence is built from. */
export interface RecurringOccurrenceInput {
  readonly id: string;
  readonly recurringRuleId: string;
  readonly scheduledFor: string;
  readonly transactionId: string | null;
  readonly createdAt: number;
}

/** Builds an occurrence, collecting every rejected field. */
export function createRecurringOccurrence(
  input: RecurringOccurrenceInput,
): DomainResult<RecurringOccurrence> {
  const errors: DomainError[] = [];

  if (!isIdentifier(input.id)) {
    errors.push(domainError("id", "invalidIdentifier"));
  }

  if (!isIdentifier(input.recurringRuleId)) {
    errors.push(domainError("recurringRuleId", "invalidIdentifier"));
  }

  if (!parseLocalDate(input.scheduledFor).ok) {
    errors.push(domainError("scheduledFor", "invalidDate"));
  }

  if (input.transactionId !== null && !isIdentifier(input.transactionId)) {
    errors.push(domainError("transactionId", "invalidIdentifier"));
  }

  if (!isTimestamp(input.createdAt)) {
    errors.push(domainError("createdAt", "invalidTimestamp"));
  }

  if (errors.length > 0) {
    return invalid(errors);
  }

  return valid({
    id: input.id as RecurringOccurrenceId,
    recurringRuleId: input.recurringRuleId as RecurringRuleId,
    scheduledFor: input.scheduledFor as LocalDate,
    transactionId: input.transactionId as TransactionId | null,
    createdAt: input.createdAt as Timestamp,
  });
}

/**
 * Clears the link to a deleted movement, keeping the processed date. The
 * occurrence of a movement that was already deleted is returned unchanged, so
 * repeating the deletion is harmless.
 */
export function unlinkGeneratedTransaction(
  occurrence: RecurringOccurrence,
): RecurringOccurrence {
  if (occurrence.transactionId === null) {
    return occurrence;
  }

  return { ...occurrence, transactionId: null };
}
