/**
 * Internal history-list filter contract.
 *
 * The HTTP layer never reaches this module. Callers pass the same dimensions
 * the history URL will expose later; this contract validates them, binds an
 * opaque cursor to a fingerprint of the normalised filters, and produces the
 * query the storage adapter runs. Changing any filter yields a different
 * fingerprint, so a leftover cursor cannot continue a different sequence.
 */

import { createHash } from "node:crypto";

import {
  compareLocalDates,
  parseLocalDate,
  type LocalDate,
} from "../../../shared/domain/dates";
import {
  type DomainError,
  type DomainResult,
  domainError,
  invalid,
  valid,
} from "../../../shared/domain/errors";
import { isTimestamp } from "../../../shared/domain/timestamp";
import { isIdentifier, normalizeFreeText } from "../../../shared/domain/text";
import {
  isTransactionType,
  type TransactionType,
} from "../domain/transaction-type";

/** First page size when the caller does not ask for another. */
export const DEFAULT_TRANSACTION_PAGE_SIZE = 30;

/** Largest page the history query accepts. */
export const MAX_TRANSACTION_PAGE_SIZE = 100;

/** Version written into every cursor so a future encoding can be refused. */
const CURSOR_VERSION = 1;

/** Input of a history page before validation. */
export interface ListTransactionsInput {
  readonly workspaceId: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly type?: string;
  readonly categoryId?: string;
  readonly tagIds?: readonly string[];
  readonly untagged?: boolean;
  readonly q?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

/** Sort key of the last movement of a page, used to continue the sequence. */
export interface ListKeyset {
  readonly date: string;
  readonly createdAt: number;
  readonly id: string;
}

/**
 * Validated history query the storage adapter understands.
 *
 * Filter dimensions are already normalised. `after` is the decoded keyset of
 * a cursor that matched this fingerprint, or `null` for the first page.
 */
export interface NormalizedTransactionListQuery {
  readonly workspaceId: string;
  readonly dateFrom: LocalDate | null;
  readonly dateTo: LocalDate | null;
  readonly type: TransactionType | null;
  readonly categoryId: string | null;
  readonly tagIds: readonly string[];
  readonly untagged: boolean;
  readonly textQuery: string | null;
  readonly after: ListKeyset | null;
  readonly limit: number;
  readonly fingerprint: string;
}

/** Payload stored inside the opaque cursor. */
interface CursorPayload {
  readonly v: number;
  readonly d: string;
  readonly c: number;
  readonly i: string;
  readonly f: string;
}

/**
 * Validates a history-list request and binds its cursor to the filters.
 *
 * Open date limits are inclusive and independent. Several tag identifiers mean
 * OR. `untagged` cannot travel with any tag identifier: that combination is a
 * validation error, not an empty intersection.
 */
export function parseListTransactionsInput(
  input: ListTransactionsInput,
): DomainResult<NormalizedTransactionListQuery> {
  const errors: DomainError[] = [];
  const dateFrom = parseOptionalDate("dateFrom", input.dateFrom, errors);
  const dateTo = parseOptionalDate("dateTo", input.dateTo, errors);

  if (
    dateFrom !== null &&
    dateTo !== null &&
    compareLocalDates(dateFrom, dateTo) > 0
  ) {
    errors.push(domainError("dateFrom", "invalidDate"));
  }

  let type: TransactionType | null = null;

  if (input.type !== undefined) {
    if (!isTransactionType(input.type)) {
      errors.push(domainError("type", "invalidTransactionType"));
    } else {
      type = input.type;
    }
  }

  let categoryId: string | null = null;

  if (input.categoryId !== undefined) {
    if (!isIdentifier(input.categoryId)) {
      errors.push(domainError("categoryId", "invalidIdentifier"));
    } else {
      categoryId = input.categoryId;
    }
  }

  const tagIds = uniqueSorted(input.tagIds ?? []);

  for (const tagId of input.tagIds ?? []) {
    if (!isIdentifier(tagId)) {
      errors.push(domainError("tagId", "invalidIdentifier"));
      break;
    }
  }

  const untagged = input.untagged === true;

  if (untagged && tagIds.length > 0) {
    errors.push(domainError("tagId", "incompatibleFilters"));
    errors.push(domainError("untagged", "incompatibleFilters"));
  }

  const textQuery = parseTextQuery(input.q);
  const limit = parseLimit(input.limit, errors);
  const fingerprint = filterFingerprint({
    dateFrom,
    dateTo,
    type,
    categoryId,
    tagIds,
    untagged,
    textQuery,
  });
  const after = parseCursor(input.cursor, fingerprint, errors);

  if (errors.length > 0) {
    return invalid(errors);
  }

  return valid({
    workspaceId: input.workspaceId,
    dateFrom,
    dateTo,
    type,
    categoryId,
    tagIds,
    untagged,
    textQuery,
    after,
    limit,
    fingerprint,
  });
}

/**
 * Builds the opaque cursor of a page from the last movement that belongs to
 * the same normalised filters. The next request must repeat those filters.
 */
export function encodeListCursor(
  keyset: ListKeyset,
  fingerprint: string,
): string {
  const payload: CursorPayload = {
    v: CURSOR_VERSION,
    d: keyset.date,
    c: keyset.createdAt,
    i: keyset.id,
    f: fingerprint,
  };

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * Escapes a user search so `%`, `_` and the LIKE escape character stay
 * literal when the adapter wraps the value in a wildcard pattern.
 */
export function escapeLikeLiteral(value: string): string {
  return value
    .replaceAll("!", "!!")
    .replaceAll("%", "!%")
    .replaceAll("_", "!_");
}

interface FingerprintInput {
  readonly dateFrom: LocalDate | null;
  readonly dateTo: LocalDate | null;
  readonly type: TransactionType | null;
  readonly categoryId: string | null;
  readonly tagIds: readonly string[];
  readonly untagged: boolean;
  readonly textQuery: string | null;
}

function filterFingerprint(filters: FingerprintInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        type: filters.type,
        categoryId: filters.categoryId,
        tagIds: filters.tagIds,
        untagged: filters.untagged,
        q: filters.textQuery,
      }),
    )
    .digest("base64url");
}

