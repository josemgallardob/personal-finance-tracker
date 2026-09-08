/**
 * GET, PUT and DELETE /api/transactions/[id].
 *
 * The item reads, replaces or removes one movement of the implicit workspace.
 * A successful deletion answers 204 with no body. There is no duplication
 * method here: a copy is a GET of this item followed by POST of a new body.
 *
 * Route segment config must be string/number literals: Next.js parses them
 * statically and cannot follow imported constants.
 */

import {
  createDeleteTransactionHandler,
  createGetTransactionHandler,
  createUpdateTransactionHandler,
} from "../../../../modules/transactions/server/transaction-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(request: Request) {
  return createGetTransactionHandler()(request);
}

export function PUT(request: Request) {
  return createUpdateTransactionHandler()(request);
}

export function DELETE(request: Request) {
  return createDeleteTransactionHandler()(request);
}
