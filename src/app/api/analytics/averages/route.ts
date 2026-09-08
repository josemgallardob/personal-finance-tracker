/**
 * GET /api/analytics/averages.
 *
 * Returns the monthly averages over the window of closed natural months, each
 * one as its exact sum in minor units and its month divisor. The window is a
 * rule of the calendar and of the stored history, so the endpoint accepts no
 * parameter at all.
 *
 * Route segment config must be string/number literals: Next.js parses them
 * statically and cannot follow imported constants.
 */

import { createGetAnalyticsAveragesHandler } from "../../../../modules/analytics/server/analytics-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(request: Request) {
  return createGetAnalyticsAveragesHandler()(request);
}
