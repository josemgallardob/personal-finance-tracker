/**
 * Temporary drizzle-kit journals for migration-failure tests.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createTemporarySqliteFile } from "./sqlite";

/** Tags of the committed drizzle-kit journal, in apply order. */
export const COMMITTED_MIGRATION_TAGS = [
  "0000_workspace_and_preference",
  "0001_classification_and_transactions",
  "0002_require_integer_amount_minor",
  "0003_recurring_rules_and_occurrences",
] as const;

/** Isolated folder that looks like a drizzle-kit output directory. */
export function createTemporaryMigrationFolder(): {
  readonly folder: string;
  cleanup(): void;
} {
  const file = createTemporarySqliteFile();

  mkdirSync(join(file.directory, "meta"));

  return {
    folder: file.directory,
    cleanup(): void {
      file.cleanup();
    },
  };
}

/** Writes a journal and the SQL files it names. */
export function writeMigrationJournal(
  folder: string,
  files: readonly { readonly tag: string; readonly sql: string }[],
): void {
  writeFileSync(
    join(folder, "meta/_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: files.map((file, idx) => ({
        idx,
        version: "7",
        when: 1 + idx,
        tag: file.tag,
        breakpoints: true,
      })),
    }),
  );

  for (const file of files) {
    writeFileSync(join(folder, `${file.tag}.sql`), file.sql);
  }
}
