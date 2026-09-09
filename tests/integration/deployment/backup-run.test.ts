/**
 * The complete backup run against a temporary external destination.
 *
 * The ordering is the safety property under test: retention runs only after
 * the destination has committed the new artifact, so a refused upload has to
 * leave every existing valid backup untouched and report a failure. The
 * scheduled command is also executed as a real process, because a scheduler
 * only learns about a failed backup through the exit code.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { formatArtifactName } from "../../../src/shared/server/backup/artifact";
import {
  BACKUP_DESTINATION_URI_ENV,
  BACKUP_ENCRYPTION_KEY_ENV,
  BACKUP_ENCRYPTION_KEY_FILE_ENV,
  BACKUP_PATH_ENV,
} from "../../../src/shared/server/backup/config";
import {
  createLocalDirectoryDestination,
  type BackupDestination,
} from "../../../src/shared/server/backup/destination";
import {
  decryptFile,
  encryptFile,
} from "../../../src/shared/server/backup/encryption";
import { DEFAULT_RETENTION_LIMITS } from "../../../src/shared/server/backup/retention";
import { runBackup } from "../../../src/shared/server/backup/run";
import { verifySnapshot } from "../../../src/shared/server/backup/snapshot";
import { DATABASE_PATH_ENV } from "../../../src/shared/server/config";
import {
  createBackupEnv,
  createBackupWorkspace,
  createPopulatedDatabase,
  type BackupWorkspace,
} from "../helpers/backup";

const repositoryRoot = dirname(
  dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
);

const workspaces: BackupWorkspace[] = [];

afterEach(() => {
  while (workspaces.length > 0) {
    const workspace = workspaces.pop();

    if (workspace === undefined) {
      continue;
    }

    // A test may leave a directory read-only on purpose.
    try {
      chmodSync(workspace.destinationPath, 0o700);
    } catch {
      // The destination was never created.
    }

    workspace.cleanup();
  }
});

/** Creates an isolated workspace with a migrated personal database. */
function createReadyWorkspace(): BackupWorkspace {
  const workspace = createBackupWorkspace();
  workspaces.push(workspace);
  createPopulatedDatabase(workspace.databasePath);
  return workspace;
}

/** Writes a valid, owned artifact directly into the destination. */
async function seedArtifact(
  workspace: BackupWorkspace,
  createdAt: Date,
): Promise<string> {
  const artifactName = formatArtifactName(createdAt);
  const plaintextPath = join(workspace.directory, `seed-${artifactName}`);

  mkdirSync(workspace.destinationPath, { recursive: true });
  writeFileSync(plaintextPath, `seed ${artifactName}`, "utf8");

  const encrypted = await encryptFile(
    plaintextPath,
    join(workspace.destinationPath, artifactName),
    workspace.key,
    artifactName,
  );

  expect(encrypted.ok).toBe(true);
  return artifactName;
}

describe("successful backup run", () => {
  it("uploads an artifact that decrypts to a verifiable database", async () => {
    const workspace = createReadyWorkspace();
    const now = new Date("2026-03-10T02:17:00Z");

    const result = await runBackup({
      source: createBackupEnv(workspace),
      now,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        artifactName: formatArtifactName(now),
        byteLength: expect.any(Number),
        keptArtifacts: 1,
        removedArtifacts: 0,
      },
    });

    const artifactName = formatArtifactName(now);
    expect(readdirSync(workspace.destinationPath)).toEqual([artifactName]);

    const restoredPath = join(workspace.directory, "restored.sqlite");
    const decrypted = await decryptFile(
      join(workspace.destinationPath, artifactName),
      restoredPath,
      workspace.key,
      artifactName,
    );

    expect(decrypted.ok).toBe(true);
    expect(verifySnapshot(restoredPath)).toBe(true);
  });

  it("leaves no plaintext snapshot behind in the staging directory", async () => {
    const workspace = createReadyWorkspace();

    expect(
      (
        await runBackup({
          source: createBackupEnv(workspace),
          now: new Date("2026-03-10T02:17:00Z"),
        })
      ).ok,
    ).toBe(true);

    expect(readdirSync(workspace.stagingPath)).toEqual([]);
  });

  it("applies the retention rules to the artifacts it owns", async () => {
    const workspace = createReadyWorkspace();
    const now = new Date("2026-03-10T02:17:00Z");

    // Nine consecutive days before the run: the daily window covers six of
    // them, and the oldest survive only through their ISO week.
    const seeded: string[] = [];
    for (let offset = 1; offset <= 9; offset += 1) {
      const createdAt = new Date(now);
      createdAt.setUTCDate(createdAt.getUTCDate() - offset);
      seeded.push(await seedArtifact(workspace, createdAt));
    }

    writeFileSync(
      join(workspace.destinationPath, "operator-notes.txt"),
      "keep",
    );

    const result = await runBackup({
      source: createBackupEnv(workspace),
      now,
      limits: DEFAULT_RETENTION_LIMITS,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.keptArtifacts).toBe(8);
    expect(result.ok && result.value.removedArtifacts).toBe(2);

    const remaining = readdirSync(workspace.destinationPath);

    // A file this tool never wrote is never a retention candidate.
    expect(remaining).toContain("operator-notes.txt");
    expect(remaining).toContain(formatArtifactName(now));
    expect(remaining).not.toContain(seeded[6]);
    expect(remaining).not.toContain(seeded[7]);
    expect(remaining).toContain(seeded[8]);
  });
});

