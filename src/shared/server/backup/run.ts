/**
 * Ordered backup run: snapshot, encrypt, upload, then prune.
 *
 * The order is the safety property. Retention runs only after the destination
 * has committed the new artifact, so a failed upload leaves every existing
 * valid backup in place, and the command exits non-zero instead of reporting a
 * protected day that does not exist. The plaintext snapshot lives only inside
 * a private staging directory that is removed whether the run succeeds or
 * fails. Reports carry step names, closed reason codes and counts: never a
 * database path, an amount, a concept or key material.
 */

import "server-only";

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import { loadAppConfig, type EnvSource } from "../config";
import { formatArtifactName } from "./artifact";
import { loadBackupConfig, type BackupConfigError } from "./config";
import {
  createLocalDirectoryDestination,
  type BackupDestination,
} from "./destination";
import { encryptFile, readEncryptionKey } from "./encryption";
import {
  DEFAULT_RETENTION_LIMITS,
  planRetention,
  type RetentionLimits,
} from "./retention";
import { createConsistentSnapshot } from "./snapshot";

/** Prefix of the private staging directory created for one run. */
const STAGING_PREFIX = "backup-";

/** Permissions applied to the staging directory tree. */
const OWNER_ONLY_DIRECTORY_MODE = 0o700;

/** Step that produced a failure. */
export type BackupStepName =
  | "configuration"
  | "encryptionKey"
  | "staging"
  | "snapshot"
  | "encryption"
  | "upload"
  | "retention";

/** Failed run, identified by step and closed reason code. */
export interface BackupFailure {
  readonly step: BackupStepName;
  readonly reason: string;
  readonly configErrors?: readonly BackupConfigError[];
}

/** Result of a successful run. */
export interface BackupReport {
  readonly artifactName: string;
  readonly byteLength: number;
  readonly keptArtifacts: number;
  readonly removedArtifacts: number;
}

/** Outcome of the whole run. */
export type BackupRunResult =
  | { readonly ok: true; readonly value: BackupReport }
  | { readonly ok: false; readonly error: BackupFailure };

/** Options accepted by {@link runBackup}. Tests pass isolated values. */
export interface BackupRunOptions {
  readonly source?: EnvSource;
  readonly now?: Date;
  readonly limits?: RetentionLimits;
  readonly createDestination?: (directory: string) => BackupDestination;
}

/**
 * Runs one complete backup cycle and reports what it did.
 *
 * The caller decides the process exit code from the returned result; nothing
 * here calls `process.exit`, so the sequence stays testable end to end against
 * a temporary destination.
 */
export async function runBackup(
  options: BackupRunOptions = {},
): Promise<BackupRunResult> {
  const source = options.source ?? process.env;
  const appConfig = loadAppConfig(source);
  const backupConfig = loadBackupConfig(source);

  if (!appConfig.ok || !backupConfig.ok) {
    return failure({
      step: "configuration",
      reason: "invalidConfiguration",
      configErrors: backupConfig.ok ? [] : backupConfig.errors,
    });
  }

  const key = await readEncryptionKey(backupConfig.value.encryptionKeyFile);

  if (!key.ok) {
    return failure({ step: "encryptionKey", reason: key.error });
  }

  let staging: string;

  try {
    await mkdir(backupConfig.value.stagingPath, {
      recursive: true,
      mode: OWNER_ONLY_DIRECTORY_MODE,
    });
    staging = await mkdtemp(
      join(backupConfig.value.stagingPath, STAGING_PREFIX),
    );
  } catch {
    return failure({ step: "staging", reason: "stagingUnavailable" });
  }

  try {
    const artifactName = formatArtifactName(options.now ?? new Date());
    const snapshotPath = join(staging, "snapshot.sqlite");
    const artifactPath = join(staging, artifactName);

    const snapshot = createConsistentSnapshot(
      appConfig.value.databasePath,
      snapshotPath,
    );

    if (!snapshot.ok) {
      return failure({ step: "snapshot", reason: snapshot.error });
    }

    const encrypted = await encryptFile(
      snapshotPath,
      artifactPath,
      key.value,
      artifactName,
    );

    if (!encrypted.ok) {
      return failure({ step: "encryption", reason: encrypted.error });
    }

    const destination = (
      options.createDestination ?? createLocalDirectoryDestination
    )(backupConfig.value.destinationDirectory);

    const uploaded = await destination.upload(artifactPath, artifactName);

    if (!uploaded.ok) {
      return failure({ step: "upload", reason: uploaded.error });
    }

    return applyRetention(
      destination,
      uploaded.value.byteLength,
      artifactName,
      options.limits ?? DEFAULT_RETENTION_LIMITS,
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/**
 * Deletes the artifacts the retention rules no longer protect.
 *
 * Only artifacts the destination reported as owned are considered, and the
 * artifact just uploaded is always among the retained ones because it is the
 * newest representative of its day, week and month.
 */
async function applyRetention(
  destination: BackupDestination,
  byteLength: number,
  artifactName: string,
  limits: RetentionLimits,
): Promise<BackupRunResult> {
  const stored = await destination.listOwnedArtifacts();

  if (!stored.ok) {
    return failure({ step: "retention", reason: stored.error });
  }

  const plan = planRetention(stored.value, limits);

  for (const name of plan.remove) {
    const removed = await destination.remove(name);

    if (!removed.ok) {
      return failure({ step: "retention", reason: removed.error });
    }
  }

  return {
    ok: true,
    value: {
      artifactName,
      byteLength,
      keptArtifacts: plan.keep.length,
      removedArtifacts: plan.remove.length,
    },
  };
}

function failure(error: BackupFailure): BackupRunResult {
  return { ok: false, error };
}