function parseOptionalDate(
  field: string,
  value: string | undefined,
  errors: DomainError[],
): LocalDate | null {
  if (value === undefined) {
    return null;
  }

  const parsed = parseLocalDate(value);

  if (!parsed.ok) {
    errors.push(domainError(field, "invalidDate"));
    return null;
  }

  return parsed.value;
}

function parseTextQuery(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  const text = normalizeFreeText(value, false);

  return text.length === 0 ? null : text;
}

function parseLimit(value: number | undefined, errors: DomainError[]): number {
  if (value === undefined) {
    return DEFAULT_TRANSACTION_PAGE_SIZE;
  }

  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_TRANSACTION_PAGE_SIZE
  ) {
    errors.push(domainError("limit", "invalidLimit"));
    return DEFAULT_TRANSACTION_PAGE_SIZE;
  }

  return value;
}

function parseCursor(
  value: string | undefined,
  fingerprint: string,
  errors: DomainError[],
): ListKeyset | null {
  if (value === undefined || value.length === 0) {
    return null;
  }

  const payload = decodeCursorPayload(value);

  if (payload === null || payload.f !== fingerprint) {
    errors.push(domainError("cursor", "invalidCursor"));
    return null;
  }

  return { date: payload.d, createdAt: payload.c, id: payload.i };
}

function decodeCursorPayload(value: string): CursorPayload | null {
  const json = Buffer.from(value, "base64url").toString("utf8");

  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const payload = parsed as Partial<CursorPayload>;

  if (payload.v !== CURSOR_VERSION) {
    return null;
  }

  if (typeof payload.d !== "string" || parseLocalDate(payload.d).ok === false) {
    return null;
  }

  if (typeof payload.c !== "number" || !isTimestamp(payload.c)) {
    return null;
  }

  if (typeof payload.i !== "string" || !isIdentifier(payload.i)) {
    return null;
  }

  if (typeof payload.f !== "string" || payload.f.length === 0) {
    return null;
  }

  return {
    v: payload.v,
    d: payload.d,
    c: payload.c,
    i: payload.i,
    f: payload.f,
  };
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}
