/**
 * POST /api/demo/session.
 *
 * Changes only the server-validated session selection. It does not access
 * either SQLite file.
 */

import { createPostDemoSessionHandler } from "../../../../modules/preferences/server/demo-session-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function POST(request: Request) {
  return createPostDemoSessionHandler()(request);
}
