"use client";

/**
 * Selection of one dimension, bound to the session of the browser.
 *
 * The stored entry is read as an external value rather than copied into state,
 * so the first paint of the server and the first paint of the browser agree and
 * a stored decision is applied on the same commit that hydrates the page. Every
 * selector reading the same session is notified when one of them writes.
 *
 * Nothing is written until the owner changes the selection. That is what tells
 * a session that follows the catalog from one that made a decision, and it is
 * why a newly created active classification joins the first but not the second.
 *
 * The last choice made here is also kept in the component, so a browser that
 * refuses to store anything — a private session, or one with site data blocked
 * — still lets the owner choose what is drawn. It simply forgets the choice on
 * the next load, which is what "no storage" means.
 */

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import type { MultiSelectOption } from "../../../../shared/ui/multi-select";
import {
  defaultSeriesIds,
  parseSeriesIds,
  readSeriesEntry,
  resolveSeriesIds,
  seriesStorageKey,
  writeStoredSeriesIds,
  type SeriesDimension,
  type SeriesStorage,
} from "./series-selection";

/** Selection of one dimension and the two ways of changing it. */
export interface SeriesSelection {
  readonly ids: readonly string[];
  readonly setIds: (next: readonly string[]) => void;
  readonly selectAll: () => void;
}

export interface UseSeriesSelectionOptions {
  readonly dimension: SeriesDimension;
  /** Application mode the selection belongs to, or null until it is known. */
  readonly mode: string | null;
  readonly options: readonly MultiSelectOption[];
  /** Session storage. Tests replace this at the browser boundary. */
  readonly storage?: SeriesStorage | null;
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function notifyStoredSelectionChanged(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}

function browserSessionStorage(): SeriesStorage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Reads and keeps the selection of one dimension for the current mode. */
export function useSeriesSelection({
  dimension,
  mode,
  options,
  storage,
}: UseSeriesSelectionOptions): SeriesSelection {
  const key = mode === null ? null : seriesStorageKey(dimension, mode);
  const session = storage === undefined ? browserSessionStorage() : storage;
  const readEntry = useCallback(
    () => (key === null ? null : readSeriesEntry(session, key)),
    [key, session],
  );
  // The server has no session, so it always paints the catalog selection.
  const entry = useSyncExternalStore(subscribe, readEntry, () => null);
  const [chosen, setChosen] = useState<{
    readonly key: string;
    readonly raw: string;
  } | null>(null);
  // A choice made for another mode belongs to that mode alone.
  const localEntry = chosen !== null && chosen.key === key ? chosen.raw : null;
  const stored = useMemo(
    () => parseSeriesIds(localEntry ?? entry),
    [entry, localEntry],
  );

  const setIds = useCallback(
    (next: readonly string[]) => {
      if (key === null) {
        return;
      }

      setChosen({ key, raw: JSON.stringify([...next]) });
      writeStoredSeriesIds(session, key, next);
      notifyStoredSelectionChanged();
    },
    [key, session],
  );

  const selectAll = useCallback(() => {
    setIds(defaultSeriesIds(options));
  }, [options, setIds]);

  return { ids: resolveSeriesIds(options, stored), setIds, selectAll };
}
