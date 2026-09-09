/**
 * Applies migrations and the common catalog seed to the isolated demo file.
 *
 * This command never reads a session cookie and never accesses the personal
 * path. DEMO-02 owns inserting the reproducible fictitious dataset.
 */

import {
  closeSqliteConnection,
  getDemoSqliteConnection,
} from "../src/shared/server/database";
import { initializeDatabase } from "../src/shared/server/initialize";

const opened = getDemoSqliteConnection();

if (!opened.ok) {
  console.error("Could not open the demo SQLite database.", opened.error);
  process.exit(1);
}

const initialized = initializeDatabase(opened.value);

closeSqliteConnection();

if (!initialized.ok) {
  console.error("Demo database initialization failed.", initialized.error);
  process.exit(1);
}

console.log(
  initialized.value.createdWorkspace
    ? `Initialized demo workspace ${initialized.value.workspaceId}.`
    : `Reused demo workspace ${initialized.value.workspaceId}.`,
);
