/**
 * Runtime gate for the Playwright maintenance harness.
 *
 * The page is compiled into the production build so Chromium can open the
 * real edit, duplicate and delete dialogs before the history route exists.
 * The gate stays off unless the dedicated E2E process sets the documented
 * flag, so a private server never exposes the harness by default.
 */

export const E2E_HARNESS_ENV = "E2E_HARNESS";

export const E2E_HARNESS_ENABLED_VALUE = "1";

export function isE2eMaintenanceHarnessEnabled(
  source: Record<string, string | undefined> = process.env,
): boolean {
  return source[E2E_HARNESS_ENV] === E2E_HARNESS_ENABLED_VALUE;
}
