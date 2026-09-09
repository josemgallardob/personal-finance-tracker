/**
 * Guidance shown when the server refuses a recurrence change.
 *
 * A refused template change is rarely something the owner can fix by pressing
 * the button again. An archived or incompatible category, a template that
 * another window already changed and a rule that is already deactivated each
 * need a different next step, and the field errors of the `422`/`409` envelope
 * are the only place that distinction exists. Anything the contract does not
 * describe falls back to the caller's message rather than inventing advice.
 */

import type { ApiClientFailure } from "../../../shared/client/api-client";
import { recurringConflictCopy } from "./recurring-copy";

interface FieldError {
  readonly field: string;
  readonly code: string;
}

function guidanceFor(error: FieldError): string | null {
  if (error.code === "archived" && error.field === "categoryId") {
    return recurringConflictCopy.categoryArchived;
  }

  if (error.code === "archived" || error.field === "tagId") {
    return recurringConflictCopy.tagUnavailable;
  }

  if (error.code === "incompatibleCategoryType") {
    return recurringConflictCopy.categoryIncompatible;
  }

  if (error.code === "notFound" && error.field === "categoryId") {
    return recurringConflictCopy.categoryNotFound;
  }

  if (error.code === "invalidTemplateVersion") {
    return recurringConflictCopy.staleTemplate;
  }

  if (error.code === "alreadyDeactivated") {
    return recurringConflictCopy.alreadyDeactivated;
  }

  return null;
}

/**
 * Message a recurrence dialog shows for a failed call.
 *
 * Field errors are read in order, so the first refusal the owner can act on
 * wins over a later one that only repeats the same rejection.
 */
export function recurringFailureMessage(
  failure: ApiClientFailure,
  fallback: string,
): string {
  if (failure.reason !== "api") {
    return fallback;
  }

  if (failure.error.code === "serviceUnavailable") {
    return recurringConflictCopy.unavailable;
  }

  for (const detail of failure.error.details ?? []) {
    const guidance = guidanceFor(detail);
    if (guidance !== null) {
      return guidance;
    }
  }

  return failure.error.message;
}
