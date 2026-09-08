/**
 * GET and POST /api/tags.
 *
 * The collection lists the implicit personal workspace and creates a tag.
 * Workspace identifiers never travel in the request.
 *
 * Route segment config must be string/number literals: Next.js parses them
 * statically and cannot follow imported constants.
 */

import {
  createCreateTagHandler,
  createListTagsHandler,
} from "../../../modules/classification/server/tag-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(request: Request) {
  return createListTagsHandler()(request);
}

export function POST(request: Request) {
  return createCreateTagHandler()(request);
}
