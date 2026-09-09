"use client";

/**
 * Decorative frame of a dashboard drawing.
 *
 * The drawing is hidden from assistive technology on purpose: a chart in this
 * dashboard never carries a value of its own, and the section that owns it
 * always publishes the same figures as a table. Announcing the SVG as well
 * would repeat every number without adding meaning, and would read as a
 * description of shapes rather than of money.
 */

import type { ReactNode } from "react";

export interface ChartFigureProps {
  readonly children: ReactNode;
  /** Name of the drawing, so an end-to-end test can address it. */
  readonly name: string;
}

export function ChartFigure({ children, name }: ChartFigureProps) {
  return (
    <div
      aria-hidden="true"
      className="h-[220px] w-full max-w-full min-w-0"
      data-chart={name}
    >
      {children}
    </div>
  );
}
