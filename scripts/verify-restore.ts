/**
 * Verify an encrypted backup without replacing a live database.
 *
 * This is intentionally verification-only. It writes exclusively to a
 * temporary directory and prints no paths, financial counts or totals.
 */
import { verifyRestoreArtifact } from "../src/shared/server/backup/restore-verification";

async function main(): Promise<void> {
  const artifactPath = process.argv[2];

  if (artifactPath === undefined) {
    console.error("restore verification failed reason=artifactPathRequired");
    process.exitCode = 1;
    return;
  }

  const result = await verifyRestoreArtifact(artifactPath);

  if (!result.ok) {
    console.error(`restore verification failed reason=${result.error}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `restore verification completed migrationsApplied=${result.value.migrationsApplied.length}`,
  );
}

await main();
