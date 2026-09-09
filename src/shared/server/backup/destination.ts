/**
 * Provider-neutral external destination for encrypted artifacts.
 *
 * The interface is the contract every provider must satisfy; the only
 * implementation in this repository writes to a directory, which is what an
 * owner-mounted external volume or a synchronised remote share exposes to the
 * host. A hosted-object provider needs the owner's decision on provider, path
 * and credential handling, so an unknown scheme is refused instead of guessed.
 *
 * Two properties are load-bearing for the rest of the tool:
 * an upload is committed atomically, so a failed transfer never replaces or
 * truncates an existing artifact; and listing and deletion only ever consider
 * files that carry this tool's name shape and encrypted signature.
 */

import "server-only";

import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ARTIFACT_PARTIAL_SUFFIX, parseArtifactName } from "./artifact";
import { hasArtifactSignature } from "./encryption";

/** Destination scheme implemented in this repository. */
export const LOCAL_DIRECTORY_SCHEME = "file:";

/** Permissions applied to a destination directory created by this tool. */
const OWNER_ONLY_DIRECTORY_MODE = 0o700;

/** Reason why a destination URI was rejected. */
export type DestinationUriErrorCode =
  "invalidDestinationUri" | "unsupportedDestinationScheme";

/** Reason why a destination operation failed. */
export type DestinationErrorCode =
  "uploadFailed" | "listFailed" | "removeFailed" | "notAnOwnedArtifact";

/** Artifact stored at the destination. */
export interface StoredArtifact {
  readonly name: string;
  readonly createdAt: Date;
  readonly byteLength: number;
}

/** Outcome of a destination operation. */
export type DestinationResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: DestinationErrorCode };

/** External destination an artifact is uploaded to and pruned from. */
export interface BackupDestination {
  /** Scheme of the resolved destination. Never contains a credential. */
  readonly scheme: string;
  upload(
    localPath: string,
    artifactName: string,
  ): Promise<DestinationResult<StoredArtifact>>;
  listOwnedArtifacts(): Promise<DestinationResult<readonly StoredArtifact[]>>;
  remove(artifactName: string): Promise<DestinationResult<void>>;
}

/** Outcome of resolving a configured destination URI. */
export type DestinationUriResult =
  | { readonly ok: true; readonly value: { readonly directory: string } }
  | { readonly ok: false; readonly error: DestinationUriErrorCode };

/**
 * Resolves the configured destination URI to a local directory.
 *
 * Any other scheme, including a hosted-object provider, is refused: choosing
 * the provider, the path and the credential mechanism is an owner decision
 * that must precede a real deployment.
 */
export function resolveDestinationUri(raw: string): DestinationUriResult {
  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "invalidDestinationUri" };
  }

  if (parsed.protocol !== LOCAL_DIRECTORY_SCHEME) {
    return { ok: false, error: "unsupportedDestinationScheme" };
  }

  let directory: string;

  try {
    directory = fileURLToPath(parsed);
  } catch {
    return { ok: false, error: "invalidDestinationUri" };
  }

  if (!isAbsolute(directory)) {
    return { ok: false, error: "invalidDestinationUri" };
  }

  return { ok: true, value: { directory } };
}

/**
 * Creates the directory-backed destination.
 *
 * The upload writes a `.partial` companion first and commits it with a
 * rename, so an interrupted or refused transfer leaves the previously
 * uploaded artifacts exactly as they were.
 */
export function createLocalDirectoryDestination(
  directory: string,
): BackupDestination {
  return {
    scheme: LOCAL_DIRECTORY_SCHEME,

    async upload(localPath, artifactName) {
      const createdAt = parseArtifactName(artifactName);

      if (createdAt === null) {
        return { ok: false, error: "notAnOwnedArtifact" };
      }

      const finalPath = join(directory, artifactName);
      const partialPath = `${finalPath}${ARTIFACT_PARTIAL_SUFFIX}`;

      try {
        await mkdir(directory, {
          recursive: true,
          mode: OWNER_ONLY_DIRECTORY_MODE,
        });
        await copyFile(localPath, partialPath, fsConstants.COPYFILE_FICLONE);
        await rename(partialPath, finalPath);
      } catch {
        await rm(partialPath, { force: true }).catch(() => undefined);
        return { ok: false, error: "uploadFailed" };
      }

      const stats = await stat(finalPath);

      return {
        ok: true,
        value: {
          name: artifactName,
          createdAt,
          byteLength: stats.size,
        },
      };
    },

    async listOwnedArtifacts() {
      let entries: readonly string[];

      try {
        entries = await readdir(directory);
      } catch {
        return { ok: false, error: "listFailed" };
      }

      const artifacts: StoredArtifact[] = [];

      for (const entry of entries) {
        const createdAt = parseArtifactName(entry);

        if (createdAt === null) {
          continue;
        }

        const entryPath = join(directory, entry);

        if (!(await hasArtifactSignature(entryPath))) {
          continue;
        }

        artifacts.push({
          name: entry,
          createdAt,
          byteLength: (await stat(entryPath)).size,
        });
      }

      return { ok: true, value: artifacts };
    },

    async remove(artifactName) {
      const entryPath = join(directory, artifactName);

      if (
        parseArtifactName(artifactName) === null ||
        !(await hasArtifactSignature(entryPath))
      ) {
        return { ok: false, error: "notAnOwnedArtifact" };
      }

      try {
        await rm(entryPath);
      } catch {
        return { ok: false, error: "removeFailed" };
      }

      return { ok: true, value: undefined };
    },
  };
}
