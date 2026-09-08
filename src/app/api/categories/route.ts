/**
 * GET and POST /api/categories.
 *
 * The collection lists the implicit personal workspace and creates a category
 * of a fixed type. Workspace identifiers never travel in the request.
 *
 * Route segment config must be string/number literals: Next.js parses them
 * statically and cannot follow imported constants.
 */

import {
  createCreateCategoryHandler,
  createListCategoriesHandler,
} from "../../../modules/classification/server/category-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(request: Request) {
  return createListCategoriesHandler()(request);
}

export function POST(request: Request) {
  return createCreateCategoryHandler()(request);
}
