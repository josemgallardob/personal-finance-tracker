/**
 * Container and server entry point: migrate, bootstrap, catch up, then serve.
 *
 * The sequence is ordered on purpose. A failed migration exits before the HTTP
 * server exists, so the deployment never serves a half-migrated database. When
 * the child server stops, the wrapper reports its exit code so the supervisor
 * can distinguish a clean shutdown from a crash.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  forwardShutdownSignals,
  prepareServer,
  resolveServerExitCode,
} from "../src/shared/server/startup";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function main(): void {
  const prepared = prepareServer();

  if (!prepared.ok) {
    process.exit(1);
  }

  const { host, port } = prepared.value.binding;

  const server = spawn(
    join(repositoryRoot, "node_modules/.bin/next"),
    ["start", "-H", host, "-p", String(port)],
    { cwd: repositoryRoot, stdio: "inherit" },
  );

  const shutdown = forwardShutdownSignals(server);

  server.on("error", () => {
    process.exit(1);
  });

  server.on("exit", (code, signal) => {
    process.exit(resolveServerExitCode(code, signal, shutdown));
  });
}

main();
