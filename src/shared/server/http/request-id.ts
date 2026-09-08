/**
 * Request correlation identifier.
 *
 * A client may propose an identifier so a browser log line and a server log
 * line can be matched. The proposal is untrusted text that ends up in a log
 * file and in a response body, so it is accepted only when it already looks
 * like an identifier. Anything else is replaced by a server-generated value
 * instead of being trimmed or escaped, because a partially repaired attacker
 * string is still attacker input.
 */

import "server-only";

import { randomUUID } from "node:crypto";

import { REQUEST_ID_HEADER } from "../../contracts/http";

// The header name is part of the wire contract and is read back by the browser
// client, which cannot import this server-only module. It is defined once in
// the shared transport contract and re-exported here for the route pipeline.
export { REQUEST_ID_HEADER };

/** Longest accepted client-proposed identifier, in characters. */
export const MAX_REQUEST_ID_LENGTH = 64;

const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Tells whether a client-proposed identifier may be reused as is.
 *
 * Only unreserved URL characters are allowed, so the value cannot smuggle a
 * newline into a log line, a control character into a terminal or a quote into
 * a JSON body.
 */
export function isSafeRequestId(candidate: string): boolean {
  return (
    candidate.length > 0 &&
    candidate.length <= MAX_REQUEST_ID_LENGTH &&
    SAFE_REQUEST_ID.test(candidate)
  );
}

/**
 * Returns the correlation identifier of a request.
 *
 * The header is honoured when it is safe; otherwise a fresh UUID is used.
 */
export function resolveRequestId(
  headers: Headers,
  createId: () => string = randomUUID,
): string {
  const proposed = headers.get(REQUEST_ID_HEADER);

  if (proposed !== null && isSafeRequestId(proposed)) {
    return proposed;
  }

  return createId();
}
