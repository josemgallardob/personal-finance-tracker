import { describe, expect, it } from "vitest";

import { preferencesDtoSchema } from "./http";

const preferences = {
  locale: "es-ES",
  currency: "EUR",
  timeZone: "Europe/Madrid",
  today: "2026-09-08",
};

describe("preferences HTTP contract", () => {
  it("accepts the documented private configuration", () => {
    expect(preferencesDtoSchema.parse(preferences)).toEqual(preferences);
  });

  it("refuses another locale, a leaked workspace or an invalid day", () => {
    expect(
      preferencesDtoSchema.safeParse({ ...preferences, locale: "en-GB" })
        .success,
    ).toBe(false);
    expect(
      preferencesDtoSchema.safeParse({ ...preferences, workspaceId: "w-1" })
        .success,
    ).toBe(false);
    expect(
      preferencesDtoSchema.safeParse({ ...preferences, today: "06-09-2026" })
        .success,
    ).toBe(false);
  });
});
