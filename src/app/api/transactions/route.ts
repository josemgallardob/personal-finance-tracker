/**
 * GET and POST /api/transactions.
 *
 * The collection lists the implicit personal workspace and creates a movement.
 * Workspace identifiers never travel in the request. Duplication is this POST
 * after a GET of an existing item, not a third collection method.
 *
 * Route segment config must be string/number literals: Next.js parses them
 * statically and cannot follow imported constants.
 */

import {
  createCreateTransactionHandler,
  createListTransactionsHandler,
} from "../../../modules/transactions/server/transaction-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(request: Request) {
  return createListTransactionsHandler()(request);
}

export function POST(request: Request) {
  return createCreateTransactionHandler()(request);
}
