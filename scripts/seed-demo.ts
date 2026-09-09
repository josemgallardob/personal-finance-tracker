/**
 * Replaces the isolated demonstration database with its fictional fixture.
 *
 * It deliberately resolves only the fixed demo path and never reads a session
 * cookie or opens the personal file.
 */

import { SystemClock } from "../src/shared/domain/clock";
import {
  closeSqliteConnection,
  getDemoSqliteConnection,
} from "../src/shared/server/database";
import { initializeDatabase } from "../src/shared/server/initialize";
import { seedDemoDatabase } from "../src/modules/preferences/application/demo/seed-demo";

const opened = getDemoSqliteConnection();

if (!opened.ok) {
  console.error("Could not open the demo SQLite database.", opened.error);
  process.exit(1);
}

const initialized = initializeDatabase(opened.value);

if (!initialized.ok) {
  closeSqliteConnection();
  console.error("Demo database initialization failed.", initialized.error);
  process.exit(1);
}

const seeded = seedDemoDatabase(opened.value, new SystemClock());
closeSqliteConnection();

if (!seeded.ok) {
  console.error("Demo database seed failed.", seeded.error);
  process.exit(1);
}

console.log(
  `Seeded ${seeded.value.transactionCount} fictional transactions and ${seeded.value.recurringRuleCount} recurrence.`,
);
