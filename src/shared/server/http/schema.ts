/**
 * Strict request parsing.
 *
 * Request payloads are described with Zod object schemas that reject unknown
 * keys. Rejecting instead of stripping matters here: a silently dropped key is
 * a client that believes it saved something the server ignored, and it is also
 * the path a caller would use to smuggle a workspace identifier into a
 * command.
 *
 * Zod's own messages quote the offending value, so they never reach the
 * response. Each issue is translated into a stable English field code plus the
 * dotted path of the property, and nothing else.
 */

import "server-only";

import { z } from "zod";

import type { ApiFieldErrorDto, ApiSchemaErrorCode } from "../../contracts/api";
import { apiFailure, accepted, refused, type ApiResult } from "./failure";

/**
 * Keys a client may never send.
 *
 * The workspace is derived on the server from the database, so any request
 * that carries one is refused rather than having the key ignored.
 */
export const RESERVED_REQUEST_KEYS: readonly string[] = Object.freeze([
  "workspaceId",
  "workspace_id",
]);

/** Deepest payload the reserved-key scan walks before it stops descending. */
export const MAX_PAYLOAD_SCAN_DEPTH = 8;

/** Root path reported when an issue belongs to the payload as a whole. */
export const PAYLOAD_ROOT_FIELD = "body";

const ISSUE_FIELD_CODE: Readonly<
  Record<z.core.$ZodIssueCode, ApiSchemaErrorCode>
> = Object.freeze({
  invalid_type: "invalidType",
  too_big: "tooBig",
  too_small: "tooSmall",
  invalid_format: "invalidFormat",
  not_multiple_of: "invalidValue",
  invalid_value: "invalidValue",
  invalid_union: "invalidValue",
  invalid_key: "invalidValue",
  invalid_element: "invalidValue",
  unrecognized_keys: "unknownField",
  custom: "invalid",
});

/** Builds an object schema that refuses unknown keys. */
export const apiObject = z.strictObject;

function joinPath(segments: readonly PropertyKey[]): string {
  const path = segments.map((segment) => String(segment)).join(".");

  return path === "" ? PAYLOAD_ROOT_FIELD : path;
}

/**
 * Tells whether the payload actually carries a value at `path`.
 *
 * Zod does not expose the offending input on a public issue, and a missing
 * property and a property of the wrong type both arrive as `invalid_type`. The
 * distinction matters to a form, so it is recovered from the payload itself.
 * A path that cannot be walked, such as one inside a `Map`, counts as present:
 * reporting it as missing would be worse than reporting a type mismatch.
 */
function isTraversable(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (Array.isArray(value)) {
    return true;
  }

  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

function isMissingAt(payload: unknown, path: readonly PropertyKey[]): boolean {
  let current: unknown = payload;

  for (const segment of path) {
    if (!isTraversable(current)) {
      return false;
    }

    if (!(segment in current)) {
      return true;
    }

    current = current[segment];
  }

  return current === undefined;
}

function issueFieldErrors(
  issue: z.core.$ZodIssue,
  payload: unknown,
): ApiFieldErrorDto[] {
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => ({
      field: joinPath([...issue.path, key]),
      code: "unknownField" as const,
    }));
  }

  const code: ApiSchemaErrorCode =
    issue.code === "invalid_type" && isMissingAt(payload, issue.path)
      ? "required"
      : ISSUE_FIELD_CODE[issue.code];

  return [{ field: joinPath(issue.path), code }];
}

/**
 * Translates a Zod failure into sanitized field errors.
 *
 * Only the path and a stable code survive. Zod's own messages quote the
 * offending value, so they are dropped rather than forwarded.
 */
export function toSchemaFieldErrors(
  issues: readonly z.core.$ZodIssue[],
  payload: unknown,
): readonly ApiFieldErrorDto[] {
  return issues.flatMap((issue) => issueFieldErrors(issue, payload));
}

function findReservedKey(
  value: unknown,
  path: readonly PropertyKey[],
  depth: number,
): ApiFieldErrorDto | null {
  if (depth > MAX_PAYLOAD_SCAN_DEPTH || typeof value !== "object") {
    return null;
  }

  if (value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    for (const [index, element] of value.entries()) {
      const found = findReservedKey(element, [...path, index], depth + 1);

      if (found !== null) {
        return found;
      }
    }

    return null;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (RESERVED_REQUEST_KEYS.includes(key)) {
      return { field: joinPath([...path, key]), code: "unknownField" };
    }

    const found = findReservedKey(nested, [...path, key], depth + 1);

    if (found !== null) {
      return found;
    }
  }

  return null;
}

/**
 * Refuses a payload that carries a workspace identifier at any depth.
 *
 * A strict schema already rejects an undeclared key, but this check states the
 * rule explicitly and keeps holding for a schema that legitimately accepts a
 * nested free-form object.
 */
export function rejectClientWorkspace(
  payload: unknown,
): ApiFieldErrorDto | null {
  return findReservedKey(payload, [], 0);
}

/**
 * Validates a payload against a strict schema.
 *
 * The reserved-key rule runs first, so a request that tries to choose its own
 * workspace is refused with that reason instead of an unrelated shape error.
 */
export function parseRequestPayload<TValue>(
  schema: z.ZodType<TValue>,
  payload: unknown,
): ApiResult<TValue> {
  const reserved = rejectClientWorkspace(payload);

  if (reserved !== null) {
    return refused(apiFailure("validationFailed", [reserved]));
  }

  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    return refused(
      apiFailure(
        "validationFailed",
        toSchemaFieldErrors(parsed.error.issues, payload),
      ),
    );
  }

  return accepted(parsed.data);
}
