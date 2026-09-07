/**
 * Validated process configuration for the server runtime.
 *
 * Values are read only when {@link loadAppConfig} is called, so importing this
 * module during `next build` does not require a live environment or a database
 * file. The application keeps a single process and a single on-disk SQLite
 * file; in-memory databases are rejected because they cannot persist.
 */

import "server-only";

import { resolve } from "node:path";

import { APPLICATION_TIME_ZONE } from "../domain/clock";

/** Environment variable that points at the persistent SQLite file. */
export const DATABASE_PATH_ENV = "DATABASE_PATH";

/** Environment variable that holds the private application origin. */
export const APP_URL_ENV = "APP_URL";

/** Environment variable that must match the application civil time zone. */
export const TIME_ZONE_ENV = "TZ";

/** Reason why a configuration value was rejected. */
export type AppConfigErrorCode =
  "required" | "invalidDatabasePath" | "invalidAppUrl" | "invalidTimeZone";

/** Rejected configuration field and the reason why it was rejected. */
export interface AppConfigError {
  readonly field: "databasePath" | "appUrl" | "timeZone";
  readonly code: AppConfigErrorCode;
}

/** Accepted process configuration. */
export interface AppConfig {
  readonly databasePath: string;
  readonly appUrl: string;
  readonly timeZone: typeof APPLICATION_TIME_ZONE;
}

/** Outcome of reading and validating process configuration. */
export type AppConfigResult =
  | { readonly ok: true; readonly value: AppConfig }
  | { readonly ok: false; readonly errors: readonly AppConfigError[] };

/** Environment map accepted by the loader. Tests pass isolated objects. */
export type EnvSource = Record<string, string | undefined>;

const IN_MEMORY_DATABASE_PATHS = new Set(["", ":memory:", "file:memory:"]);

/**
 * Reads configuration from an environment map.
 *
 * The default source is `process.env`. Tests pass an isolated map so they do
 * not patch the loader or the rest of the application.
 */
export function loadAppConfig(
  source: EnvSource = process.env,
): AppConfigResult {
  const errors: AppConfigError[] = [];

  const databasePath = readDatabasePath(source, errors);
  const appUrl = readAppUrl(source, errors);
  const timeZone = readTimeZone(source, errors);

  if (errors.length > 0 || databasePath === null || appUrl === null) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      databasePath,
      appUrl,
      timeZone,
    },
  };
}

function readDatabasePath(
  source: EnvSource,
  errors: AppConfigError[],
): string | null {
  const raw = source[DATABASE_PATH_ENV];

  if (raw === undefined) {
    errors.push({ field: "databasePath", code: "required" });
    return null;
  }

  const trimmed = raw.trim();
  const normalized = trimmed.toLowerCase();

  if (
    IN_MEMORY_DATABASE_PATHS.has(normalized) ||
    normalized.startsWith("file:memory:")
  ) {
    errors.push({
      field: "databasePath",
      code: trimmed === "" ? "required" : "invalidDatabasePath",
    });
    return null;
  }

  return resolve(trimmed);
}

function readAppUrl(
  source: EnvSource,
  errors: AppConfigError[],
): string | null {
  const raw = source[APP_URL_ENV];

  if (raw === undefined) {
    errors.push({ field: "appUrl", code: "required" });
    return null;
  }

  const trimmed = raw.trim();

  if (trimmed === "") {
    errors.push({ field: "appUrl", code: "required" });
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    errors.push({ field: "appUrl", code: "invalidAppUrl" });
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    errors.push({ field: "appUrl", code: "invalidAppUrl" });
    return null;
  }

  if (parsed.username !== "" || parsed.password !== "") {
    errors.push({ field: "appUrl", code: "invalidAppUrl" });
    return null;
  }

  return trimmed;
}

function readTimeZone(
  source: EnvSource,
  errors: AppConfigError[],
): typeof APPLICATION_TIME_ZONE {
  const raw = source[TIME_ZONE_ENV];

  if (raw === undefined || raw.trim() === "") {
    errors.push({ field: "timeZone", code: "required" });
    return APPLICATION_TIME_ZONE;
  }

  if (raw.trim() !== APPLICATION_TIME_ZONE) {
    errors.push({ field: "timeZone", code: "invalidTimeZone" });
  }

  return APPLICATION_TIME_ZONE;
}
