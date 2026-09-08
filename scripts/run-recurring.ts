/**
 * Idempotent catch-up of personal monthly due dates.
 *
 * Operators schedule this command with cron. It never prints secrets, file
 * paths, amounts or concepts: the single JSON line reports counts and, when
 * the run did not finish, a closed reason code. Timer installation belongs to
 * operations, not to this repository.
 */

import { runPersonalRecurringCatchUp } from "../src/modules/recurring/server/run-personal-recurring";

const summary = runPersonalRecurringCatchUp();

process.exit(summary.ok ? 0 : 1);
