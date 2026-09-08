/**
 * Sanitized request logging.
 *
 * Concepts, notes, amounts, tags and search text are personal financial data,
 * so no log line may contain a request body, a query string, a header value or
 * a driver message: a SQLite error text can quote the very row that failed.
 * A log entry is therefore built from a closed set of non-sensitive fields and
 * correlated with the client through the request identifier alone.
 */

import "server-only";

import type { ApiErrorCode } from "../../contracts/api";

/** Everything the API is allowed to record about a request. */
export interface ApiLogEntry {
  readonly requestId: string;
  readonly method: string;
  /** Path of the request. The query string is deliberately not included. */
  readonly route: string;
  readonly status: number;
  readonly durationMs: number;
  readonly errorCode?: ApiErrorCode;
  /** How many fields were rejected, never which values they held. */
  readonly fieldErrorCount?: number;
  /** Constructor name of an unexpected throw, never its message. */
  readonly failureType?: string;
}

/** Sink that records one entry. */
export type ApiLogger = (entry: ApiLogEntry) => void;

/**
 * Path of a request, without the query string.
 *
 * History filters travel in the query string and include free search text, so
 * the path is the only part of the URL that may be recorded.
 */
export function logRoute(url: URL): string {
  return url.pathname;
}

/**
 * Names the class of an unexpected throw.
 *
 * Only the constructor name is kept. A message could carry a failing SQL
 * statement together with its bound parameters.
 */
export function describeFailureType(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.constructor.name;
  }

  return typeof cause;
}

/** Default sink. Writes one JSON line per request to the process log. */
export const consoleApiLogger: ApiLogger = (entry) => {
  console.info(JSON.stringify({ event: "api_request", ...entry }));
};
