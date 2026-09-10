import { describe, expect, it } from "vitest";

import { parseLocalDate } from "../../../shared/domain/dates";
import {
  PREFERENCES_CURRENCY,
  PREFERENCES_LOCALE,
  PREFERENCES_TIME_ZONE,
  toPreferencesDto,
} from "./preferences";

function today() {
  const parsed = parseLocalDate("2026-01-01");

  if (!parsed.ok) {
    throw new Error("Expected a valid civil date");
  }

  return parsed.value;
}

describe("toPreferencesDto", () => {
  it("exposes the fixed personal configuration and the server civil day", () => {
    const dto = toPreferencesDto({
      locale: PREFERENCES_LOCALE,
      currency: PREFERENCES_CURRENCY,
      timeZone: PREFERENCES_TIME_ZONE,
      today: today(),
    });

    expect(dto).toEqual({
      locale: "es-ES",
      currency: "EUR",
      timeZone: "Europe/Madrid",
      today: "2026-01-01",
    });
    expect(Object.keys(dto).sort()).toEqual([
      "currency",
      "locale",
      "timeZone",
      "today",
    ]);
  });

  it("hides workspace, storage and process fields", () => {
    const dto = toPreferencesDto({
      locale: PREFERENCES_LOCALE,
      currency: PREFERENCES_CURRENCY,
      timeZone: PREFERENCES_TIME_ZONE,
      today: today(),
    });

    expect(dto).not.toHaveProperty("workspaceId");
    expect(dto).not.toHaveProperty("createdAt");
    expect(dto).not.toHaveProperty("updatedAt");
    expect(dto).not.toHaveProperty("databasePath");
    expect(dto).not.toHaveProperty("filePath");
    expect(dto).not.toHaveProperty("appUrl");
  });
});
