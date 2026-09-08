/**
 * Stable encoding of API query strings.
 *
 * The history and classification collections carry filters in the URL. The
 * encoder is the only place that decides how those filters become a query
 * string, so a search that contains `&`, an accented concept, several tag
 * identifiers, an open date range or an opaque cursor cannot be serialised
 * two different ways by two adapters.
 *
 * `undefined` is omitted: that is how an open range and an unfiltered list
 * stay free of empty parameters. A repeated key keeps every value, in the
 * order the caller supplied, because the server groups repeats into an array
 * and a comma-joined value would be a different filter. Encoding uses
 * `encodeURIComponent`, so a space stays `%20` and an ampersand stays `%26`.
 */

import { API_BASE_PATH } from "../contracts/http";

/** One query value: a scalar, or several values of the same key. */
export type ApiQueryValue =
  string | number | boolean | readonly (string | number)[];

/** Query object an adapter encodes. Absent keys are not sent. */
export type ApiQueryParams = Readonly<
  Record<string, ApiQueryValue | undefined>
>;

const API_PATH_PREFIX = `${API_BASE_PATH}/`;

function isRepeatedQueryValue(
  value: ApiQueryValue,
): value is readonly (string | number)[] {
  return Array.isArray(value);
}

function encodeComponent(value: string): string {
  return encodeURIComponent(value);
}

function appendPair(
  parts: string[],
  key: string,
  value: string | number | boolean,
) {
  parts.push(`${encodeComponent(key)}=${encodeComponent(String(value))}`);
}

/**
 * Encodes a query object into a `?…` suffix, or an empty string when nothing
 * should be sent.
 */
export function encodeApiQuery(params: ApiQueryParams): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }

    if (isRepeatedQueryValue(value)) {
      for (const item of value) {
        appendPair(parts, key, item);
      }

      continue;
    }

    appendPair(parts, key, value);
  }

  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

/**
 * Encodes one path segment of an origin-relative API URL.
 *
 * Identifiers are already constrained on the server, but the client still
 * encodes them so a reserved character cannot split the path.
 */
export function encodeApiPathSegment(segment: string): string {
  return encodeURIComponent(segment);
}

/**
 * Builds an origin-relative API path under `/api/`, with an optional query.
 */
export function apiPath(resource: string, query?: ApiQueryParams): string {
  const path = resource.startsWith("/") ? resource : `/${resource}`;

  if (!path.startsWith(API_PATH_PREFIX) && path !== API_BASE_PATH) {
    throw new Error(
      `API paths must be same-origin and start with "${API_PATH_PREFIX}".`,
    );
  }

  return `${path}${query === undefined ? "" : encodeApiQuery(query)}`;
}
