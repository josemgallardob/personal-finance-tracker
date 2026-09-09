/**
 * Contract checks for private-host installation templates.
 *
 * These checks keep repository templates from accidentally publishing a port,
 * bypassing Compose configuration/volumes, or turning the daily job into a
 * second web service. A real tailnet, systemd manager and device browser need
 * owner-run smoke evidence and are intentionally not simulated here.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = dirname(
  dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
);

function read(name: string): string {
  return readFileSync(join(repositoryRoot, name), "utf8");
}

const runbook = read("operations/README.md");
const caddyfile = read("operations/caddy/Caddyfile");
const service = read("operations/systemd/personal-finance-recurring.service");
const timer = read("operations/systemd/personal-finance-recurring.timer");
const cron = read("operations/cron/personal-finance-recurring");

const recurringCommand =
  "docker compose run --rm --no-deps --entrypoint npm app run recurring:run";

describe("private operations templates", () => {
  it("keeps the HTTPS proxy on the Tailscale address and loopback upstream", () => {
    expect(caddyfile).toContain("https://__TAILSCALE_DNS_NAME__");
    expect(caddyfile).toContain("bind __TAILSCALE_IPV4__");
    expect(caddyfile).toContain(
      "tls /etc/personal-finance-tracker/tailscale.crt /etc/personal-finance-tracker/tailscale.key",
    );
    expect(caddyfile).toContain("reverse_proxy 127.0.0.1:__APP_PORT__");
    expect(caddyfile).not.toMatch(/reverse_proxy\s+(?:0\.0\.0\.0|__TAILSCALE)/);
  });

  it("uses the same Compose app configuration without publishing a scheduler port", () => {
    expect(service).toContain(`ExecStart=/usr/bin/env ${recurringCommand}`);
    expect(cron).toContain(recurringCommand);

    for (const template of [service, cron]) {
      const directives = template
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("#"))
        .join("\n");

      expect(directives).not.toContain("--service-ports");
      expect(directives).not.toMatch(/\b(?:ports|publish)\b/);
    }
  });

  it("uses one daily persistent systemd activation for restart catch-up", () => {
    expect(timer).toContain("OnCalendar=*-*-* 03:17:00");
    expect(timer).toContain("Persistent=true");
    expect(timer).toContain("RandomizedDelaySec=15m");
    expect(timer).toContain("Unit=personal-finance-recurring.service");
    expect(timer).toContain("WantedBy=timers.target");
  });

  it("documents the private access and external-evidence boundary", () => {
    expect(runbook).toContain("Never enable or run `tailscale funnel`.");
    expect(runbook).toContain("APP_URL=https://__TAILSCALE_DNS_NAME__");
    expect(runbook).toContain("HTTP 403");
    expect(runbook).toContain("macOS and an authorized mobile device");
    expect(runbook).toContain("reconfigure, or reuse an Orca");
    expect(runbook).toContain("Do not report this\ndeployment as complete");
  });
});
