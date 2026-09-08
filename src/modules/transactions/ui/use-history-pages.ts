"use client";

/**
 * Cursor pages of the Todos history.
 *
 * The first page follows the local resource lifecycle. Later pages append
 * under a single in-flight gate so an IntersectionObserver burst or a second
 * "Cargar más" press cannot duplicate a request. Filter identity and mutation
 * revision abort the current call and drop accumulated rows; a failed later
 * page keeps what is already on screen until the owner retries that cursor.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ApiClientFailure,
  ApiClientResult,
} from "../../../shared/client/api-client";
import {
  paginationResetKey,
  useResource,
  type ResourceStatus,
} from "../../../shared/client/use-resource";
import type {
  TransactionCursorPageDto,
  TransactionDto,
} from "../contracts/transaction";

/** Loads one history page. `cursor` is omitted for the first page. */
export type HistoryPageLoader = (
  cursor: string | undefined,
  signal: AbortSignal,
) => Promise<ApiClientResult<TransactionCursorPageDto>>;

export interface UseHistoryPagesOptions {
  readonly loadPage: HistoryPageLoader;
  readonly requestKey: string;
  readonly revision: number;
  readonly refreshEpoch: number;
}

export interface HistoryPagesSnapshot {
  readonly status: ResourceStatus;
  readonly items: readonly TransactionDto[];
  readonly error: ApiClientFailure | undefined;
  readonly refetch: () => void;
  readonly hasMore: boolean;
  readonly endReached: boolean;
  readonly isLoadingMore: boolean;
  readonly pageError: ApiClientFailure | undefined;
  readonly loadMore: () => void;
  readonly retryPage: () => void;
}

interface ExtraPagesState {
  readonly resetKey: string;
  readonly items: readonly TransactionDto[];
  readonly nextCursor: string | null | undefined;
  readonly failedCursor: string | undefined;
  readonly pageError: ApiClientFailure | undefined;
  readonly isLoadingMore: boolean;
}

function emptyExtra(resetKey: string): ExtraPagesState {
  return {
    resetKey,
    items: [],
    nextCursor: undefined,
    failedCursor: undefined,
    pageError: undefined,
    isLoadingMore: false,
  };
}

/**
 * Appends a page while skipping identifiers already shown.
 *
 * Same-date ties can repeat a boundary row across pages; the owner must see
 * each movement once as they walk the sequence.
 */
export function mergeHistoryItems(
  current: readonly TransactionDto[],
  incoming: readonly TransactionDto[],
): TransactionDto[] {
  if (incoming.length === 0) {
    return [...current];
  }

  if (current.length === 0) {
    const seen = new Set<string>();
    const unique: TransactionDto[] = [];

    for (const item of incoming) {
      if (seen.has(item.id)) {
        continue;
      }

      seen.add(item.id);
      unique.push(item);
    }

    return unique;
  }

  const seen = new Set(current.map((item) => item.id));
  const extra: TransactionDto[] = [];

  for (const item of incoming) {
    if (seen.has(item.id)) {
      continue;
    }

    seen.add(item.id);
    extra.push(item);
  }

  return extra.length === 0 ? [...current] : [...current, ...extra];
}

function pageItems(
  result: Extract<ApiClientResult<TransactionCursorPageDto>, { ok: true }>,
): TransactionCursorPageDto {
  if (result.noContent) {
    return { items: [], nextCursor: null };
  }

  return result.data;
}

/**
 * Accumulates history cursor pages with abort, one-request gating and id
 * deduplication.
 */
