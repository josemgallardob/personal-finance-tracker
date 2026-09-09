/**
 * Authenticated encryption for backup artifacts.
 *
 * A snapshot leaves the host encrypted with AES-256-GCM. The artifact name is
 * bound to the ciphertext as additional authenticated data, so a renamed or
 * swapped artifact fails authentication instead of restoring the wrong file.
 * The key never lives in this repository and never travels in an environment
 * value: it is read from an owner-installed file whose permissions must not
 * grant access to the group or to other users.
 *
 * Layout: magic (8 bytes) | initialisation vector (12) | ciphertext | tag (16).
 */

import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

/** File signature that marks an artifact as produced by this tool. */
export const ARTIFACT_MAGIC = Buffer.from("PFTBAK01", "ascii");

/** Bytes of the random initialisation vector stored after the signature. */
export const INITIALISATION_VECTOR_BYTES = 12;

/** Bytes of the GCM authentication tag stored at the end of the artifact. */
export const AUTHENTICATION_TAG_BYTES = 16;

/** Required key length for AES-256-GCM. */
export const ENCRYPTION_KEY_BYTES = 32;

/** Bytes preceding the ciphertext. */
export const ARTIFACT_HEADER_BYTES =
  ARTIFACT_MAGIC.byteLength + INITIALISATION_VECTOR_BYTES;

/** Smallest possible artifact: header plus tag, with empty ciphertext. */
export const ARTIFACT_MINIMUM_BYTES =
  ARTIFACT_HEADER_BYTES + AUTHENTICATION_TAG_BYTES;

/** Permission bits that must not be set on the key file. */
export const FORBIDDEN_KEY_FILE_MODE_BITS = 0o077;

/** Mode applied to every file this module writes. */
const OWNER_ONLY_FILE_MODE = 0o600;

const CIPHER_ALGORITHM = "aes-256-gcm";

/** Reason why key material or an artifact was rejected. */
export type EncryptionErrorCode =
  | "keyFileUnreadable"
  | "insecureKeyFilePermissions"
  | "invalidKeyLength"
  | "notAnOwnedArtifact"
  | "encryptFailed"
  | "decryptFailed";

/** Outcome of a key read or of an encryption operation. */
export type EncryptionResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: EncryptionErrorCode };

/**
 * Reads the base64 encryption key from an owner-installed file.
 *
 * A key readable by the group or by other users is refused instead of used,
 * because an artifact is only as private as the file that decrypts it. The
 * key material itself is never returned in an error, logged or serialised.
 */
export async function readEncryptionKey(
  keyFilePath: string,
): Promise<EncryptionResult<Buffer>> {
  let raw: string;

  try {
    const stats = await stat(keyFilePath);

    if ((stats.mode & FORBIDDEN_KEY_FILE_MODE_BITS) !== 0) {
      return { ok: false, error: "insecureKeyFilePermissions" };
    }

    const handle = await open(keyFilePath, "r");

    try {
      raw = (await handle.readFile("utf8")).trim();
    } finally {
      await handle.close();
    }
  } catch {
    return { ok: false, error: "keyFileUnreadable" };
  }

  const key = Buffer.from(raw, "base64");

  if (key.byteLength !== ENCRYPTION_KEY_BYTES) {
    return { ok: false, error: "invalidKeyLength" };
  }

  return { ok: true, value: key };
}

/**
 * Encrypts `sourcePath` into `targetPath`, binding it to `artifactName`.
 *
 * The plaintext is streamed, so a large database never has to be held in
 * memory, and the target is created with owner-only permissions.
 */
