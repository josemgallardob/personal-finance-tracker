/** GET and PUT /api/recurring-rules/[id]. */

import {
  createGetRecurringRuleHandler,
  createUpdateRecurringRuleHandler,
} from "../../../../modules/recurring/server/recurring-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(request: Request) {
  return createGetRecurringRuleHandler()(request);
}

export function PUT(request: Request) {
  return createUpdateRecurringRuleHandler()(request);
}
