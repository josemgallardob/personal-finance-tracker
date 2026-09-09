/** POST /api/recurring-rules/[id]/preview. */

import { createPreviewCatchUpHandler } from "../../../../../modules/recurring/server/recurring-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function POST(request: Request) {
  return createPreviewCatchUpHandler()(request);
}
