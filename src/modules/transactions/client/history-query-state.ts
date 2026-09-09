/**
 * URL source of truth for Todos history filters.
 *
 * The browser history stores the same dimensions the list adapter sends:
 * free-text `q`, inclusive `dateFrom`/`dateTo` LocalDate bounds, a single type,
 * a single category, repeated `tagId` values with OR semantics and the
 * computed `untagged` group, which is mutually exclusive with them. Unknown keys
 * such as `tab` stay untouched so switching filters cannot drop the active
 * section. Duplicate tag identifiers collapse in first-seen order; empty text
 * is omitted rather than stored as `q=`. Invalid civil dates in the URL are
 * ignored instead of being converted through a time zone.
 */

import { encodeApiQuery } from "../../../shared/client/query";
import { parseLocalDate, type LocalDate } from "../../../shared/domain/dates";
import {
  isTransactionType,
  type TransactionType,
} from "../domain/transaction-type";
import type { TransactionListQuery } from "../contracts/http";
import { readHistoryTab, type HistoryTab } from "../ui/history-copy";

/** Milliseconds to wait after the last keystroke before committing `q`. */
export const HISTORY_SEARCH_DEBOUNCE_MS = 300;

const FILTER_KEYS = [
  "q",
  "dateFrom",
  "dateTo",
  "type",
  "categoryId",
  "tagId",
  "untagged",
] as const;

/** Value the untagged filter is written with; anything else is not the group. */
const UNTAGGED_VALUE = "true";

/** Applied Todos filters, already unique and free of empty values. */
export interface HistoryQueryState {
  readonly q: string;
  readonly dateFrom: LocalDate | null;
  readonly dateTo: LocalDate | null;
  readonly type: TransactionType | null;
  readonly categoryId: string | null;
  readonly tagIds: readonly string[];
  /**
   * Movements with no tag at all.
   *
   * The server refuses a request that asks for the untagged group and for a
   * tag at the same time, so the two can never travel together: setting this
   * drops the tag filter, and choosing a tag clears this.
   */
  readonly untagged: boolean;
}

export const emptyHistoryQueryState: HistoryQueryState = {
  q: "",
  dateFrom: null,
  dateTo: null,
  type: null,
  categoryId: null,
  tagIds: [],
  untagged: false,
};

/** True when no list filter is active. */
export function isHistoryQueryEmpty(state: HistoryQueryState): boolean {
  return (
    state.q === "" &&
    state.dateFrom === null &&
    state.dateTo === null &&
    state.type === null &&
    state.categoryId === null &&
    state.tagIds.length === 0 &&
    !state.untagged
  );
}

export function historyQueryEquals(
  left: HistoryQueryState,
  right: HistoryQueryState,
): boolean {
  return (
    left.q === right.q &&
    left.dateFrom === right.dateFrom &&
    left.dateTo === right.dateTo &&
    left.type === right.type &&
    left.categoryId === right.categoryId &&
    left.untagged === right.untagged &&
    left.tagIds.length === right.tagIds.length &&
    left.tagIds.every((tagId, index) => tagId === right.tagIds[index])
  );
}

/** Drops blanks and later copies, keeping the first occurrence. */
export function uniqueTagIds(tagIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const tagId of tagIds) {
    if (tagId === "" || seen.has(tagId)) {
      continue;
    }

    seen.add(tagId);
    unique.push(tagId);
  }

  return unique;
}

function readSingle(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  const first = values[0]?.trim() ?? "";
  return first === "" ? null : first;
}

function readLocalDate(
  params: URLSearchParams,
  key: "dateFrom" | "dateTo",
): LocalDate | null {
  const raw = readSingle(params, key);
  if (raw === null) {
    return null;
  }

  const parsed = parseLocalDate(raw);
  return parsed.ok ? parsed.value : null;
}

/** Reads the documented filter keys from a history URL. */
export function parseHistoryQueryState(
  params: URLSearchParams,
): HistoryQueryState {
  const q = readSingle(params, "q") ?? "";
  const typeValue = readSingle(params, "type");
  const type =
    typeValue !== null && isTransactionType(typeValue) ? typeValue : null;
  const tagIds = uniqueTagIds(
    params.getAll("tagId").map((tagId) => tagId.trim()),
  );
  // The two tag filters exclude each other, and a URL that carries both would
  // be refused by the server: the explicit tags win over the computed group.
  const untagged =
    tagIds.length === 0 && readSingle(params, "untagged") === UNTAGGED_VALUE;

  return {
    q,
    dateFrom: readLocalDate(params, "dateFrom"),
    dateTo: readLocalDate(params, "dateTo"),
    type,
    categoryId: readSingle(params, "categoryId"),
    tagIds,
    untagged,
  };
}

