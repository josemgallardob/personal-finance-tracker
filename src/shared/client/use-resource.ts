"use client";

/**
 * Local resource lifecycle for a single browser view.
 *
 * Each mounted consumer owns its request. There is no shared cache: a filter
 * change, a successful mutation revision or an explicit refetch starts a new
 * call, and only the latest generation may apply its result. A slow answer
 * from a previous filter cannot paint over the current one, and unmounting
 * aborts the in-flight call so a detached view never writes to state.
 *
 * Background refresh (focus or polling) keeps the last representation until
 * the new one arrives. Changing the query identity clears it, because that
 * data belongs to another filter. Abort is silent: it is not an error a form
 * should display.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { ApiClientFailure, ApiClientResult } from "./api-client";

/** Observable phase of a local resource. */
export type ResourceStatus = "loading" | "ready" | "error";

/** Inputs that identify and load one resource. */
export interface UseResourceOptions<TData> {
  readonly load: (signal: AbortSignal) => Promise<ApiClientResult<TData>>;
  /**
   * Identity of the query. Changing it aborts the in-flight request and
   * discards both the previous representation and any late response.
   */
  readonly requestKey: string;
  /**
   * Successful mutation counter. Changing it refetches and is the pagination
   * reset token for accumulated pages.
   */
  readonly revision: number;
  /**
   * Focus and visibility polling counter. Changing it refetches without
   * resetting accumulated pages.
   */
  readonly refreshEpoch: number;
  /** When false, any in-flight request is aborted and no new one is started. */
  readonly enabled?: boolean;
}

/** Last applied result of {@link useResource}. */
export interface ResourceSnapshot<TData> {
  readonly status: ResourceStatus;
  readonly data: TData | undefined;
  readonly error: ApiClientFailure | undefined;
  readonly refetch: () => void;
  readonly paginationResetKey: string;
}

/** Token that accumulated pages must drop when filters or mutations change. */
export function paginationResetKey(
  requestKey: string,
  revision: number,
): string {
  return `${requestKey}#${revision}`;
}

function readAppliedData<TData>(
  result: Extract<ApiClientResult<TData>, { ok: true }>,
): TData | undefined {
  return result.noContent ? undefined : result.data;
}

/**
 * Loads one resource with abort, stale-response discard and refetch.
 */
export function useResource<TData>(
  options: UseResourceOptions<TData>,
): ResourceSnapshot<TData> {
  const { load, requestKey, revision, refreshEpoch, enabled = true } = options;
  const resetKey = paginationResetKey(requestKey, revision);
  const [manualNonce, setManualNonce] = useState(0);
  const [snapshot, setSnapshot] = useState<
    Pick<ResourceSnapshot<TData>, "status" | "data" | "error"> & {
      readonly resetKey: string;
    }
  >({
    status: "loading",
    data: undefined,
    error: undefined,
    resetKey,
  });

  if (snapshot.resetKey !== resetKey) {
    setSnapshot({
      status: "loading",
      data: undefined,
      error: undefined,
      resetKey,
    });
  }

  const loadRef = useRef(load);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const fetchIdentityRef = useRef(resetKey);

  const refetch = useCallback(() => {
    setManualNonce((current) => current + 1);
  }, []);

  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    const identityChanged = fetchIdentityRef.current !== resetKey;
    fetchIdentityRef.current = resetKey;

    if (!enabled) {
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = generationRef.current + 1;
    generationRef.current = generation;

    void (async () => {
      let result: ApiClientResult<TData>;

      try {
        result = await loadRef.current(controller.signal);
      } catch {
        if (generation !== generationRef.current || controller.signal.aborted) {
          return;
        }

        result = { ok: false, reason: "network" };
      }

      if (generation !== generationRef.current || controller.signal.aborted) {
        return;
      }

      if (!result.ok && result.reason === "aborted") {
        return;
      }

      if (result.ok) {
        setSnapshot({
          status: "ready",
          data: readAppliedData(result),
          error: undefined,
          resetKey,
        });
        return;
      }

      setSnapshot((current) => ({
        status: "error",
        data: identityChanged ? undefined : current.data,
        error: result,
        resetKey,
      }));
    })();

    return () => {
      controller.abort();
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    };
  }, [enabled, resetKey, refreshEpoch, manualNonce]);

  return {
    status: snapshot.status,
    data: snapshot.data,
    error: snapshot.error,
    refetch,
    paginationResetKey: resetKey,
  };
}
