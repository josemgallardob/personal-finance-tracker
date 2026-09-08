/**
 * GET /api/analytics/evolution.
 *
 * Returns the monthly income and expense series of the current month plus up
 * to eleven earlier months, with the months of the window materialised at zero.
 * The series is independent of the period selected on the dashboard, so the
 * endpoint accepts no parameter at all.
 *
 * Route segment config must be string/number literals: Next.js parses them
 * statically and cannot follow imported constants.
 */

import { createGetAnalyticsEvolutionHandler } from "../../../../modules/analytics/server/analytics-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(request: Request) {
  return createGetAnalyticsEvolutionHandler()(request);
}
