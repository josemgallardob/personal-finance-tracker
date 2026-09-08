/**
 * Route segment configuration shared by every API endpoint.
 *
 * The handlers open a real SQLite file through `better-sqlite3`, a native
 * addon, so they must run on the Node.js runtime; the Edge runtime cannot load
 * them. They also read personal data that changes on every mutation, so the
 * segment is always dynamic and its responses are never revalidated from a
 * cache. Each route re-exports these constants instead of restating literals
 * that could drift apart between endpoints.
 */

/** Runtime every API route must declare. */
export const API_RUNTIME = "nodejs";

/** Rendering mode every API route must declare. */
export const API_DYNAMIC = "force-dynamic";

/** Revalidation budget every API route must declare. */
export const API_REVALIDATE = 0;