/**
 * Writes filters onto a copy of the current query, preserving `tab` and any
 * unrelated keys.
 */
export function writeHistoryQueryState(
  params: URLSearchParams,
  state: HistoryQueryState,
): URLSearchParams {
  const next = new URLSearchParams(params);

  for (const key of FILTER_KEYS) {
    next.delete(key);
  }

  if (state.q !== "") {
    next.set("q", state.q);
  }

  if (state.dateFrom !== null) {
    next.set("dateFrom", state.dateFrom);
  }

  if (state.dateTo !== null) {
    next.set("dateTo", state.dateTo);
  }

  if (state.type !== null) {
    next.set("type", state.type);
  }

  if (state.categoryId !== null) {
    next.set("categoryId", state.categoryId);
  }

  const tagIds = uniqueTagIds(state.tagIds);

  for (const tagId of tagIds) {
    next.append("tagId", tagId);
  }

  if (state.untagged && tagIds.length === 0) {
    next.set("untagged", UNTAGGED_VALUE);
  }

  return next;
}

/** Origin-relative history URL for a tab plus the current filters. */
export function historyPageHref(
  tab: HistoryTab,
  state: HistoryQueryState,
  current: URLSearchParams = new URLSearchParams(),
): string {
  const next = writeHistoryQueryState(current, state);
  next.set("tab", tab);
  const query = next.toString();
  return query === "" ? "/transactions" : `/transactions?${query}`;
}

export function readHistoryTabFromSearch(params: URLSearchParams): HistoryTab {
  return readHistoryTab(params.get("tab") ?? undefined);
}

/** List adapter query for the first page of the current filters. */
export function toTransactionListQuery(
  state: HistoryQueryState,
): TransactionListQuery {
  const tagIds = uniqueTagIds(state.tagIds);

  return {
    dateFrom: state.dateFrom ?? undefined,
    dateTo: state.dateTo ?? undefined,
    q: state.q === "" ? undefined : state.q,
    type: state.type ?? undefined,
    categoryId: state.categoryId ?? undefined,
    tagId:
      tagIds.length === 0
        ? undefined
        : tagIds.length === 1
          ? tagIds[0]
          : tagIds,
    untagged: tagIds.length === 0 && state.untagged ? true : undefined,
  };
}

/**
 * Identity of the list request. Changing it must drop accumulated pages and
 * ignore a slower response from the previous filter set.
 */
export function historyQueryRequestKey(state: HistoryQueryState): string {
  const query = toTransactionListQuery(state);
  return `transactions:history${encodeApiQuery({
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    q: query.q,
    type: query.type,
    categoryId: query.categoryId,
    tagId: query.tagId,
    untagged: query.untagged,
  })}`;
}

export function withoutHistoryChip(
  state: HistoryQueryState,
  chip: HistoryChip,
): HistoryQueryState {
  switch (chip.kind) {
    case "q":
      return { ...state, q: "" };
    case "dateFrom":
      return { ...state, dateFrom: null };
    case "dateTo":
      return { ...state, dateTo: null };
    case "type":
      return { ...state, type: null };
    case "category":
      return { ...state, categoryId: null };
    case "tag":
      return {
        ...state,
        tagIds: state.tagIds.filter((tagId) => tagId !== chip.tagId),
      };
    case "untagged":
      return { ...state, untagged: false };
  }
}

/** One removable summary of an applied filter. */
export type HistoryChip =
  | { readonly kind: "q"; readonly label: string }
  | { readonly kind: "dateFrom"; readonly label: string }
  | { readonly kind: "dateTo"; readonly label: string }
  | { readonly kind: "type"; readonly label: string }
  | { readonly kind: "category"; readonly label: string }
  | { readonly kind: "tag"; readonly label: string; readonly tagId: string }
  | { readonly kind: "untagged"; readonly label: string };
