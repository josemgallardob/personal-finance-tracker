/**
 * URL source of truth for Todos history filters.
 *
 * The browser history stores the same dimensions the list adapter sends:
 * free-text `q`, a single type, a single category and repeated `tagId` values
 * with OR semantics. Unknown keys such as `tab` stay untouched so switching
 * filters cannot drop the active section. Duplicate tag identifiers collapse
 * in first-seen order; empty text is omitted rather than stored as `q=`.
 */

import { encodeApiQuery } from "../../../shared/client/query";
import {
  isTransactionType,
  type TransactionType,
} from "../domain/transaction-type";
import type { TransactionListQuery } from "../contracts/http";
import { readHistoryTab, type HistoryTab } from "../ui/history-copy";

/** Milliseconds to wait after the last keystroke before committing `q`. */
export const HISTORY_SEARCH_DEBOUNCE_MS = 300;

const FILTER_KEYS = ["q", "type", "categoryId", "tagId"] as const;

/** Applied Todos filters, already unique and free of empty values. */
export interface HistoryQueryState {
  readonly q: string;
  readonly type: TransactionType | null;
  readonly categoryId: string | null;
  readonly tagIds: readonly string[];
}

export const emptyHistoryQueryState: HistoryQueryState = {
  q: "",
  type: null,
  categoryId: null,
  tagIds: [],
};

/** True when no list filter is active. */
export function isHistoryQueryEmpty(state: HistoryQueryState): boolean {
  return (
    state.q === "" &&
    state.type === null &&
    state.categoryId === null &&
    state.tagIds.length === 0
  );
}

export function historyQueryEquals(
  left: HistoryQueryState,
  right: HistoryQueryState,
): boolean {
  return (
    left.q === right.q &&
    left.type === right.type &&
    left.categoryId === right.categoryId &&
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

/** Reads the documented filter keys from a history URL. */
export function parseHistoryQueryState(
  params: URLSearchParams,
): HistoryQueryState {
  const q = readSingle(params, "q") ?? "";
  const typeValue = readSingle(params, "type");
  const type =
    typeValue !== null && isTransactionType(typeValue) ? typeValue : null;

  return {
    q,
    type,
    categoryId: readSingle(params, "categoryId"),
    tagIds: uniqueTagIds(params.getAll("tagId").map((tagId) => tagId.trim())),
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

  if (state.type !== null) {
    next.set("type", state.type);
  }

  if (state.categoryId !== null) {
    next.set("categoryId", state.categoryId);
  }

  for (const tagId of uniqueTagIds(state.tagIds)) {
    next.append("tagId", tagId);
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
    q: state.q === "" ? undefined : state.q,
    type: state.type ?? undefined,
    categoryId: state.categoryId ?? undefined,
    tagId:
      tagIds.length === 0
        ? undefined
        : tagIds.length === 1
          ? tagIds[0]
          : tagIds,
  };
}

/**
 * Identity of the list request. Changing it must drop accumulated pages and
 * ignore a slower response from the previous filter set.
 */
export function historyQueryRequestKey(state: HistoryQueryState): string {
  const query = toTransactionListQuery(state);
  return `transactions:history${encodeApiQuery({
    q: query.q,
    type: query.type,
    categoryId: query.categoryId,
    tagId: query.tagId,
  })}`;
}

export function withoutHistoryChip(
  state: HistoryQueryState,
  chip: HistoryChip,
): HistoryQueryState {
  switch (chip.kind) {
    case "q":
      return { ...state, q: "" };
    case "type":
      return { ...state, type: null };
    case "category":
      return { ...state, categoryId: null };
    case "tag":
      return {
        ...state,
        tagIds: state.tagIds.filter((tagId) => tagId !== chip.tagId),
      };
  }
}

/** One removable summary of an applied filter. */
export type HistoryChip =
  | { readonly kind: "q"; readonly label: string }
  | { readonly kind: "type"; readonly label: string }
  | { readonly kind: "category"; readonly label: string }
  | { readonly kind: "tag"; readonly label: string; readonly tagId: string };
