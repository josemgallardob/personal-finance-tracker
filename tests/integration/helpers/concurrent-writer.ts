/**
 * Child process that keeps writing movements while a snapshot is taken.
 *
 * A snapshot is only trustworthy if it can be produced against a database that
 * is actually in use, so this writer commits a movement together with its tag
 * association in a single transaction, in a loop, until the parent test stops
 * it. It prints `ready` after the first commit so the parent never snapshots
 * an idle file.
 */

import { insertMovement, openDatabase } from "./backup";

const [databasePath, workspaceId] = process.argv.slice(2);
const connection = openDatabase(databasePath);

let running = true;
let index = 0;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    running = false;
  });
}

while (running) {
  insertMovement(connection, workspaceId, index);
  index += 1;

  if (index === 1) {
    process.stdout.write("ready\n");
  }

  await new Promise((resolve) => setImmediate(resolve));
}

connection.close();
process.stdout.write(`written ${index}\n`);
