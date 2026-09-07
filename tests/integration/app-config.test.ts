import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { APPLICATION_TIME_ZONE } from "../../src/shared/domain/clock";
import { loadAppConfig } from "../../src/shared/server/config";
import { createTemporarySqliteFile, createValidAppEnv } from "./helpers/sqlite";

const temporaryFiles: Array<{ cleanup(): void }> = [];

afterEach(() => {
  while (temporaryFiles.length > 0) {
    temporaryFiles.pop()?.cleanup();
  }
});

function temporarySqliteFile() {
  const file = createTemporarySqliteFile();
  temporaryFiles.push(file);
  return file;
}

describe("loadAppConfig", () => {
  it("accepts a file path, a private http origin and the Madrid time zone", () => {
    const { filePath } = temporarySqliteFile();
    const result = loadAppConfig(createValidAppEnv(filePath));

    expect(result).toEqual({
      ok: true,
      value: {
        databasePath: filePath,
        appUrl: "http://localhost:3000",
        timeZone: APPLICATION_TIME_ZONE,
      },
    });
  });

  it("resolves a relative database path without opening the file", () => {
    const result = loadAppConfig(
      createValidAppEnv("./data/personal-finance.db"),
    );

    expect(result).toEqual({
      ok: true,
      value: {
        databasePath: resolve("./data/personal-finance.db"),
        appUrl: "http://localhost:3000",
        timeZone: APPLICATION_TIME_ZONE,
      },
    });
    expect(existsSync(resolve("./data/personal-finance.db"))).toBe(false);
  });

  it("reports every missing variable instead of stopping at the first", () => {
    const result = loadAppConfig({});

    expect(result).toEqual({
      ok: false,
      errors: [
        { field: "databasePath", code: "required" },
        { field: "appUrl", code: "required" },
        { field: "timeZone", code: "required" },
      ],
    });
  });

  it("rejects blank configuration values", () => {
    const result = loadAppConfig({
      DATABASE_PATH: "   ",
      APP_URL: "\t",
      TZ: "",
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        { field: "databasePath", code: "required" },
        { field: "appUrl", code: "required" },
        { field: "timeZone", code: "required" },
      ],
    });
  });

  it.each([
    [":memory:"],
    [" :memory: "],
    ["file:memory:"],
    ["file:memory:?cache=shared"],
  ])("rejects the non-persistent database path %s", (databasePath) => {
    const result = loadAppConfig(createValidAppEnv(databasePath));

    expect(result).toEqual({
      ok: false,
      errors: [{ field: "databasePath", code: "invalidDatabasePath" }],
    });
  });

  it.each([
    ["localhost:3000"],
    ["/private"],
    ["ftp://localhost:3000"],
    ["http://"],
    ["https://user:secret@localhost:3000"],
  ])("rejects the application URL %s", (appUrl) => {
    const { filePath } = temporarySqliteFile();
    const result = loadAppConfig(
      createValidAppEnv(filePath, { APP_URL: appUrl }),
    );

    expect(result).toEqual({
      ok: false,
      errors: [{ field: "appUrl", code: "invalidAppUrl" }],
    });
  });

  it("accepts an https origin", () => {
    const { filePath } = temporarySqliteFile();
    const result = loadAppConfig(
      createValidAppEnv(filePath, { APP_URL: "https://finance.example" }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.appUrl).toBe("https://finance.example");
    }
  });

  it("rejects a time zone other than Europe/Madrid", () => {
    const { filePath } = temporarySqliteFile();
    const result = loadAppConfig(createValidAppEnv(filePath, { TZ: "UTC" }));

    expect(result).toEqual({
      ok: false,
      errors: [{ field: "timeZone", code: "invalidTimeZone" }],
    });
  });

  it("does not create a database file while validating configuration", () => {
    const { filePath } = temporarySqliteFile();
    const result = loadAppConfig(createValidAppEnv(filePath));

    expect(result.ok).toBe(true);
    expect(existsSync(filePath)).toBe(false);
  });
});
