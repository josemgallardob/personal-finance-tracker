/**
 * POST /api/categories/[id]/archive.
 *
 * Archives a category so it stays readable in history. There is no unarchive
 * in this MVP, and active recurrences are not inspected here (REC-04).
 *
 * Route segment config must be string/number literals: Next.js parses them
 * statically and cannot follow imported constants.
 */

import { createArchiveCategoryHandler } from "../../../../../modules/classification/server/category-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function POST(request: Request) {
  return createArchiveCategoryHandler()(request);
}
