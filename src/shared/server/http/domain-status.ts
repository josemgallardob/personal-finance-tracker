/**
 * Deterministic translation of business and storage refusals into HTTP.
 *
 * The domain reports refusals as field errors and never knows about HTTP. This
 * module owns the whole mapping, expressed as total records rather than
 * conditionals, so adding a domain code fails type checking instead of quietly
 * falling into a default status. The status of a refusal therefore depends only
 * on the codes it carries, never on which endpoint produced it.
 */

import "server-only";

import type { ApiErrorCode, ApiFieldErrorDto } from "../../contracts/api";
import { API_ERROR_STATUS } from "../../contracts/api";
import type { DomainError, DomainErrorCode } from "../../domain/errors";
import type { DatabaseErrorCode } from "../database";
import { apiFailure, type ApiFailure } from "./failure";

/**
 * Error class each domain refusal belongs to.
 *
 * A refusal about the submitted values is unprocessable content; one about a
 * row that does not exist is a missing resource; one about the stored state
 * blocking the operation is a conflict; and one about storage being unusable
 * is a temporary service failure, not a client mistake.
 */
export const DOMAIN_ERROR_API_CODE: Readonly<
  Record<DomainErrorCode, ApiErrorCode>
> = Object.freeze({
  required: "validationFailed",
  tooLong: "validationFailed",
  invalidCharacter: "validationFailed",
  invalidIdentifier: "validationFailed",
  invalidTransactionType: "validationFailed",
  invalidSortOrder: "validationFailed",
  invalidTimestamp: "validationFailed",
  invalidMonthlyDay: "validationFailed",
  invalidTemplateVersion: "validationFailed",
  invalidDate: "validationFailed",
  futureDate: "validationFailed",
  invalidAmount: "validationFailed",
  duplicateTag: "validationFailed",
  tooManyTags: "validationFailed",
  incompatibleCategoryType: "validationFailed",
  invalidCursor: "validationFailed",
  invalidLimit: "validationFailed",
  incompatibleFilters: "validationFailed",
  notFound: "notFound",
  duplicateName: "conflict",
  alreadyArchived: "conflict",
  alreadyDeactivated: "conflict",
  activeRuleExists: "conflict",
  archived: "conflict",
  unavailable: "serviceUnavailable",
});

/**
 * Severity order used when a refusal carries several codes.
 *
 * A single response has one status, so the least recoverable class wins: a
 * request that is both malformed and hit unusable storage is reported as a
 * service failure, because retrying the corrected payload would fail too.
 */
const API_CODE_PRIORITY: readonly ApiErrorCode[] = Object.freeze([
  "serviceUnavailable",
  "notFound",
  "conflict",
  "validationFailed",
]);

function dominantCode(codes: readonly ApiErrorCode[]): ApiErrorCode {
  for (const candidate of API_CODE_PRIORITY) {
    if (codes.includes(candidate)) {
      return candidate;
    }
  }

  return "validationFailed";
}

/** Field errors of a domain refusal, with their codes preserved. */
export function toDomainFieldErrors(
  errors: readonly DomainError[],
): readonly ApiFieldErrorDto[] {
  return errors.map((error) => ({ field: error.field, code: error.code }));
}

/**
 * Maps a domain refusal to the response it always produces.
 *
 * Storage failures answer without details: `storage: unavailable` describes
 * the server, not the request, and repeating it would invite a client to show
 * it as a field message.
 */
export function toApiFailure(errors: readonly DomainError[]): ApiFailure {
  const code = dominantCode(
    errors.map((error) => DOMAIN_ERROR_API_CODE[error.code]),
  );

  if (code === "serviceUnavailable") {
    return apiFailure(code);
  }

  return apiFailure(code, toDomainFieldErrors(errors));
}

/**
 * Maps a connection failure to a response.
 *
 * Every reason is a server-side condition: a missing or invalid configuration,
 * an unusable path, a file that will not open, or a build-time access attempt.
 * None of them is caused by the request, so all answer `503` and none of them
 * reveals the path or the underlying driver message.
 */
export const DATABASE_ERROR_API_CODE: Readonly<
  Record<DatabaseErrorCode, ApiErrorCode>
> = Object.freeze({
  invalidConfig: "serviceUnavailable",
  invalidPath: "serviceUnavailable",
  openFailed: "serviceUnavailable",
  buildTimeAccess: "serviceUnavailable",
});

/** Status a refusal maps to, exposed for assertions and documentation. */
export function statusOf(code: ApiErrorCode): number {
  return API_ERROR_STATUS[code];
}
