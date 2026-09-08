/**
 * Origin check for state-changing requests.
 *
 * The application has no token-based CSRF defence, so a mutation is accepted
 * only when the browser proves the request came from the application itself.
 * The policy is deliberately closed: a mutation without an `Origin` header is
 * refused exactly like a mutation from a foreign site, because a missing
 * header cannot be distinguished from a stripped one. Reads are exempt: they
 * change nothing and are already scoped to the server-derived workspace.
 */

import "server-only";

import { apiFailure, type ApiFailure } from "./failure";

/** Methods that change state and therefore require a matching origin. */
export const MUTATION_METHODS: readonly string[] = Object.freeze([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

/** Tells whether a method changes state. */
export function isMutationMethod(method: string): boolean {
  return MUTATION_METHODS.includes(method.toUpperCase());
}

function serialisedOrigin(candidate: string): string | null {
  try {
    return new URL(candidate).origin;
  } catch {
    return null;
  }
}

/**
 * Refuses a mutation whose `Origin` is missing, unparseable or foreign.
 *
 * `appUrl` is the configured private application origin. Comparison uses the
 * serialised origin, so a differing path, a default port written explicitly or
 * a trailing slash never turns into a false rejection, while a different
 * scheme, host or port always does.
 */
export function checkRequestOrigin(
  request: Request,
  appUrl: string,
): ApiFailure | null {
  if (!isMutationMethod(request.method)) {
    return null;
  }

  const expected = serialisedOrigin(appUrl);

  if (expected === null) {
    return apiFailure("serviceUnavailable");
  }

  const received = request.headers.get("origin");

  if (received === null) {
    return apiFailure("forbidden");
  }

  if (serialisedOrigin(received) !== expected) {
    return apiFailure("forbidden");
  }

  return null;
}
