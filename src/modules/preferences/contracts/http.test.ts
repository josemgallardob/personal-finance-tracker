import { describe, expect, it } from "vitest";

import { preferencesDtoSchema } from "./http";

const preferences = {
  locale: "es-ES",
  currency: "EUR",
  timeZone: "Europe/Madrid",
  mode: "personal",
  today: "2026-09-08",
};

describe("preferences HTTP contract", () => {
  it("accepts the documented personal and demo configurations", () => {
    expect(preferencesDtoSchema.parse(preferences)).toEqual(preferences);
    expect(
      preferencesDtoSchema.parse({ ...preferences, mode: "demo" }),
    ).toEqual({ ...preferences, mode: "demo" });
  });

  it("refuses another locale, mode, a leaked workspace or an invalid day", () => {
    expect(
      preferencesDtoSchema.safeParse({ ...preferences, locale: "en-GB" })
        .success,
    ).toBe(false);
    expect(
      preferencesDtoSchema.safeParse({ ...preferences, mode: "unknown" })
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