describe("failed upload", () => {
  it("preserves existing valid backups and reports the failure", async () => {
    const workspace = createReadyWorkspace();
    const existing = await seedArtifact(
      workspace,
      new Date("2026-03-09T02:17:00Z"),
    );

    chmodSync(workspace.destinationPath, 0o500);

    const result = await runBackup({
      source: createBackupEnv(workspace),
      now: new Date("2026-03-10T02:17:00Z"),
    });

    expect(result).toEqual({
      ok: false,
      error: { step: "upload", reason: "uploadFailed" },
    });

    chmodSync(workspace.destinationPath, 0o700);

    // The pre-existing backup is intact and still decrypts, and no partial
    // upload was left in the destination.
    expect(readdirSync(workspace.destinationPath)).toEqual([existing]);

    const restoredPath = join(workspace.directory, "restored.bin");
    expect(
      (
        await decryptFile(
          join(workspace.destinationPath, existing),
          restoredPath,
          workspace.key,
          existing,
        )
      ).ok,
    ).toBe(true);
  });

  it("keeps the uploaded artifact when retention cannot delete", async () => {
    const workspace = createReadyWorkspace();
    const now = new Date("2026-03-10T02:17:00Z");

    for (let offset = 1; offset <= 9; offset += 1) {
      const createdAt = new Date(now);
      createdAt.setUTCDate(createdAt.getUTCDate() - offset);
      await seedArtifact(workspace, createdAt);
    }

    // The external destination stops accepting deletions after the upload the
    // run has just committed. Only the destination is affected: the snapshot,
    // encryption and retention logic under test are the real ones.
    const createDestination = (directory: string): BackupDestination => {
      const real = createLocalDirectoryDestination(directory);

      return {
        ...real,
        async upload(localPath, artifactName) {
          const uploaded = await real.upload(localPath, artifactName);
          chmodSync(directory, 0o500);
          return uploaded;
        },
      };
    };

    const result = await runBackup({
      source: createBackupEnv(workspace),
      now,
      createDestination,
    });

    expect(result).toEqual({
      ok: false,
      error: { step: "retention", reason: "removeFailed" },
    });

    chmodSync(workspace.destinationPath, 0o700);
    expect(readdirSync(workspace.destinationPath)).toContain(
      formatArtifactName(now),
    );
    expect(readdirSync(workspace.destinationPath)).toHaveLength(10);
  });
});

describe("unreachable destination", () => {
  it("reports a listing failure without deleting anything", async () => {
    const workspace = createReadyWorkspace();
    const now = new Date("2026-03-10T02:17:00Z");

    for (let offset = 1; offset <= 9; offset += 1) {
      const createdAt = new Date(now);
      createdAt.setUTCDate(createdAt.getUTCDate() - offset);
      await seedArtifact(workspace, createdAt);
    }

    // The destination becomes unreadable right after committing the upload,
    // which is what a provider outage between the two steps looks like.
    const createDestination = (directory: string): BackupDestination => {
      const real = createLocalDirectoryDestination(directory);

      return {
        ...real,
        async upload(localPath, artifactName) {
          const uploaded = await real.upload(localPath, artifactName);
          chmodSync(directory, 0o000);
          return uploaded;
        },
      };
    };

    const result = await runBackup({
      source: createBackupEnv(workspace),
      now,
      createDestination,
    });

    expect(result).toEqual({
      ok: false,
      error: { step: "retention", reason: "listFailed" },
    });

    chmodSync(workspace.destinationPath, 0o700);
    expect(readdirSync(workspace.destinationPath)).toHaveLength(10);
  });
});

