"use client";

import Link from "next/link";

import { cx } from "../../../shared/ui/class-names";
import { EmptyState } from "../../../shared/ui/empty-state";
import {
  HISTORY_ALL_TAB,
  HISTORY_RECURRING_TAB,
  historyCopy,
  type HistoryTab,
} from "./history-copy";

export interface HistoryTabsProps {
  readonly activeTab: HistoryTab;
}

/** Todos and Recurrentes destination tabs of the movements page. */
export function HistoryTabs({ activeTab }: HistoryTabsProps) {
  return (
    <div
      aria-label={historyCopy.tabsLabel}
      className="border-border bg-surface-deep flex w-full max-w-full gap-1 rounded-full border p-1"
      role="tablist"
    >
      <HistoryTabLink
        active={activeTab === HISTORY_ALL_TAB}
        href="/transactions?tab=all"
        label={historyCopy.allTab}
      />
      <HistoryTabLink
        active={activeTab === HISTORY_RECURRING_TAB}
        href="/transactions?tab=recurring"
        label={historyCopy.recurringTab}
      />
    </div>
  );
}

function HistoryTabLink({
  active,
  href,
  label,
}: {
  readonly active: boolean;
  readonly href: string;
  readonly label: string;
}) {
  return (
    <Link
      aria-selected={active}
      className={cx(
        "text-body-sm flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-full px-4 font-semibold",
        "focus-visible:outline-primary-bright focus-visible:outline-2 focus-visible:outline-offset-2",
        active
          ? "bg-surface-hover text-text"
          : "text-text-muted hover:text-text",
      )}
      href={href}
      role="tab"
    >
      {label}
    </Link>
  );
}

/** Placeholder of the Recurrentes tab until that area lands. */
export function RecurringHistoryPlaceholder() {
  return (
    <EmptyState
      description={historyCopy.recurringDescription}
      title={historyCopy.recurringTitle}
    />
  );
}
