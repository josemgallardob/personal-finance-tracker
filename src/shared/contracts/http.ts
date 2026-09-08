/**
 * Transport-level constants of the API, shared by the server and the browser.
 *
 * {@link ../contracts/api} describes what a response body means; this module
 * describes how a request reaches the API at all: which origin-relative prefix
 * every endpoint lives under, which media type carries a payload and which
 * header correlates a browser call with its single server log line.
 *
 * These values are part of the wire contract, so they must have exactly one
 * definition. The server writes them into responses and the client reads them
 * back; a second copy on the client would let the two drift apart silently.
 * The module is free of Node, Next and DOM imports for that reason.
 */

/** Methods the API exposes. No endpoint answers `PATCH` or `HEAD`. */
export type ApiMethod = "GET" | "POST" | "PUT" | "DELETE";

/**
 * Origin-relative prefix every endpoint lives under.
 *
 * The browser client only ever builds relative URLs below this prefix, so a
 * mistyped path cannot turn a request for private financial data into a call
 * to a foreign origin.
 */
export const API_BASE_PATH = "/api";

/** Media type of every request and response payload of the API. */
export const API_JSON_MEDIA_TYPE = "application/json";

/** Header a client uses to propose a correlation identifier. */
export const REQUEST_ID_HEADER = "x-request-id";
