/**
 * Key handling, authenticated encryption and artifact ownership.
 *
 * These checks defend two properties. A backup is only as private as the file
 * that decrypts it, so a key readable beyond its owner, a key of the wrong
 * length or an unreadable key file must stop the run instead of producing an
 * artifact. And an artifact must authenticate: a modified, truncated, renamed
 * or foreign file has to fail rather than restore plausible but wrong data.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ARTIFACT_NAME_PREFIX,
  ARTIFACT_NAME_SUFFIX,
  formatArtifactName,
  parseArtifactName,
} from "../../../src/shared/server/backup/artifact";
import {
  ARTIFACT_HEADER_BYTES,
  ARTIFACT_MAGIC,
  ARTIFACT_MINIMUM_BYTES,
  AUTHENTICATION_TAG_BYTES,
  decryptFile,
  encryptFile,
  ENCRYPTION_KEY_BYTES,
  hasArtifactSignature,
  readEncryptionKey,
} from "../../../src/shared/server/backup/encryption";
import { createBackupWorkspace, type BackupWorkspace } from "../helpers/backup";

const workspaces: BackupWorkspace[] = [];

afterEach(() => {
  while (workspaces.length > 0) {
    workspaces.pop()?.cleanup();
  }
});

function createWorkspace(): BackupWorkspace {
  const workspace = createBackupWorkspace();
  workspaces.push(workspace);
  return workspace;
}

const PLAINTEXT = "personal finance snapshot bytes";

/** Writes a plaintext file and returns its path. */
function writePlaintext(workspace: BackupWorkspace): string {
  const path = join(workspace.directory, "snapshot.sqlite");
  writeFileSync(path, PLAINTEXT, "utf8");
  return path;
}

const ARTIFACT_NAME = formatArtifactName(new Date("2026-03-04T02:17:00Z"));

describe("artifact names", () => {
  it("identifies its own artifacts and rejects every foreign name", () => {
    expect(ARTIFACT_NAME).toBe(
      `${ARTIFACT_NAME_PREFIX}20260304T021700Z${ARTIFACT_NAME_SUFFIX}`,
    );
    expect(parseArtifactName(ARTIFACT_NAME)?.toISOString()).toBe(
      "2026-03-04T02:17:00.000Z",
    );

    for (const foreign of [
      "personal-finance.db",
      "backup.sqlite.enc",
      `${ARTIFACT_NAME}.partial`,
      `${ARTIFACT_NAME_PREFIX}20260304T021700Z.sqlite`,
      `${ARTIFACT_NAME_PREFIX}20261304T021700Z${ARTIFACT_NAME_SUFFIX}`,
      `${ARTIFACT_NAME_PREFIX}20260231T021700Z${ARTIFACT_NAME_SUFFIX}`,
      `${ARTIFACT_NAME_PREFIX}20260304T256100Z${ARTIFACT_NAME_SUFFIX}`,
    ]) {
      expect(parseArtifactName(foreign)).toBeNull();
    }
  });

  it("pads every calendar field so names sort chronologically", () => {
    expect(formatArtifactName(new Date("2026-01-02T03:04:05Z"))).toBe(
      `${ARTIFACT_NAME_PREFIX}20260102T030405Z${ARTIFACT_NAME_SUFFIX}`,
    );
  });
});

describe("encryption key file", () => {
  it("accepts an owner-only base64 key of the required length", async () => {
    const workspace = createWorkspace();
    const key = await readEncryptionKey(workspace.keyFilePath);

    expect(key).toEqual({ ok: true, value: workspace.key });
    expect(key.ok && key.value.byteLength).toBe(ENCRYPTION_KEY_BYTES);
  });

  it("refuses a key file readable by the group or by other users", async () => {
    const workspace = createWorkspace();
    chmodSync(workspace.keyFilePath, 0o640);

    expect(await readEncryptionKey(workspace.keyFilePath)).toEqual({
      ok: false,
      error: "insecureKeyFilePermissions",
    });
  });

  it("refuses a missing key file and a key of the wrong length", async () => {
    const workspace = createWorkspace();
    const shortKeyPath = join(workspace.directory, "short.key");

    writeFileSync(shortKeyPath, randomBytes(16).toString("base64"), {
      mode: 0o600,
    });

    expect(
      await readEncryptionKey(join(workspace.directory, "absent.key")),
    ).toEqual({ ok: false, error: "keyFileUnreadable" });
    expect(await readEncryptionKey(shortKeyPath)).toEqual({
      ok: false,
      error: "invalidKeyLength",
    });
  });
});

