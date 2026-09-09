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
const backupService = read(
  "operations/systemd/personal-finance-backup.service",
);
const backupTimer = read("operations/systemd/personal-finance-backup.timer");
const backupCron = read("operations/cron/personal-finance-backup");
const environmentExample = read(".env.example");

const recurringCommand =
  "docker compose run --rm --no-deps --entrypoint npm app run recurring:run";

const backupCommand =
  "docker compose run --rm --no-deps --entrypoint npm " +
  "-v __BACKUP_DESTINATION_DIRECTORY__:/backups " +
  "-v __BACKUP_KEY_FILE__:/run/secrets/backup-key:ro " +
  "-e BACKUP_PATH=/tmp/personal-finance-backup " +
  "-e BACKUP_DESTINATION_URI=file:///backups " +
  "-e BACKUP_ENCRYPTION_KEY_FILE=/run/secrets/backup-key " +
  "app run backup:run";

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

describe("encrypted backup templates", () => {
  it("mounts the destination and the key without publishing a port", () => {
    expect(backupService).toContain(`ExecStart=/usr/bin/env ${backupCommand}`);
    expect(backupCron).toContain(backupCommand);

    for (const template of [backupService, backupCron]) {
      const directives = template
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("#"))
        .join("\n");

      expect(directives).not.toContain("--service-ports");
      expect(directives).not.toMatch(/\b(?:ports|publish)\b/);
      expect(directives).toContain("/run/secrets/backup-key:ro");
    }
  });

  it("runs the backup daily after the recurring catch-up", () => {
    expect(backupTimer).toContain("OnCalendar=*-*-* 04:23:00");
    expect(backupTimer).toContain("Persistent=true");
    expect(backupTimer).toContain("Unit=personal-finance-backup.service");
    expect(backupTimer).toContain("WantedBy=timers.target");
    expect(timer).toContain("OnCalendar=*-*-* 03:17:00");
  });

  it("keeps every backup secret outside the repository", () => {
    // The templates and the example environment may name a key path; they must
    // never carry key material or an inline key variable.
    for (const template of [
      backupService,
      backupCron,
      environmentExample,
      runbook,
    ]) {
      expect(template).not.toMatch(/BACKUP_ENCRYPTION_KEY=/);
    }

    expect(environmentExample).toContain(
      "BACKUP_ENCRYPTION_KEY_FILE=/etc/personal-finance-tracker/backup.key",
    );
    expect(runbook).toContain("openssl rand -base64 32");
    expect(runbook).toContain("sudo chmod 600");
  });

  it("documents the owner decision and the retention it applies", () => {
    expect(runbook).toContain("7 daily / 4 weekly / 12 monthly retention");
    expect(runbook).toContain(
      "### Owner decision required before a real deployment",
    );
    expect(runbook).toContain("unsupportedDestinationScheme");
    expect(runbook).toContain(
      "treat this section as a verified local template, not as\nevidence of an off-site backup",
    );
    expect(runbook).toContain(
      "non-zero whenever the artifact did not reach the destination",
    );
  });
});
