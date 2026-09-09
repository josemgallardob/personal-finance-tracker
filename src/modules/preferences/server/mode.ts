/**
 * Request-scoped application mode selection.
 *
 * The cookie carries a closed-set mode only. Database paths and workspace
 * identifiers remain process- and database-owned values respectively.
 */

import "server-only";

import {
  DEMO_APPLICATION_MODE,
  PERSONAL_APPLICATION_MODE,
  type ApplicationMode,
} from "../contracts";
import {
  apiFailure,
  accepted,
  refused,
  type ApiResult,
} from "../../../shared/server/http/failure";

/** Name of the session cookie that carries the selected application mode. */
export const APPLICATION_MODE_COOKIE = "mode";

/** Attributes applied to the session-scoped application mode cookie. */
export interface ApplicationModeCookieOptions {
  readonly secure: boolean;
}

/** Resolves the mode cookie or defaults a new session to personal data. */
export function resolveApplicationMode(
  cookieHeader: string | null,
): ApiResult<ApplicationMode> {
  if (cookieHeader === null || cookieHeader.trim() === "") {
    return accepted(PERSONAL_APPLICATION_MODE);
  }

  const values = readCookieValues(cookieHeader, APPLICATION_MODE_COOKIE);

  if (values.length === 0) {
    return accepted(PERSONAL_APPLICATION_MODE);
  }

  if (values.length !== 1) {
    return invalidModeCookie();
  }

  switch (values[0]) {
    case PERSONAL_APPLICATION_MODE:
      return accepted(PERSONAL_APPLICATION_MODE);
    case DEMO_APPLICATION_MODE:
      return accepted(DEMO_APPLICATION_MODE);
    default:
      return invalidModeCookie();
  }
}

/** Serializes the closed-set mode selection as a session cookie. */
export function serializeApplicationModeCookie(
  mode: ApplicationMode,
  options: ApplicationModeCookieOptions,
): string {
  return [
    `${APPLICATION_MODE_COOKIE}=${mode}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(options.secure ? ["Secure"] : []),
  ].join("; ");
}

function readCookieValues(header: string, expectedName: string): string[] {
  const values: string[] = [];

  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const name = segment.slice(0, separator).trim();

    if (name !== expectedName) {
      continue;
    }

    try {
      values.push(decodeURIComponent(segment.slice(separator + 1).trim()));
    } catch {
      return [""];
    }
  }

  return values;
}

function invalidModeCookie(): ApiResult<ApplicationMode> {
  return refused(
    apiFailure("validationFailed", [
      { field: `cookie.${APPLICATION_MODE_COOKIE}`, code: "invalidValue" },
    ]),
  );
}
