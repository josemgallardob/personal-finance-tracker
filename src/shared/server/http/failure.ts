/**
 * Internal representation of a refused request.
 *
 * Handlers move this value around instead of throwing, mirroring how the
 * domain reports refusals. It becomes an {@link ApiErrorDto} only at the edge,
 * when the response is written, so no intermediate layer has to know about
 * status codes or Spanish copy.
 */

import "server-only";

import type {
  ApiErrorCode,
  ApiErrorStatus,
  ApiFieldErrorDto,
} from "../../contracts/api";
import { API_ERROR_STATUS } from "../../contracts/api";

/** Refusal a handler produced, before it is serialised. */
export interface ApiFailure {
  readonly code: ApiErrorCode;
  readonly status: ApiErrorStatus;
  readonly details?: readonly ApiFieldErrorDto[];
}

/** Builds a refusal with the status its code always maps to. */
export function apiFailure(
  code: ApiErrorCode,
  details?: readonly ApiFieldErrorDto[],
): ApiFailure {
  if (details === undefined || details.length === 0) {
    return { code, status: API_ERROR_STATUS[code] };
  }

  return { code, status: API_ERROR_STATUS[code], details };
}

/** Outcome of a handler step: a value to serialise, or a refusal. */
export type ApiResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly failure: ApiFailure };

/** Accepted outcome. */
export function accepted<TValue>(value: TValue): ApiResult<TValue> {
  return { ok: true, value };
}

/** Refused outcome. */
export function refused<TValue>(failure: ApiFailure): ApiResult<TValue> {
  return { ok: false, failure };
}
