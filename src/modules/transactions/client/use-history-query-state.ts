"use client";

/**
 * Binds Todos filter state to the App Router URL so back/forward restore it.
 *
 * Each committed change pushes a history entry. The list never writes filters
 * of its own; it only rereads `searchParams`.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

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

export function useHistoryQueryState(): HistoryQueryController {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const search = searchParams.toString();

  const params = useMemo(() => new URLSearchParams(search), [search]);
  const tab = readHistoryTabFromSearch(params);
  const state = useMemo(() => parseHistoryQueryState(params), [params]);

  const setState = useCallback(
    (next: HistoryQueryState) => {
      if (historyQueryEquals(state, next)) {
        return;
      }

      const href = historyPageHref(tab, next, params);
      if (href === `${pathname}${search === "" ? "" : `?${search}`}`) {
        return;
      }

      router.push(href);
    },
    [params, pathname, router, search, state, tab],
  );

  return { tab, state, setState };
}

export { emptyHistoryQueryState };
