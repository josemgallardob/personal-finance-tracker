/**
 * Public transaction representation of the HTTP API.
 *
 * The DTO is the only shape a client may see: minor-unit money, an ISO civil
 * date, the assigned category and the tag identifiers of the movement. It never
 * carries a workspace identifier, technical timestamps, a storage row or a
 * recurrence link. Duplication is GET of this representation followed by POST
 * of a new body, not a dedicated endpoint.
 */

import type { Transaction } from "../domain/transaction";
import type { TransactionType } from "../domain/transaction-type";

/** Transaction as the API returns it. */
export interface TransactionDto {
  readonly id: string;
  readonly type: TransactionType;
  readonly amountMinor: number;
  readonly date: string;
  readonly categoryId: string;
  readonly concept: string | null;
  readonly note: string | null;
  readonly tagIds: readonly string[];
  /** Rule that generated this movement, when it was not entered manually. */
  readonly recurringRuleId?: string | null;
  /** Scheduled civil day of a generated movement. */
  readonly scheduledFor?: string | null;
  /** Present only when this POST atomically created its monthly rule. */
  readonly recurrence?: {
    readonly ruleId: string;
    readonly nextDueDate: string;
  };
}

/**
 * One page of the history.
 *
 * `nextCursor` is an opaque continuation token bound to the filters that
 * produced the page. A client must repeat those filters unchanged; it must
 * never inspect or forge the token.
 */
export interface TransactionCursorPageDto {
  readonly items: readonly TransactionDto[];
  readonly nextCursor: string | null;
}

/** Maps a domain movement to the documented HTTP representation. */
export function toTransactionDto(
  transaction: Transaction,
  recurrence?: TransactionDto["recurrence"],
): TransactionDto {
  return {
    id: transaction.id,
    type: transaction.type,
    amountMinor: transaction.amountMinor,
    date: transaction.date,
    categoryId: transaction.categoryId,
    concept: transaction.concept,
    note: transaction.note,
    tagIds: [...transaction.tagIds],
    ...(recurrence === undefined ? {} : { recurrence }),
  };
}

/** Maps a domain history page to the documented cursor page. */
export function toTransactionCursorPageDto(
  items: readonly Transaction[],
  nextCursor: string | null,
): TransactionCursorPageDto {
  return {
    items: items.map((item) => toTransactionDto(item)),
    nextCursor,
  };
}
