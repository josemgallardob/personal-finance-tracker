/**
 * POST /api/demo/reset.
 *
 * Replaces the reproducible fictitious dataset only after a demo-mode request
 * explicitly confirms the destructive action.
 */

import { createPostDemoResetHandler } from "../../../../modules/preferences/server/demo-reset-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function POST(request: Request) {
  return createPostDemoResetHandler()(request);
}
