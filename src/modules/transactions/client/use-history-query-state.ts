"use client";

/**
 * Binds Todos filter state to the App Router URL so back/forward restore it.
 *
 * Each committed change pushes a history entry. The list never writes filters
 * of its own; it only rereads `searchParams`.
 *
 * A push only reaches `searchParams` once the router commits the navigation, so
 * the committed URL lags behind the last requested filters. Until it commits,
 * the requested filters are reported as the current state; otherwise a second
 * change made during that window would compose on the previous filters and
 * silently resurrect the ones just removed.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import {
  emptyHistoryQueryState,
  historyPageHref,
  historyQueryEquals,
  parseHistoryQueryState,
  readHistoryTabFromSearch,
  type HistoryQueryState,
} from "./history-query-state";
import type { HistoryTab } from "../ui/history-copy";

export interface HistoryQueryController {
  readonly tab: HistoryTab;
  readonly state: HistoryQueryState;
  readonly setState: (next: HistoryQueryState) => void;
}

/** Filters requested by a push, with the URL they were composed on. */
interface PendingHistoryQuery {
  readonly from: string;
  readonly state: HistoryQueryState;
}

export function useHistoryQueryState(): HistoryQueryController {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const search = searchParams.toString();
  const [pending, setPending] = useState<PendingHistoryQuery | null>(null);

  const params = useMemo(() => new URLSearchParams(search), [search]);
  const href = `${pathname}${search === "" ? "" : `?${search}`}`;
  const tab = readHistoryTabFromSearch(params);
  const committed = useMemo(() => parseHistoryQueryState(params), [params]);
  // The URL settled, on the requested href or elsewhere after back/forward, so
  // it is the source of truth again and the request can be dropped.
  const requested = pending !== null && pending.from === href ? pending : null;
  if (pending !== null && requested === null) {
    setPending(null);
  }

  const state = requested?.state ?? committed;

  const setState = useCallback(
    (next: HistoryQueryState) => {
      if (historyQueryEquals(state, next)) {
        return;
      }

      const nextHref = historyPageHref(tab, next, params);
      if (requested === null && nextHref === href) {
        return;
      }

      setPending({ from: href, state: next });
      router.push(nextHref);
    },
    [href, params, requested, router, state, tab],
  );

  return { tab, state, setState };
}

export { emptyHistoryQueryState };
