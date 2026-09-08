/**
 * Read snapshot the dashboard services share for one response.
 *
 * A summary, an evolution series and a set of averages are each several
 * aggregations that must observe the same data. The services never open a
 * connection themselves: the caller supplies a runner that starts one snapshot
 * per response and hands the same unit to every read of that response.
 */

import type { AnalyticsResult } from "./analytics-repository";
import type { UnitOfWork } from "./unit-of-work";

/** Opens one consistent read for the work of a dashboard response. */
export interface AnalyticsSnapshotRunner<
  TUnitOfWork extends UnitOfWork = UnitOfWork,
> {
  runInSnapshot<TValue>(
    work: (unit: TUnitOfWork) => AnalyticsResult<TValue>,
  ): AnalyticsResult<TValue>;
}
