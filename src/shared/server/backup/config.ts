/**
 * Validated configuration for the encrypted backup command.
 *
 * Every secret stays outside this repository and outside the environment
 * values themselves: the key is read from an owner-installed file, and an
 * attempt to pass key material inline is refused rather than accepted, so a
 * key can never end up in a process listing, a Compose file or a log line.
 */

import "server-only";

import { isAbsolute, resolve } from "node:path";

import { type EnvSource } from "../config";
import {
  resolveDestinationUri,
  type DestinationUriErrorCode,
} from "./destination";

/** Environment variable holding the local directory used to build artifacts. */
export const BACKUP_PATH_ENV = "BACKUP_PATH";

/** Environment variable holding the owner-approved destination URI. */
export const BACKUP_DESTINATION_URI_ENV = "BACKUP_DESTINATION_URI";

/** Environment variable holding the path of the encryption key file. */
export const BACKUP_ENCRYPTION_KEY_FILE_ENV = "BACKUP_ENCRYPTION_KEY_FILE";

/** Environment variable that must never carry key material. */
export const BACKUP_ENCRYPTION_KEY_ENV = "BACKUP_ENCRYPTION_KEY";

/** Reason why a backup configuration value was rejected. */
export type BackupConfigErrorCode =
  | "required"
  | "inlineSecretRejected"
  | "keyFileNotAbsolute"
  | DestinationUriErrorCode;

/** Rejected configuration field and the reason why it was rejected. */
export interface BackupConfigError {
  readonly field: "stagingPath" | "destinationUri" | "encryptionKeyFile";
  readonly code: BackupConfigErrorCode;
}

/** Accepted backup configuration. */
export interface BackupConfig {
  readonly stagingPath: string;
  readonly destinationDirectory: string;
  readonly encryptionKeyFile: string;
}

/** Outcome of reading and validating the backup configuration. */
export type BackupConfigResult =
  | { readonly ok: true; readonly value: BackupConfig }
  | { readonly ok: false; readonly errors: readonly BackupConfigError[] };

/**
 * Reads the backup configuration from an environment map.
 *
 * All problems are collected instead of reported one run at a time, because an
 * operator installing the job should see every missing value at once.
 */
export function loadBackupConfig(
  source: EnvSource = process.env,
): BackupConfigResult {
  const errors: BackupConfigError[] = [];

  if (readValue(source, BACKUP_ENCRYPTION_KEY_ENV) !== null) {
    errors.push({ field: "encryptionKeyFile", code: "inlineSecretRejected" });
  }

  const stagingPath = readValue(source, BACKUP_PATH_ENV);

  if (stagingPath === null) {
    errors.push({ field: "stagingPath", code: "required" });
  }

  const destinationDirectory = readDestinationDirectory(source, errors);
  const encryptionKeyFile = readEncryptionKeyFile(source, errors);

  if (
    errors.length > 0 ||
    stagingPath === null ||
    destinationDirectory === null ||
    encryptionKeyFile === null
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      stagingPath: resolve(stagingPath),
      destinationDirectory,
      encryptionKeyFile,
    },
  };
}

function readDestinationDirectory(
  source: EnvSource,
  errors: BackupConfigError[],
): string | null {
  const raw = readValue(source, BACKUP_DESTINATION_URI_ENV);

  if (raw === null) {
    errors.push({ field: "destinationUri", code: "required" });
    return null;
  }

  const resolved = resolveDestinationUri(raw);

  if (!resolved.ok) {
    errors.push({ field: "destinationUri", code: resolved.error });
    return null;
  }

  return resolved.value.directory;
}

function readEncryptionKeyFile(
  source: EnvSource,
  errors: BackupConfigError[],
): string | null {
  const raw = readValue(source, BACKUP_ENCRYPTION_KEY_FILE_ENV);

  if (raw === null) {
    errors.push({ field: "encryptionKeyFile", code: "required" });
    return null;
  }

  if (!isAbsolute(raw)) {
    errors.push({ field: "encryptionKeyFile", code: "keyFileNotAbsolute" });
    return null;
  }

  return raw;
}

function readValue(source: EnvSource, name: string): string | null {
  const raw = source[name]?.trim();

  return raw === undefined || raw === "" ? null : raw;
}