export async function encryptFile(
  sourcePath: string,
  targetPath: string,
  key: Buffer,
  artifactName: string,
): Promise<EncryptionResult<{ readonly byteLength: number }>> {
  const initialisationVector = randomBytes(INITIALISATION_VECTOR_BYTES);
  const cipher = createCipheriv(CIPHER_ALGORITHM, key, initialisationVector);
  cipher.setAAD(Buffer.from(artifactName, "utf8"));

  const target = createWriteStream(targetPath, { mode: OWNER_ONLY_FILE_MODE });

  try {
    target.write(ARTIFACT_MAGIC);
    target.write(initialisationVector);

    await pipeline(createReadStream(sourcePath), cipher, target, {
      end: false,
    });

    target.write(cipher.getAuthTag());
    await endStream(target);
  } catch {
    target.destroy();
    return { ok: false, error: "encryptFailed" };
  }

  const stats = await stat(targetPath);
  return { ok: true, value: { byteLength: stats.size } };
}

/**
 * Decrypts an artifact into `targetPath` after verifying its authenticity.
 *
 * Authentication covers the ciphertext and the artifact name, so a truncated,
 * modified, renamed or foreign file is rejected instead of producing a
 * plausible but wrong database.
 */
export async function decryptFile(
  sourcePath: string,
  targetPath: string,
  key: Buffer,
  artifactName: string,
): Promise<EncryptionResult<{ readonly byteLength: number }>> {
  let initialisationVector: Buffer;
  let authenticationTag: Buffer;
  let sourceBytes: number;

  try {
    const stats = await stat(sourcePath);
    sourceBytes = stats.size;

    if (sourceBytes < ARTIFACT_MINIMUM_BYTES) {
      return { ok: false, error: "notAnOwnedArtifact" };
    }

    const handle = await open(sourcePath, "r");

    try {
      const header = Buffer.alloc(ARTIFACT_HEADER_BYTES);
      await handle.read(header, 0, ARTIFACT_HEADER_BYTES, 0);

      if (
        !header.subarray(0, ARTIFACT_MAGIC.byteLength).equals(ARTIFACT_MAGIC)
      ) {
        return { ok: false, error: "notAnOwnedArtifact" };
      }

      initialisationVector = header.subarray(ARTIFACT_MAGIC.byteLength);
      authenticationTag = Buffer.alloc(AUTHENTICATION_TAG_BYTES);
      await handle.read(
        authenticationTag,
        0,
        AUTHENTICATION_TAG_BYTES,
        sourceBytes - AUTHENTICATION_TAG_BYTES,
      );
    } finally {
      await handle.close();
    }
  } catch {
    return { ok: false, error: "notAnOwnedArtifact" };
  }

  const decipher = createDecipheriv(
    CIPHER_ALGORITHM,
    key,
    initialisationVector,
  );
  decipher.setAAD(Buffer.from(artifactName, "utf8"));
  decipher.setAuthTag(authenticationTag);

  try {
    await pipeline(
      createReadStream(sourcePath, {
        start: ARTIFACT_HEADER_BYTES,
        end: sourceBytes - AUTHENTICATION_TAG_BYTES - 1,
      }),
      decipher,
      createWriteStream(targetPath, { mode: OWNER_ONLY_FILE_MODE }),
    );
  } catch {
    return { ok: false, error: "decryptFailed" };
  }

  const stats = await stat(targetPath);
  return { ok: true, value: { byteLength: stats.size } };
}

/**
 * Reports whether a file starts with this tool's artifact signature.
 *
 * Retention combines this check with the artifact name so that an unrelated
 * file placed in the destination is never considered for deletion.
 */
export async function hasArtifactSignature(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath);

    if (!stats.isFile() || stats.size < ARTIFACT_MINIMUM_BYTES) {
      return false;
    }

    const handle = await open(filePath, "r");

    try {
      const magic = Buffer.alloc(ARTIFACT_MAGIC.byteLength);
      await handle.read(magic, 0, ARTIFACT_MAGIC.byteLength, 0);
      return magic.equals(ARTIFACT_MAGIC);
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

function endStream(target: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    target.end(() => {
      resolve();
    });
    target.on("error", reject);
  });
}
