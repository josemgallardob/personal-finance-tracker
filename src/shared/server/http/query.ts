/**
 * Strict query-string parsing.
 *
 * Search parameters arrive as repeated key/value pairs with no types. They are
 * normalised into a plain object first, so the same strict schema machinery
 * that guards a JSON body also guards a read: unknown parameters are refused
 * and a workspace identifier is never accepted from the URL either.
 *
 * A parameter that appears once becomes a string and one that appears several
 * times becomes an array, which is how the history expresses several tags.
 */

import "server-only";

import type { z } from "zod";

import type { ApiResult } from "./failure";
import { parseRequestPayload } from "./schema";

/** Value a single query parameter can take before validation. */
export type QueryParamValue = string | readonly string[];

/** Query string as a plain object the schema layer understands. */
export type QueryRecord = Readonly<Record<string, QueryParamValue>>;

/** Groups repeated parameters into arrays and single ones into strings. */
export function searchParamsToRecord(params: URLSearchParams): QueryRecord {
  const record: Record<string, QueryParamValue> = {};

  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);

    record[key] = values.length === 1 ? values[0] : values;
  }

  return record;
}

/** Validates a query string against a strict schema. */
export function parseSearchParams<TValue>(
  schema: z.ZodType<TValue>,
  params: URLSearchParams,
): ApiResult<TValue> {
  return parseRequestPayload(schema, searchParamsToRecord(params));
}
