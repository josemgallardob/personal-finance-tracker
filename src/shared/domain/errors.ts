/**
 * Business errors of the domain.
 *
 * A domain contract never throws to report rejected input: it returns the list
 * of field errors so a caller can show every problem at once instead of one per
 * attempt.
 */

/** Reason why a domain contract rejected a value. */
export type DomainErrorCode =
  | "required"
  | "tooLong"
  | "invalidCharacter"
  | "invalidIdentifier"
  | "invalidTransactionType"
  | "invalidSortOrder"
  | "invalidTimestamp"
  | "invalidMonthlyDay"
  | "invalidTemplateVersion"
  | "alreadyDeactivated"
  | "activeRuleExists"
  | "usedByActiveRule"
  | "invalidDate"
  | "futureDate"
  | "invalidAmount"
  | "duplicateTag"
  | "tooManyTags"
  | "incompatibleCategoryType"
  | "duplicateName"
  | "alreadyArchived"
  | "notFound"
  | "archived"
  | "unavailable"
  | "invalidCursor"
  | "invalidLimit"
  | "incompatibleFilters";

/** Rejected field and the reason why it was rejected. */
export interface DomainError {
  readonly field: string;
  readonly code: DomainErrorCode;
}

/** Outcome of a domain contract that can reject its input. */
export type DomainResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly errors: readonly DomainError[] };

/** Builds a field error. */
export function domainError(field: string, code: DomainErrorCode): DomainError {
  return { field, code };
}

/** Accepted outcome. */
export function valid<TValue>(value: TValue): DomainResult<TValue> {
  return { ok: true, value };
}

/** Rejected outcome carrying every field error found. */
export function invalid<TValue>(
  errors: readonly DomainError[],
): DomainResult<TValue> {
  return { ok: false, errors };
}
