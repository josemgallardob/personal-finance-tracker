/**
 * GET /api/preferences.
 *
 * Returns the fixed personal locale, currency, time zone and mode together
 * with the civil day the server clock reports in Europe/Madrid. Workspace
 * identifiers and database paths never travel in the request or the response.
 *
 * Route segment config must be string/number literals: Next.js parses them
 * statically and cannot follow imported constants.
 */

import { createGetPreferencesHandler } from "../../../modules/preferences/server/preference-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(request: Request) {
  return createGetPreferencesHandler()(request);
}
