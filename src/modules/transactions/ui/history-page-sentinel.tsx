"use client";

/**
 * Visible sentinel that asks for the next history page when it enters the
 * viewport. Cargar más remains the accessible fallback when this observer is
 * missing or does not fire.
 */

import { useEffect, useRef, useState } from "react";

export interface HistoryPageSentinelProps {
  readonly enabled: boolean;
  readonly onIntersect: () => void;
}

/** Observes the bottom of the history list without owning pagination state. */
export function HistoryPageSentinel({
  enabled,
  onIntersect,
}: HistoryPageSentinelProps) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const onIntersectRef = useRef(onIntersect);

  useEffect(() => {
    onIntersectRef.current = onIntersect;
  });

  useEffect(() => {
    if (
      !enabled ||
      node === null ||
      typeof IntersectionObserver !== "function"
    ) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        onIntersectRef.current();
      }
    });

    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [enabled, node]);

  if (!enabled) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="h-px w-full"
      data-history-page-sentinel=""
      data-testid="history-sentinel"
      ref={setNode}
    />
  );
}
