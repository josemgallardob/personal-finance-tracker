"use client";

/**
 * Bounded revision channel for financial views under the application shell.
 *
 * This is not a data cache. It only announces that something the owner just
 * confirmed has changed, or that the page has become the place where a
 * scheduled or focus-driven reload should happen. Each view still loads
 * through {@link useResource}. Failed mutations never increment the revision,
 * so a form can keep the values the owner was editing. Successful ones do,
 * which discards accumulated history pages that would otherwise mix two
 * sequences.
 *
 * Background work is a 30-second timer that runs only while the document is
 * visible, plus a refresh when the window recovers focus. Hidden pages stop
 * polling; unmounting clears listeners and the timer. A second interval is
 * never started on top of a live one.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** Interval between visibility-bound background refreshes. */
export const FINANCIAL_DATA_POLL_INTERVAL_MS = 30_000;

/** Revision counters a financial view subscribes to. */
export interface FinancialDataRevisionValue {
  readonly revision: number;
  readonly refreshEpoch: number;
  readonly announceSuccessfulMutation: () => void;
}

/**
 * Browser collaborators of the provider. Tests replace timers, focus and
 * visibility at this boundary; the scheduling rules stay in the provider.
 */
export interface FinancialDataEnvironment {
  addFocusListener(listener: () => void): void;
  removeFocusListener(listener: () => void): void;
  addVisibilityListener(listener: () => void): void;
  removeVisibilityListener(listener: () => void): void;
  isDocumentVisible(): boolean;
  setInterval(handler: () => void, intervalMs: number): number;
  clearInterval(intervalId: number): void;
}

const FinancialDataRevisionContext =
  createContext<FinancialDataRevisionValue | null>(null);

function browserFinancialDataEnvironment(): FinancialDataEnvironment {
  return {
    addFocusListener(listener) {
      window.addEventListener("focus", listener);
    },
    removeFocusListener(listener) {
      window.removeEventListener("focus", listener);
    },
    addVisibilityListener(listener) {
      document.addEventListener("visibilitychange", listener);
    },
    removeVisibilityListener(listener) {
      document.removeEventListener("visibilitychange", listener);
    },
    isDocumentVisible() {
      return document.visibilityState === "visible";
    },
    setInterval(handler, intervalMs) {
      return window.setInterval(handler, intervalMs);
    },
    clearInterval(intervalId) {
      window.clearInterval(intervalId);
    },
  };
}

const defaultFinancialDataEnvironment = browserFinancialDataEnvironment();

export interface FinancialDataProviderProps {
  readonly children: ReactNode;
  readonly environment?: FinancialDataEnvironment;
}

/**
 * Publishes mutation revision and background refresh epochs to descendant
 * financial views.
 */
export function FinancialDataProvider({
  children,
  environment = defaultFinancialDataEnvironment,
}: FinancialDataProviderProps) {
  const [revision, setRevision] = useState(0);
  const [refreshEpoch, setRefreshEpoch] = useState(0);

  const announceSuccessfulMutation = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    let intervalId: number | undefined;

    const bumpRefresh = () => {
      setRefreshEpoch((current) => current + 1);
    };

    const stopPolling = () => {
      if (intervalId === undefined) {
        return;
      }

      environment.clearInterval(intervalId);
      intervalId = undefined;
    };

    const startPolling = () => {
      if (intervalId !== undefined) {
        return;
      }

      intervalId = environment.setInterval(() => {
        if (environment.isDocumentVisible()) {
          bumpRefresh();
        }
      }, FINANCIAL_DATA_POLL_INTERVAL_MS);
    };

    const onFocus = () => {
      if (environment.isDocumentVisible()) {
        bumpRefresh();
      }
    };

    const onVisibility = () => {
      if (environment.isDocumentVisible()) {
        bumpRefresh();
        startPolling();
        return;
      }

      stopPolling();
    };

    environment.addFocusListener(onFocus);
    environment.addVisibilityListener(onVisibility);

    if (environment.isDocumentVisible()) {
      startPolling();
    }

    return () => {
      stopPolling();
      environment.removeFocusListener(onFocus);
      environment.removeVisibilityListener(onVisibility);
    };
  }, [environment]);

  const value = useMemo<FinancialDataRevisionValue>(
    () => ({
      revision,
      refreshEpoch,
      announceSuccessfulMutation,
    }),
    [announceSuccessfulMutation, refreshEpoch, revision],
  );

  return (
    <FinancialDataRevisionContext.Provider value={value}>
      {children}
    </FinancialDataRevisionContext.Provider>
  );
}

/**
 * Reads the shell revision channel.
 *
 * A view outside {@link FinancialDataProvider} cannot tell a successful
 * mutation from a background refresh, so that situation is reported as a
 * programming error rather than a silent stale screen.
 */
export function useFinancialDataRevision(): FinancialDataRevisionValue {
  const value = useContext(FinancialDataRevisionContext);

  if (value === null) {
    throw new Error(
      "useFinancialDataRevision must be used within FinancialDataProvider.",
    );
  }

  return value;
}
