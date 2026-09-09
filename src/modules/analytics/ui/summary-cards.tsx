"use client";

/**
 * Income, expense and net cards of the selected period.
 *
 * Each card names its concept, shows the exact EUR figure and the change
 * against the equivalent previous interval, and links to the history that
 * produces it with the very filter the server attached to the figure. Colour
 * only reinforces a meaning that the heading and the sign already carry, and a
 * balance of exactly zero stays neutral.
 */

import Link from "next/link";

import { cx } from "../../../shared/ui/class-names";
import type {
  ComparedPeriodTotalsDto,
  ComparisonDeltaDto,
  SummaryDrillDownsDto,
} from "../contracts/summary";
import type { DrillDownDto } from "../contracts/drill-down";
import { dashboardCopy } from "./dashboard-copy";
import {
  comparisonChangeLabel,
  drillDownHistoryHref,
  netTone,
  signedSummaryAmount,
  summaryAmount,
  summaryToneClassName,
  type SummaryTone,
} from "./summary-presentation";

export interface SummaryCardsProps {
  readonly drillDowns: SummaryDrillDownsDto;
  readonly totals: ComparedPeriodTotalsDto;
}

/** The three global figures of the period, in the documented order. */
export function SummaryCards({ drillDowns, totals }: SummaryCardsProps) {
  const { current } = totals;

  return (
    <ul
      aria-label={dashboardCopy.summaryLabel}
      className="grid w-full max-w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-3"
    >
      <SummaryCard
        amount={summaryAmount(current.incomeMinor)}
        card="income"
        count={current.incomeCount}
        delta={totals.income}
        drillDown={drillDowns.income}
        hint={dashboardCopy.incomeHint}
        linkLabel={dashboardCopy.viewIncome}
        title={dashboardCopy.income}
        tone="income"
      />
      <SummaryCard
        amount={summaryAmount(current.expenseMinor)}
        card="expense"
        count={current.expenseCount}
        delta={totals.expense}
        drillDown={drillDowns.expense}
        hint={dashboardCopy.expenseHint}
        linkLabel={dashboardCopy.viewExpense}
        title={dashboardCopy.expense}
        tone="expense"
      />
      <SummaryCard
        amount={signedSummaryAmount(current.netMinor)}
        card="net"
        count={current.incomeCount + current.expenseCount}
        delta={totals.net}
        drillDown={drillDowns.net}
        hint={dashboardCopy.netHint}
        linkLabel={dashboardCopy.viewNet}
        title={dashboardCopy.net}
        tone={netTone(current.netMinor)}
      />
    </ul>
  );
}

function SummaryCard({
  amount,
  card,
  count,
  delta,
  drillDown,
  hint,
  linkLabel,
  title,
  tone,
}: {
  readonly amount: string;
  /** Figure this card carries, so an end-to-end test can address it. */
  readonly card: "income" | "expense" | "net";
  readonly count: number;
  readonly delta: ComparisonDeltaDto;
  readonly drillDown: DrillDownDto;
  readonly hint: string;
  readonly linkLabel: string;
  readonly title: string;
  readonly tone: SummaryTone;
}) {
  const href = drillDownHistoryHref(drillDown);

  return (
    <li
      className="border-border bg-surface-raised flex w-full max-w-full min-w-0 flex-col gap-2 rounded-[20px] border p-4 sm:p-6"
      data-summary-card={card}
    >
      <h3 className="text-body-sm text-text-muted font-semibold">{title}</h3>
      <p
        className={cx(
          "text-heading font-medium tabular-nums",
          summaryToneClassName(tone),
        )}
        data-summary-amount=""
      >
        {amount}
      </p>
      <p className="text-caption text-text-muted">{hint}</p>
      <p className="text-body-sm text-text-muted">
        {dashboardCopy.movementCount(count)}
      </p>
      <p className="text-body-sm text-text">
        {`${dashboardCopy.changeLabel}: ${comparisonChangeLabel(delta)}`}
      </p>
      {href === null ? null : (
        <Link
          className="text-body-sm text-text focus-visible:outline-primary-bright mt-auto inline-flex min-h-11 items-center font-semibold underline focus-visible:outline-2 focus-visible:outline-offset-2"
          href={href}
        >
          {linkLabel}
        </Link>
      )}
    </li>
  );
}
