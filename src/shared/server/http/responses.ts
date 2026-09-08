/**
 * Response writing for the API.
 *
 * Every response leaves through this module so the envelope, the correlation
 * header and the caching policy cannot drift between endpoints. Financial data
 * is private and always freshly derived from SQLite, so no API response may be
 * stored by a browser, a proxy or the Next.js data cache: `no-store` is applied
 * to reads, mutations and refusals alike.
 */

import "server-only";

import type {
  ApiDataEnvelope,
  ApiErrorDto,
  ApiErrorEnvelope,
} from "../../contracts/api";
import { API_ERROR_MESSAGE } from "../../contracts/api";
import { REQUEST_ID_HEADER } from "./request-id";
import type { ApiFailure } from "./failure";

/** Caching directive applied to every API response. */
export const API_CACHE_CONTROL = "no-store";

/** Content type of every API response that carries a body. */
export const API_CONTENT_TYPE = "application/json; charset=utf-8";

function apiHeaders(requestId: string): Headers {
  return new Headers({
    "cache-control": API_CACHE_CONTROL,
    "x-content-type-options": "nosniff",
    [REQUEST_ID_HEADER]: requestId,
  });
}

/** Writes the data envelope with the given success status. */
export function dataResponse<TData>(
  status: number,
  data: TData,
  requestId: string,
): Response {
  const envelope: ApiDataEnvelope<TData> = { data, requestId };
  const headers = apiHeaders(requestId);
  headers.set("content-type", API_CONTENT_TYPE);

  return new Response(JSON.stringify(envelope), { status, headers });
}

/**
 * Writes an accepted mutation that has nothing to represent.
 *
 * A `204` carries no body, so the correlation identifier travels only in the
 * response header.
 */
export function noContentResponse(requestId: string): Response {
  return new Response(null, { status: 204, headers: apiHeaders(requestId) });
}

/** Builds the sanitized error representation of a refusal. */
export function toApiErrorDto(
  failure: ApiFailure,
  requestId: string,
): ApiErrorDto {
  const base = {
    code: failure.code,
    message: API_ERROR_MESSAGE[failure.code],
    requestId,
  };

  if (failure.details === undefined || failure.details.length === 0) {
    return base;
  }

  return { ...base, details: failure.details };
}

/** Writes the error envelope with the status the refusal maps to. */
export function errorResponse(
  failure: ApiFailure,
  requestId: string,
): Response {
  const envelope: ApiErrorEnvelope = {
    error: toApiErrorDto(failure, requestId),
  };
  const headers = apiHeaders(requestId);
  headers.set("content-type", API_CONTENT_TYPE);

  return new Response(JSON.stringify(envelope), {
    status: failure.status,
    headers,
  });
}
