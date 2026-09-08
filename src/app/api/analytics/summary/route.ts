/**
 * GET /api/analytics/summary.
 *
 * Aggregates the selected period of the implicit personal workspace: the
 * totals, the equivalent previous interval, the breakdowns by category and by
 * tag, and the recent movements. The period travels in the query string; the
 * workspace never does.
 *
 * Route segment config must be string/number literals: Next.js parses them
 * statically and cannot follow imported constants.
 */

import { createGetAnalyticsSummaryHandler } from "../../../../modules/analytics/server/analytics-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(request: Request) {
  return createGetAnalyticsSummaryHandler()(request);
}
