/**
 * Scheduled backup entry point: snapshot, encrypt, upload and prune.
 *
 * The process exits non-zero whenever the artifact did not reach the external
 * destination or retention could not be applied, so a scheduler reports a
 * failed backup instead of a silent gap in the retained history. The printed
 * summary names the step and a closed reason code; it never prints a database
 * path, key material or financial data.
 */

import { runBackup } from "../src/shared/server/backup/run";

async function main(): Promise<void> {
  const result = await runBackup();

  if (!result.ok) {
    const { step, reason, configErrors } = result.error;
    const fields = (configErrors ?? [])
      .map((error) => `${error.field}:${error.code}`)
      .join(" ");

    console.error(
      `backup failed step=${step} reason=${reason} ${fields}`.trim(),
    );
    process.exitCode = 1;
    return;
  }

  const { artifactName, byteLength, keptArtifacts, removedArtifacts } =
    result.value;

  console.log(
    `backup completed artifact=${artifactName} bytes=${byteLength} ` +
      `kept=${keptArtifacts} removed=${removedArtifacts}`,
  );
}

await main();