describe("refused configuration", () => {
  it("refuses key material passed inline instead of through a file", async () => {
    const workspace = createReadyWorkspace();

    const result = await runBackup({
      source: createBackupEnv(workspace, {
        [BACKUP_ENCRYPTION_KEY_ENV]: workspace.key.toString("base64"),
      }),
      now: new Date("2026-03-10T02:17:00Z"),
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.step).toBe("configuration");
    expect(!result.ok && result.error.configErrors).toContainEqual({
      field: "encryptionKeyFile",
      code: "inlineSecretRejected",
    });
  });

  it("collects every missing or unusable configuration value", async () => {
    const workspace = createReadyWorkspace();

    const result = await runBackup({
      source: createBackupEnv(workspace, {
        [BACKUP_PATH_ENV]: undefined,
        [BACKUP_DESTINATION_URI_ENV]: "s3://finance-backups/personal",
        [BACKUP_ENCRYPTION_KEY_FILE_ENV]: "relative/backup.key",
      }),
      now: new Date("2026-03-10T02:17:00Z"),
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.configErrors).toEqual([
      { field: "stagingPath", code: "required" },
      { field: "destinationUri", code: "unsupportedDestinationScheme" },
      { field: "encryptionKeyFile", code: "keyFileNotAbsolute" },
    ]);
  });

  it("reports the destination and the key file as required when unset", async () => {
    const workspace = createReadyWorkspace();

    const result = await runBackup({
      source: createBackupEnv(workspace, {
        [BACKUP_DESTINATION_URI_ENV]: undefined,
        [BACKUP_ENCRYPTION_KEY_FILE_ENV]: undefined,
      }),
      now: new Date("2026-03-10T02:17:00Z"),
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.configErrors).toEqual([
      { field: "destinationUri", code: "required" },
      { field: "encryptionKeyFile", code: "required" },
    ]);
  });

  it("refuses to run when the application configuration is unusable", async () => {
    const workspace = createReadyWorkspace();

    const result = await runBackup({
      source: createBackupEnv(workspace, { [DATABASE_PATH_ENV]: ":memory:" }),
      now: new Date("2026-03-10T02:17:00Z"),
    });

    expect(result).toEqual({
      ok: false,
      error: {
        step: "configuration",
        reason: "invalidConfiguration",
        configErrors: [],
      },
    });
    expect(readdirSync(workspace.directory)).not.toContain("destination");
  });

  it("stops on an insecure key file before touching the database", async () => {
    const workspace = createReadyWorkspace();
    chmodSync(workspace.keyFilePath, 0o644);

    expect(
      await runBackup({
        source: createBackupEnv(workspace),
        now: new Date("2026-03-10T02:17:00Z"),
      }),
    ).toEqual({
      ok: false,
      error: { step: "encryptionKey", reason: "insecureKeyFilePermissions" },
    });
  });

  it("reports an unavailable staging directory and an absent database", async () => {
    const workspace = createReadyWorkspace();

    expect(
      await runBackup({
        source: createBackupEnv(workspace, {
          [BACKUP_PATH_ENV]: join(workspace.keyFilePath, "staging"),
        }),
        now: new Date("2026-03-10T02:17:00Z"),
      }),
    ).toEqual({
      ok: false,
      error: { step: "staging", reason: "stagingUnavailable" },
    });

    expect(
      await runBackup({
        source: createBackupEnv(workspace, {
          [DATABASE_PATH_ENV]: join(workspace.directory, "absent.sqlite"),
        }),
        now: new Date("2026-03-10T02:17:00Z"),
      }),
    ).toEqual({
      ok: false,
      error: { step: "snapshot", reason: "sourceUnavailable" },
    });
  });
});

describe("scheduled command", () => {
  it("exits zero on success and non-zero on a refused upload", async () => {
    const workspace = createReadyWorkspace();
    const environment = {
      ...process.env,
      ...createBackupEnv(workspace),
    } as NodeJS.ProcessEnv;

    const succeeded = spawnSync("npm", ["run", "backup:run"], {
      cwd: repositoryRoot,
      env: environment,
      encoding: "utf8",
    });

    expect(succeeded.status).toBe(0);
    expect(succeeded.stdout).toContain("backup completed");
    expect(succeeded.stdout).not.toContain(workspace.databasePath);
    expect(succeeded.stdout).not.toContain(workspace.keyFilePath);
    expect(readdirSync(workspace.destinationPath)).toHaveLength(1);

    chmodSync(workspace.destinationPath, 0o500);

    const failed = spawnSync("npm", ["run", "backup:run"], {
      cwd: repositoryRoot,
      env: environment,
      encoding: "utf8",
    });

    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain("backup failed step=upload");

    chmodSync(workspace.destinationPath, 0o700);
    expect(readdirSync(workspace.destinationPath)).toHaveLength(1);
  });
});