describe("artifact encryption", () => {
  it("writes an owner-only signed artifact and decrypts it back", async () => {
    const workspace = createWorkspace();
    const source = writePlaintext(workspace);
    const artifactPath = join(workspace.directory, ARTIFACT_NAME);
    const restoredPath = join(workspace.directory, "restored.bin");

    const encrypted = await encryptFile(
      source,
      artifactPath,
      workspace.key,
      ARTIFACT_NAME,
    );

    expect(encrypted.ok).toBe(true);
    expect(encrypted.ok && encrypted.value.byteLength).toBe(
      ARTIFACT_MINIMUM_BYTES + Buffer.byteLength(PLAINTEXT),
    );

    const artifact = readFileSync(artifactPath);
    expect(artifact.subarray(0, ARTIFACT_MAGIC.byteLength)).toEqual(
      ARTIFACT_MAGIC,
    );
    expect(artifact.includes(Buffer.from(PLAINTEXT, "utf8"))).toBe(false);
    expect(await hasArtifactSignature(artifactPath)).toBe(true);

    const decrypted = await decryptFile(
      artifactPath,
      restoredPath,
      workspace.key,
      ARTIFACT_NAME,
    );

    expect(decrypted.ok).toBe(true);
    expect(readFileSync(restoredPath, "utf8")).toBe(PLAINTEXT);
  });

  it("fails authentication for a modified, truncated or renamed artifact", async () => {
    const workspace = createWorkspace();
    const source = writePlaintext(workspace);
    const artifactPath = join(workspace.directory, ARTIFACT_NAME);
    const restoredPath = join(workspace.directory, "restored.bin");

    expect(
      (await encryptFile(source, artifactPath, workspace.key, ARTIFACT_NAME))
        .ok,
    ).toBe(true);

    const original = readFileSync(artifactPath);

    const otherName = formatArtifactName(new Date("2026-03-05T02:17:00Z"));
    expect(
      await decryptFile(artifactPath, restoredPath, workspace.key, otherName),
    ).toEqual({ ok: false, error: "decryptFailed" });

    expect(
      await decryptFile(
        artifactPath,
        restoredPath,
        randomBytes(ENCRYPTION_KEY_BYTES),
        ARTIFACT_NAME,
      ),
    ).toEqual({ ok: false, error: "decryptFailed" });

    const modified = Buffer.from(original);
    modified[ARTIFACT_HEADER_BYTES] ^= 0xff;
    writeFileSync(artifactPath, modified);
    expect(
      await decryptFile(
        artifactPath,
        restoredPath,
        workspace.key,
        ARTIFACT_NAME,
      ),
    ).toEqual({ ok: false, error: "decryptFailed" });

    writeFileSync(
      artifactPath,
      original.subarray(0, original.byteLength - AUTHENTICATION_TAG_BYTES),
    );
    expect(
      await decryptFile(
        artifactPath,
        restoredPath,
        workspace.key,
        ARTIFACT_NAME,
      ),
    ).toEqual({ ok: false, error: "decryptFailed" });
  });

  it("rejects a file that does not carry the artifact signature", async () => {
    const workspace = createWorkspace();
    const restoredPath = join(workspace.directory, "restored.bin");
    const foreignPath = join(workspace.directory, "foreign.bin");
    const shortPath = join(workspace.directory, "short.bin");
    const emptyCiphertextPath = join(workspace.directory, "empty.bin");

    writeFileSync(foreignPath, randomBytes(ARTIFACT_MINIMUM_BYTES + 8));
    writeFileSync(shortPath, randomBytes(ARTIFACT_MINIMUM_BYTES - 1));
    writeFileSync(
      emptyCiphertextPath,
      Buffer.concat([
        ARTIFACT_MAGIC,
        randomBytes(ARTIFACT_HEADER_BYTES - ARTIFACT_MAGIC.byteLength),
        randomBytes(AUTHENTICATION_TAG_BYTES),
      ]),
    );

    expect(await hasArtifactSignature(foreignPath)).toBe(false);
    expect(await hasArtifactSignature(shortPath)).toBe(false);
    expect(await hasArtifactSignature(workspace.directory)).toBe(false);
    expect(
      await hasArtifactSignature(join(workspace.directory, "absent.bin")),
    ).toBe(false);

    expect(
      await decryptFile(
        foreignPath,
        restoredPath,
        workspace.key,
        ARTIFACT_NAME,
      ),
    ).toEqual({ ok: false, error: "notAnOwnedArtifact" });
    expect(
      await decryptFile(shortPath, restoredPath, workspace.key, ARTIFACT_NAME),
    ).toEqual({ ok: false, error: "notAnOwnedArtifact" });
    expect(
      await decryptFile(
        join(workspace.directory, "absent.bin"),
        restoredPath,
        workspace.key,
        ARTIFACT_NAME,
      ),
    ).toEqual({ ok: false, error: "notAnOwnedArtifact" });
    expect(
      (
        await decryptFile(
          emptyCiphertextPath,
          restoredPath,
          workspace.key,
          ARTIFACT_NAME,
        )
      ).ok,
    ).toBe(false);
  });

  it("reports a missing plaintext source as a failed encryption", async () => {
    const workspace = createWorkspace();

    expect(
      await encryptFile(
        join(workspace.directory, "absent.sqlite"),
        join(workspace.directory, ARTIFACT_NAME),
        workspace.key,
        ARTIFACT_NAME,
      ),
    ).toEqual({ ok: false, error: "encryptFailed" });
  });
});
