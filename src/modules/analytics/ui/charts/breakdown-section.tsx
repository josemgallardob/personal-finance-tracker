"use client";

/**
 * One expense breakdown: its horizontal bars and the table that replaces them.
 *
 * Both breakdowns of the dashboard share this frame because they differ in
 * meaning, not in shape. The category groups are disjoint and add up to the
 * expense of the period, so each row may state its share of it. The tag groups
 * overlap — a movement with two tags counts whole in both — so their rows carry
 * amounts and no percentage, and the section explains why above the figures.
 *
 * An archived classification that has an amount in the window keeps its row and
 * is named as archived: its amount already counts in the cards, so hiding it
 * would make the breakdown disagree with them.
 */

import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "../../../../shared/ui/button";
import { EmptyState } from "../../../../shared/ui/empty-state";
import { dashboardCopy } from "../dashboard-copy";
import { ChartFigure } from "./chart-figure";
import type { BreakdownBar } from "./chart-series";
import { LazyBreakdownBarsVisual } from "./lazy-visuals";

export interface BreakdownSectionProps {
  readonly bars: readonly BreakdownBar[];
  readonly caption: string;
  readonly chartName: string;
  readonly emptyDescription: string;
  readonly emptyTitle: string;
  readonly labelColumn: string;
  /** Explanation shown above the figures, used by the overlapping tag groups. */
  readonly note?: string;
  /** Selector of the drawn series, shown next to the title of the block. */
  readonly selector?: ReactNode;
  /**
   * True when the window has figures but the current selection hides all of
   * them, which is a different situation from a window without figures.
   */
  readonly selectionEmpty?: boolean;
  /** Restores every active series of the dimension. */
  readonly onSelectAll?: () => void;
  /** True when the groups are disjoint and may state a share of the expense. */
  readonly showShare: boolean;
  /** Heading level of the block, so a nested block does not skip one. */
  readonly titleLevel?: 2 | 3;
  readonly titleId: string;
  readonly title: string;
}

export function BreakdownSection({
  bars,
  caption,
  chartName,
  emptyDescription,
  emptyTitle,
  labelColumn,
  note,
  onSelectAll,
  selectionEmpty = false,
  selector,
  showShare,
  title,
  titleId,
  titleLevel = 2,
}: BreakdownSectionProps) {
  const Heading = titleLevel === 2 ? "h2" : "h3";
  return (
    <section
      aria-labelledby={titleId}
      className="flex w-full max-w-full min-w-0 flex-col gap-3"
    >
      <div className="flex w-full max-w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Heading className="text-heading-sm text-text font-medium" id={titleId}>
          {title}
        </Heading>
        {selector ? <div className="sm:w-auto">{selector}</div> : null}
      </div>
      {note ? (
        <p className="text-body-sm text-text-muted max-w-2xl">{note}</p>
      ) : null}
      {bars.length === 0 && selectionEmpty ? (
        <EmptyState
          action={
            onSelectAll ? (
              <Button onClick={onSelectAll} variant="secondary">
                {dashboardCopy.selectAll}
              </Button>
            ) : undefined
          }
          description={dashboardCopy.selectionEmptyDescription}
          title={dashboardCopy.selectionEmptyTitle}
        />
      ) : null}
      {bars.length === 0 && !selectionEmpty ? (
        <EmptyState description={emptyDescription} title={emptyTitle} />
      ) : null}
      {bars.length === 0 ? null : (
        <>
          <ChartFigure name={chartName}>
            <LazyBreakdownBarsVisual bars={bars} />
          </ChartFigure>
          <div className="w-full max-w-full min-w-0 overflow-x-auto">
            <table className="w-full max-w-full min-w-0 border-collapse text-left">
              <caption className="text-caption text-text-muted pb-2 text-left">
                {caption}
              </caption>
              <thead>
                <tr className="border-border text-caption text-text-muted border-b">
                  <th className="px-3 py-2 font-medium" scope="col">
                    {labelColumn}
                  </th>
                  <th className="px-3 py-2 text-right font-medium" scope="col">
                    {dashboardCopy.amountColumn}
                  </th>
                  <th className="px-3 py-2 text-right font-medium" scope="col">
                    {dashboardCopy.countColumn}
                  </th>
                  {showShare ? (
                    <th
                      className="px-3 py-2 text-right font-medium"
                      scope="col"
                    >
                      {dashboardCopy.shareColumn}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {bars.map((bar) => (
                  <tr
                    className="border-border border-b last:border-b-0"
                    key={bar.id}
                  >
                    <th
                      className="text-body-sm text-text px-3 py-3 font-medium break-words"
                      scope="row"
                    >
                      <BreakdownLabel bar={bar} />
                      <BreakdownTrack widthPercent={bar.widthPercent} />
                    </th>
                    <td className="text-body-sm text-expense px-3 py-3 text-right font-semibold tabular-nums">
                      {bar.amountLabel}
                    </td>
                    <td className="text-body-sm text-text-muted px-3 py-3 text-right tabular-nums">
                      {bar.countLabel}
                    </td>
                    {showShare ? (
                      <td className="text-body-sm text-text-muted px-3 py-3 text-right tabular-nums">
                        {bar.shareLabel ?? ""}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function BreakdownLabel({ bar }: { readonly bar: BreakdownBar }) {
  const label = bar.archived ? dashboardCopy.archivedOf(bar.label) : bar.label;

  if (bar.href === null) {
    return <span className="break-words">{label}</span>;
  }

  return (
    <Link
      className="focus-visible:outline-primary-bright break-words underline focus-visible:outline-2 focus-visible:outline-offset-2"
      href={bar.href}
    >
      {label}
    </Link>
  );
}

/**
 * Repeats the length of a bar next to its own row.
 *
 * It is decorative: the row already states the exact amount, so the track adds
 * the comparison the chart gives sighted readers without adding a value.
 */
function BreakdownTrack({ widthPercent }: { readonly widthPercent: number }) {
  return (
    <span
      aria-hidden="true"
      className="bg-surface-hover mt-2 block h-1.5 w-full max-w-40 rounded-full"
    >
      <span
        className="bg-expense block h-1.5 rounded-full"
        style={{ width: `${widthPercent}%` }}
      />
    </span>
  );
}
