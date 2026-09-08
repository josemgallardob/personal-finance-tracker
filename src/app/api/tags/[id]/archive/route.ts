/**
 * POST /api/tags/[id]/archive.
 *
 * Archives a tag so it stays readable in history. There is no unarchive in
 * this MVP. An active recurrence that still uses the tag is refused.
 *
 * Route segment config must be string/number literals: Next.js parses them
 * statically and cannot follow imported constants.
 */

import { createArchiveTagHandler } from "../../../../../modules/classification/server/tag-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function POST(request: Request) {
  return createArchiveTagHandler()(request);
}