export function useHistoryPages(
  options: UseHistoryPagesOptions,
): HistoryPagesSnapshot {
  const { loadPage, requestKey, revision, refreshEpoch } = options;
  const resetKey = paginationResetKey(requestKey, revision);
  const first = useResource({
    requestKey,
    revision,
    refreshEpoch,
    load: (signal) => loadPage(undefined, signal),
  });
  const [extra, setExtra] = useState<ExtraPagesState>(() =>
    emptyExtra(resetKey),
  );

  if (extra.resetKey !== resetKey) {
    setExtra(emptyExtra(resetKey));
  }

  const loadPageRef = useRef(loadPage);
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const appliedExtra =
    extra.resetKey === resetKey ? extra : emptyExtra(resetKey);
  const firstItems = first.data?.items ?? [];
  const items = mergeHistoryItems(firstItems, appliedExtra.items);
  const nextCursor =
    appliedExtra.nextCursor !== undefined
      ? appliedExtra.nextCursor
      : (first.data?.nextCursor ?? null);
  const hasMore =
    first.status === "ready" &&
    nextCursor !== null &&
    appliedExtra.pageError === undefined;
  const endReached =
    first.status === "ready" &&
    items.length > 0 &&
    nextCursor === null &&
    !appliedExtra.isLoadingMore &&
    appliedExtra.pageError === undefined;

  const runNextPage = useCallback(
    (cursor: string) => {
      if (inFlightRef.current || cursor === "") {
        return;
      }

      inFlightRef.current = true;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const generationResetKey = resetKey;

      setExtra((current) => ({
        ...(current.resetKey === generationResetKey
          ? current
          : emptyExtra(generationResetKey)),
        resetKey: generationResetKey,
        isLoadingMore: true,
        pageError: undefined,
        failedCursor: cursor,
      }));

      void (async () => {
        let result: ApiClientResult<TransactionCursorPageDto>;

        try {
          result = await loadPageRef.current(cursor, controller.signal);
        } catch {
          result = controller.signal.aborted
            ? { ok: false, reason: "aborted" }
            : { ok: false, reason: "network" };
        }

        if (controller.signal.aborted) {
          if (abortRef.current === controller) {
            inFlightRef.current = false;
          }
          return;
        }

        if (!result.ok && result.reason === "aborted") {
          inFlightRef.current = false;
          setExtra((current) =>
            current.resetKey !== generationResetKey
              ? current
              : { ...current, isLoadingMore: false },
          );
          return;
        }

        if (result.ok) {
          const page = pageItems(result);
          setExtra((current) => {
            if (current.resetKey !== generationResetKey) {
              return current;
            }

            return {
              resetKey: generationResetKey,
              items: mergeHistoryItems(current.items, page.items),
              nextCursor: page.nextCursor,
              failedCursor: undefined,
              pageError: undefined,
              isLoadingMore: false,
            };
          });
          inFlightRef.current = false;
          return;
        }

        setExtra((current) => {
          if (current.resetKey !== generationResetKey) {
            return current;
          }

          return {
            ...current,
            isLoadingMore: false,
            pageError: result,
            failedCursor: cursor,
          };
        });
        inFlightRef.current = false;
      })();
    },
    [resetKey],
  );

  const loadMore = useCallback(() => {
    const cursor =
      appliedExtra.nextCursor !== undefined
        ? appliedExtra.nextCursor
        : (first.data?.nextCursor ?? null);

    if (
      first.status !== "ready" ||
      cursor === null ||
      appliedExtra.pageError !== undefined
    ) {
      return;
    }

    runNextPage(cursor);
  }, [
    appliedExtra.nextCursor,
    appliedExtra.pageError,
    first.data?.nextCursor,
    first.status,
    runNextPage,
  ]);

  const retryPage = useCallback(() => {
    const cursor = appliedExtra.failedCursor;

    if (cursor === undefined) {
      return;
    }

    runNextPage(cursor);
  }, [appliedExtra.failedCursor, runNextPage]);

  useEffect(() => {
    loadPageRef.current = loadPage;
  });

  useEffect(() => {
    inFlightRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;

    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      inFlightRef.current = false;
    };
  }, [resetKey]);

  return {
    status: first.status,
    items,
    error: first.error,
    refetch: first.refetch,
    hasMore,
    endReached,
    isLoadingMore: appliedExtra.isLoadingMore,
    pageError: appliedExtra.pageError,
    loadMore,
    retryPage,
  };
}
