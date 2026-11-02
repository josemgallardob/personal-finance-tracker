"use client";

/**
 * The selected period, kept for the session of the browser.
 *
 * The period never enters the query string: the history owns the URL, and a
 * filter applied there must not be able to move the months the cards are
 * aggregated over. It is still not ephemeral, because leaving the dashboard to
 * read the movements behind a figure and coming back must return the owner to
 * the period they were reading, not to the default one.
 *
 * A stored value that is not a documented period is ignored instead of being
 * repaired, so a corrupted entry costs the owner one selection and never an
 * unreadable dashboard. The last choice is also kept in the component, so a
 * browser that refuses to store anything still lets the owner change period and
 * simply forgets it on the next load.
 */

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { parseMonthKey } from "../../../shared/domain/dates";
import type { SeriesStorage } from "./series/series-selection";
import {
  DASHBOARD_PERIOD_KINDS,
  type DashboardPeriod,
  type DashboardPeriodKind,
} from "../domain/periods";
import { DEFAULT_DASHBOARD_PERIOD } from "./dashboard-period";

/** Key used for the selected dashboard period. */
export const DASHBOARD_PERIOD_STORAGE_PREFIX = "dashboard:period";

/** Builds the stable personal-dashboard storage key. */
export function dashboardPeriodStorageKey(): string {
  return `${DASHBOARD_PERIOD_STORAGE_PREFIX}:personal`;
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function notifyStoredPeriodChanged(): void {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPeriodKind(value: unknown): value is DashboardPeriodKind {
  return (
    typeof value === "string" &&
    (DASHBOARD_PERIOD_KINDS as readonly string[]).includes(value)
  );
}

/** Raw stored text of the period, or null when the session has none. */
export function readPeriodEntry(
  storage: SeriesStorage | null,
  key: string,
): string | null {
  if (storage === null) {
    return null;
  }

  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * The period a stored entry names, or null when it names none.
 *
 * A custom range is accepted only with two real natural months in order, which
 * is the same rule the server applies to the request it would produce.
 */
export function parseStoredPeriod(raw: string | null): DashboardPeriod | null {
  if (raw === null) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || !isPeriodKind(parsed.kind)) {
    return null;
  }

  if (parsed.kind !== "customMonthRange") {
    return { kind: parsed.kind };
  }

  if (typeof parsed.from !== "string" || typeof parsed.to !== "string") {
    return null;
  }

  const from = parseMonthKey(parsed.from);
  const to = parseMonthKey(parsed.to);

  if (!from.ok || !to.ok || from.value > to.value) {
    return null;
  }

  return { kind: "customMonthRange", from: from.value, to: to.value };
}

/** Stores the selected period, ignoring a storage that refuses to keep it. */
export function writeStoredPeriod(
  storage: SeriesStorage | null,
  key: string,
  period: DashboardPeriod,
): void {
  if (storage === null) {
    return;
  }

  try {
    storage.setItem(key, JSON.stringify(period));
  } catch {
    return;
  }
}

/** Selected period and the way of changing it. */
export interface DashboardPeriodSelection {
  readonly period: DashboardPeriod;
  readonly setPeriod: (next: DashboardPeriod) => void;
}

export interface UseDashboardPeriodOptions {
  /** Period of a session that has never chosen one. */
  readonly initialPeriod?: DashboardPeriod;
  /** Session storage. Tests replace this at the browser boundary. */
  readonly storage?: SeriesStorage | null;
}

/** Reads and keeps the period of the dashboard for this session. */
export function useDashboardPeriod({
  initialPeriod = DEFAULT_DASHBOARD_PERIOD,
  storage,
}: UseDashboardPeriodOptions = {}): DashboardPeriodSelection {
  const session = storage === undefined ? browserSessionStorage() : storage;
  const key = dashboardPeriodStorageKey();
  const readEntry = useCallback(
    () => readPeriodEntry(session, key),
    [key, session],
  );
  // The server has no session, so it always paints the default period.
  const entry = useSyncExternalStore(subscribe, readEntry, () => null);
  const stored = useMemo(() => parseStoredPeriod(entry), [entry]);
  const [chosen, setChosen] = useState<{
    readonly key: string;
    readonly period: DashboardPeriod;
  } | null>(null);
  const localPeriod =
    chosen !== null && chosen.key === key ? chosen.period : null;

  const setPeriod = useCallback(
    (next: DashboardPeriod) => {
      setChosen({ key, period: next });
      writeStoredPeriod(session, key, next);
      notifyStoredPeriodChanged();
    },
    [key, session],
  );

  return { period: localPeriod ?? stored ?? initialPeriod, setPeriod };
}
