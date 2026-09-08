/**
 * PATCH /api/categories/[id].
 *
 * Renames a category of the implicit workspace. The type cannot be changed:
 * a body that carries one is refused as an unknown field.
 *
 * Route segment config must be string/number literals: Next.js parses them
 * statically and cannot follow imported constants.
 */

import { createRenameCategoryHandler } from "../../../../modules/classification/server/category-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function PATCH(request: Request) {
  return createRenameCategoryHandler()(request);
}
