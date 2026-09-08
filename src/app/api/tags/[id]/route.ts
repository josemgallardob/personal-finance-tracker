/**
 * PATCH /api/tags/[id].
 *
 * Renames a tag of the implicit workspace. Associations with existing movements
 * are kept; uniqueness of the normalized name still applies.
 *
 * Route segment config must be string/number literals: Next.js parses them
 * statically and cannot follow imported constants.
 */

import { createRenameTagHandler } from "../../../../modules/classification/server/tag-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function PATCH(request: Request) {
  return createRenameTagHandler()(request);
}
