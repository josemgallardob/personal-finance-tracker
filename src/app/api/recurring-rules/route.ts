/**
 * GET and POST /api/recurring-rules.
 *
 * The collection lists active templates or activates an existing movement.
 */

import {
  createActivateRecurringRuleHandler,
  createListRecurringRulesHandler,
} from "../../../modules/recurring/server/recurring-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(request: Request) {
  return createListRecurringRulesHandler()(request);
}

export function POST(request: Request) {
  return createActivateRecurringRuleHandler()(request);
}
