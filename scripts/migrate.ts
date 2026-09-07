/**
 * Applies pending migrations and bootstraps the personal workspace.
 *
 * Run this command against a database file. Request handlers must not import
 * it; they only resolve the workspace that this script left behind.
 */

import {
  closeSqliteConnection,
  getSqliteConnection,
} from "../src/shared/server/database";
import { initializeDatabase } from "../src/shared/server/initialize";

const opened = getSqliteConnection();

if (!opened.ok) {
  console.error("Could not open the SQLite database.", opened.error);
  process.exit(1);
}

const initialized = initializeDatabase(opened.value);

closeSqliteConnection();

if (!initialized.ok) {
  console.error("Database initialization failed.", initialized.error);
  process.exit(1);
}

console.log(
  initialized.value.createdWorkspace
    ? `Initialized personal workspace ${initialized.value.workspaceId}.`
    : `Reused personal workspace ${initialized.value.workspaceId}.`,
);
