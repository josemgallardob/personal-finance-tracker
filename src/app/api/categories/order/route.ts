/**
 * PUT /api/categories/order.
 *
 * The body is the complete, duplicate-free list of active identifiers of one
 * type. An incomplete list is refused and the previous order is kept.
 *
 * Route segment config must be string/number literals: Next.js parses them
 * statically and cannot follow imported constants.
 */

import { createReorderCategoriesHandler } from "../../../../modules/classification/server/category-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function PUT(request: Request) {
  return createReorderCategoriesHandler()(request);
}
