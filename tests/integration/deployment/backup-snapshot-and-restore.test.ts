/**
 * Consistent snapshot under concurrent writes, and the restore it enables.
 *
 * The snapshot is taken against a database a separate real process keeps
 * writing to, because a byte copy of a live SQLite file is exactly what these
 * checks must rule out. The restored copy has to reproduce complete
 * transactions: a movement without its tag association would prove the
 * snapshot captured a half-applied write.
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

/** Writer child with piped output and no standard input. */
type WriterProcess = ChildProcessByStdio<null, Readable, Readable>;
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { formatArtifactName } from "../../../src/shared/server/backup/artifact";
import {
  decryptFile,
  encryptFile,
} from "../../../src/shared/server/backup/encryption";
import {
  createConsistentSnapshot,
  verifySnapshot,
} from "../../../src/shared/server/backup/snapshot";
import {
  createBackupWorkspace,
  createPopulatedDatabase,
  insertMovement,
  openDatabase,
  type BackupWorkspace,
} from "../helpers/backup";

const repositoryRoot = dirname(
  dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
);

const writerPath = join(
  repositoryRoot,
  "tests/integration/helpers/concurrent-writer.ts",
);

const workspaces: BackupWorkspace[] = [];
const writers: WriterProcess[] = [];

afterEach(() => {
  while (writers.length > 0) {
    writers.pop()?.kill("SIGKILL");
  }
  while (workspaces.length > 0) {
    workspaces.pop()?.cleanup();
  }
});

function createWorkspace(): BackupWorkspace {
  const workspace = createBackupWorkspace();
  workspaces.push(workspace);
  return workspace;
}

/** Starts the writer child and resolves once it has committed a movement. */
async function startWriter(
  databasePath: string,
  workspaceId: string,
): Promise<WriterProcess> {
  const child = spawn(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      writerPath,
      databasePath,
      workspaceId,
    ],
    { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] },
  );

  writers.push(child);

  await new Promise<void>((resolve, reject) => {
    let output = "";

    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");

      if (output.includes("ready")) {
        resolve();
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      reject(new Error(`writer exited early with code ${String(code)}`));
    });
  });

  return child;
}

/** Counts movements and detects any movement missing its tag association. */
function readSnapshotShape(filePath: string): {
  readonly movements: number;
  readonly associations: number;
  readonly incompleteMovements: number;
} {
  const connection = openDatabase(filePath);

  try {
    const movements = connection.sqlite
      .prepare('SELECT COUNT(*) AS total FROM "transaction"')
      .get() as { readonly total: number };
    const associations = connection.sqlite
      .prepare("SELECT COUNT(*) AS total FROM transaction_tag")
      .get() as { readonly total: number };
    const incomplete = connection.sqlite
      .prepare(
        `SELECT COUNT(*) AS total
           FROM "transaction" AS t
           LEFT JOIN transaction_tag AS a ON a.transaction_id = t.id
          WHERE a.transaction_id IS NULL`,
      )
      .get() as { readonly total: number };

    return {
      movements: movements.total,
      associations: associations.total,
      incompleteMovements: incomplete.total,
    };
  } finally {
    connection.close();
  }
}

describe("consistent snapshot", () => {
  it("captures only complete transactions while another process writes", async () => {
    const workspace = createWorkspace();
    const { workspaceId } = createPopulatedDatabase(workspace.databasePath);
    const writer = await startWriter(workspace.databasePath, workspaceId);

    const snapshotPath = join(workspace.directory, "snapshot.sqlite");
    const snapshot = createConsistentSnapshot(
      workspace.databasePath,
      snapshotPath,
    );

    expect(snapshot).toEqual({
      ok: true,
      value: { byteLength: expect.any(Number) },
    });

    writer.kill("SIGTERM");
    await new Promise((resolve) => writer.on("exit", resolve));

    const shape = readSnapshotShape(snapshotPath);
    const live = readSnapshotShape(workspace.databasePath);

    expect(shape.movements).toBeGreaterThan(0);
    expect(shape.incompleteMovements).toBe(0);
    expect(shape.associations).toBe(shape.movements);
    expect(verifySnapshot(snapshotPath)).toBe(true);

    // The writer kept committing during and after the snapshot, so the live
    // file is never behind the copy that was taken from it.
    expect(live.movements).toBeGreaterThanOrEqual(shape.movements);
    expect(live.incompleteMovements).toBe(0);
  });

  it("refuses to overwrite an existing snapshot and rejects a missing source", () => {
    const workspace = createWorkspace();
    createPopulatedDatabase(workspace.databasePath);

    const snapshotPath = join(workspace.directory, "snapshot.sqlite");

    expect(
      createConsistentSnapshot(workspace.databasePath, snapshotPath).ok,
    ).toBe(true);
    expect(
      createConsistentSnapshot(workspace.databasePath, snapshotPath),
    ).toEqual({ ok: false, error: "snapshotFailed" });
    expect(
      createConsistentSnapshot(
        join(workspace.directory, "absent.sqlite"),
        join(workspace.directory, "other.sqlite"),
      ),
    ).toEqual({ ok: false, error: "sourceUnavailable" });
  });

  it("reports a file that is not a usable SQLite database as unverifiable", () => {
    const workspace = createWorkspace();

    expect(verifySnapshot(join(workspace.directory, "absent.sqlite"))).toBe(
      false,
    );
    expect(verifySnapshot(workspace.keyFilePath)).toBe(false);
  });
});

describe("restore from an encrypted snapshot", () => {
  it("reproduces every movement, association and total", async () => {
    const workspace = createWorkspace();
    const { workspaceId } = createPopulatedDatabase(workspace.databasePath);

    const source = openDatabase(workspace.databasePath);
    for (let index = 0; index < 25; index += 1) {
      insertMovement(source, workspaceId, index);
    }
    const expectedTotal = source.sqlite
      .prepare('SELECT SUM(amount_minor) AS total FROM "transaction"')
      .get() as { readonly total: number };
    source.close();

    const snapshotPath = join(workspace.directory, "snapshot.sqlite");
    expect(
      createConsistentSnapshot(workspace.databasePath, snapshotPath).ok,
    ).toBe(true);

    const artifactName = formatArtifactName(new Date("2026-03-04T02:00:00Z"));
    const artifactPath = join(workspace.directory, artifactName);
    const restoredPath = join(workspace.directory, "restored.sqlite");

    const encrypted = await encryptFile(
      snapshotPath,
      artifactPath,
      workspace.key,
      artifactName,
    );
    expect(encrypted.ok).toBe(true);

    const decrypted = await decryptFile(
      artifactPath,
      restoredPath,
      workspace.key,
      artifactName,
    );
    expect(decrypted.ok).toBe(true);

    expect(existsSync(restoredPath)).toBe(true);
    expect(verifySnapshot(restoredPath)).toBe(true);

    const restored = readSnapshotShape(restoredPath);
    expect(restored.movements).toBe(25);
    expect(restored.associations).toBe(25);
    expect(restored.incompleteMovements).toBe(0);

    const restoredConnection = openDatabase(restoredPath);
    const restoredTotal = restoredConnection.sqlite
      .prepare('SELECT SUM(amount_minor) AS total FROM "transaction"')
      .get() as { readonly total: number };
    restoredConnection.close();

    expect(restoredTotal.total).toBe(expectedTotal.total);
  });
});
