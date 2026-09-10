/**
 * Public preference representation of the HTTP API.
 *
 * The DTO is the only shape a client may see: the fixed personal locale,
 * currency and time zone, and the civil day the server clock reports in
 * Madrid. A response never carries a workspace
 * identifier, a database path, a cookie, or any other process secret.
 */

import type { LocalDate } from "../../../shared/domain/dates";

/** Locale every personal installation uses. */
export const PREFERENCES_LOCALE = "es-ES";

/** Currency every personal installation uses. */
export const PREFERENCES_CURRENCY = "EUR";

/** Civil time zone every personal installation uses. */
export const PREFERENCES_TIME_ZONE = "Europe/Madrid";

/** Preferences as the API returns them. */
export interface PreferencesDto {
  readonly locale: typeof PREFERENCES_LOCALE;
  readonly currency: typeof PREFERENCES_CURRENCY;
  readonly timeZone: typeof PREFERENCES_TIME_ZONE;
  readonly today: LocalDate;
}

/** Values the mapper copies into the documented HTTP representation. */
export interface PreferencesSource {
  readonly locale: typeof PREFERENCES_LOCALE;
  readonly currency: typeof PREFERENCES_CURRENCY;
  readonly timeZone: typeof PREFERENCES_TIME_ZONE;
  readonly today: LocalDate;
}

/** Maps server-owned preference values to the documented HTTP representation. */
export function toPreferencesDto(source: PreferencesSource): PreferencesDto {
  return {
    locale: source.locale,
    currency: source.currency,
    timeZone: source.timeZone,
    today: source.today,
  };
}
