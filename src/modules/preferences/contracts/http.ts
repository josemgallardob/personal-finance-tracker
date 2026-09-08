/**
 * Public HTTP schemas of the personal installation preferences.
 *
 * The browser client validates GET /api/preferences against this schema. The
 * module has no workspace, database or process imports.
 */

import { z } from "zod";

import { parseLocalDate } from "../../../shared/domain/dates";
import {
  PERSONAL_APPLICATION_MODE,
  PREFERENCES_CURRENCY,
  PREFERENCES_LOCALE,
  PREFERENCES_TIME_ZONE,
  type PreferencesDto,
} from "./preferences";

const localDateSchema = z.string().transform((value, context) => {
  const parsed = parseLocalDate(value);

  if (!parsed.ok) {
    context.addIssue({ code: "custom", message: parsed.error });
    return z.NEVER;
  }

  return parsed.value;
});

/** Preferences as the API returns them. */
export const preferencesDtoSchema: z.ZodType<PreferencesDto> = z.strictObject({
  locale: z.literal(PREFERENCES_LOCALE),
  currency: z.literal(PREFERENCES_CURRENCY),
  timeZone: z.literal(PREFERENCES_TIME_ZONE),
  mode: z.literal(PERSONAL_APPLICATION_MODE),
  today: localDateSchema,
});
