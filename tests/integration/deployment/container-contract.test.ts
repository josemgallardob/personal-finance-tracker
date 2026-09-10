/**
 * Contract of the container templates that operations deploys.
 *
 * These assertions read the real files that the private deployment ships:
 * image definition, Compose file, build-context exclusions, entry point and
 * the environment template. They verify the properties a container runtime
 * cannot be asked about here — unprivileged runtime user, separate durable
 * volumes, loopback publication, deterministic install and credentials that
 * only ever arrive from the environment. Running an actual image build and a
 * real recreate cycle belongs to the deployment host, which has a container
 * runtime; this suite is the repository-side gate that keeps those templates
 * from drifting.
 */

import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = dirname(
  dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
);

function read(name: string): string {
  return readFileSync(join(repositoryRoot, name), "utf8");
}

const dockerfile = read("Dockerfile");
const compose = read("compose.yml");
const dockerignore = read(".dockerignore");
const entrypoint = read("scripts/container/entrypoint.sh");
const envExample = read(".env.example");
const packageJson = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>;
};

const PERSONAL_VOLUME_PATH = "/data/personal";
const DEMO_VOLUME_PATH = "/data/demo";

describe("container image definition", () => {
  it("installs dependencies from the committed lockfile only", () => {
    expect(dockerfile).toContain("COPY package.json package-lock.json ./");
    expect(dockerfile).toMatch(/RUN npm ci\b/);
    expect(dockerfile).not.toMatch(/RUN npm install/);
  });

  it("keeps native dependency build tools out of the runtime stage", () => {
    const dependenciesStage = dockerfile.slice(
      dockerfile.indexOf("FROM ${NODE_IMAGE} AS dependencies"),
      dockerfile.indexOf("FROM ${NODE_IMAGE} AS build"),
    );
    const runtimeStage = dockerfile.slice(
      dockerfile.indexOf("FROM ${NODE_IMAGE} AS runtime"),
    );

    expect(dependenciesStage).toContain(
      "apt-get install -y --no-install-recommends python3 make g++",
    );
    expect(runtimeStage).not.toContain("apt-get");
    expect(runtimeStage).not.toContain("python3");
    expect(runtimeStage).not.toContain("g++");
  });

  it("pins the base image through a single build argument", () => {
    const baseImages = [...dockerfile.matchAll(/^FROM (\S+)/gm)].map(
      (match) => match[1],
    );

    expect(baseImages.length).toBeGreaterThan(1);
    expect(new Set(baseImages)).toEqual(new Set(["${NODE_IMAGE}"]));
    expect(dockerfile).toMatch(/^ARG NODE_IMAGE=node:\d+/m);
  });

  it("builds the application without any database path available", () => {
    const buildStage = dockerfile
      .slice(
        dockerfile.indexOf("FROM ${NODE_IMAGE} AS build"),
        dockerfile.indexOf("FROM ${NODE_IMAGE} AS runtime"),
      )
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");

    expect(buildStage).toContain("RUN npm run build");
    expect(buildStage).not.toContain("DATABASE_PATH");
    expect(buildStage).not.toContain("DEMO_DATABASE_PATH");
  });

  it("runs as an unprivileged user that owns both data directories", () => {
    expect(dockerfile).toContain(
      `RUN mkdir -p ${PERSONAL_VOLUME_PATH} ${DEMO_VOLUME_PATH}`,
    );
    expect(dockerfile).toContain("chown -R node:node /data /app/.next");

    const userIndex = dockerfile.indexOf("\nUSER node");
    const entrypointIndex = dockerfile.indexOf("\nENTRYPOINT");

    expect(userIndex).toBeGreaterThan(-1);
    expect(entrypointIndex).toBeGreaterThan(userIndex);
    expect(dockerfile).not.toMatch(/^USER root/m);
  });

  it("keeps the personal and demonstration files on separate volumes", () => {
    expect(dockerfile).toContain(
      `DATABASE_PATH=${PERSONAL_VOLUME_PATH}/personal-finance.db`,
    );
    expect(dockerfile).toContain(
      `DEMO_DATABASE_PATH=${DEMO_VOLUME_PATH}/personal-finance-demo.db`,
    );
  });

  it("starts through the migrate, catch-up and serve entry point", () => {
    expect(dockerfile).toContain(
      'ENTRYPOINT ["/app/scripts/container/entrypoint.sh"]',
    );
    expect(dockerfile).toContain("STOPSIGNAL SIGTERM");
  });

  it("bakes no credential and no private origin into a layer", () => {
    const environmentLines = [...dockerfile.matchAll(/^\s*([A-Z_]+)=/gm)].map(
      (match) => match[1],
    );

    expect(environmentLines).not.toContain("APP_URL");

    for (const forbidden of ["PASSWORD", "SECRET", "TOKEN", "KEY"]) {
      expect(dockerfile).not.toContain(forbidden);
    }
  });

  it("binds a non-loopback interface only with the explicit opt-in", () => {
    expect(dockerfile).toContain("HOST=0.0.0.0");
    expect(dockerfile).toContain("ALLOW_NON_LOOPBACK_BIND=true");
  });
});

describe("build context exclusions", () => {
  it("keeps secrets and personal databases out of every layer", () => {
    for (const excluded of [
      ".env",
      "data/",
      "backups/",
      "*.db",
      "*.sqlite",
      ".git",
      "node_modules",
    ]) {
      expect(dockerignore.split("\n")).toContain(excluded);
    }
  });

  it("still allows the committed environment template", () => {
    expect(dockerignore.split("\n")).toContain("!.env.example");
  });

  it("includes only the E2E origin imported by build configuration", () => {
    expect(dockerignore.split("\n")).toEqual(
      expect.arrayContaining([
        "tests",
        "!tests/",
        "tests/*",
        "!tests/e2e/",
        "tests/e2e/*",
        "!tests/e2e/origin.ts",
      ]),
    );
  });
});

describe("compose deployment", () => {
  it("publishes the service on the host loopback address only", () => {
    const published = [...compose.matchAll(/^\s+- "([^"]+)"$/gm)]
      .map((match) => match[1])
      .filter((value) => value.includes(":") && /\d/.test(value));

    expect(published).toContain("127.0.0.1:${APP_PORT:-3000}:3000");
    expect(compose).not.toContain("network_mode: host");
    expect(compose).not.toContain("privileged");
  });

  it("mounts one durable volume per database", () => {
    expect(compose).toContain(`- personal-data:${PERSONAL_VOLUME_PATH}`);
    expect(compose).toContain(`- demo-data:${DEMO_VOLUME_PATH}`);
    expect(compose).toMatch(/^volumes:\n {2}personal-data:\n {2}demo-data:$/m);
  });

  it("pins the container database paths to those volumes", () => {
    expect(compose).toContain(
      `DATABASE_PATH: ${PERSONAL_VOLUME_PATH}/personal-finance.db`,
    );
    expect(compose).toContain(
      `DEMO_DATABASE_PATH: ${DEMO_VOLUME_PATH}/personal-finance-demo.db`,
    );
  });

  it("reads private configuration from the host environment file", () => {
    expect(compose).toMatch(/env_file:\n\s+- \.env/);
    expect(compose).not.toMatch(/APP_URL:\s*\S/);
  });

  it("stops the container cleanly and restarts it after a reboot", () => {
    expect(compose).toContain("init: true");
    expect(compose).toContain("restart: unless-stopped");
    expect(compose).toContain("stop_signal: SIGTERM");
    expect(compose).toContain("stop_grace_period: 30s");
  });

  it("drops every capability and refuses privilege escalation", () => {
    expect(compose).toMatch(/cap_drop:\n\s+- ALL/);
    expect(compose).toMatch(/security_opt:\n\s+- no-new-privileges:true/);
  });
});

describe("entry point and environment template", () => {
  it("replaces the shell so the runtime signals reach the server", () => {
    expect(entrypoint).toMatch(/^exec node .*scripts\/start-server\.ts/m);
    expect(entrypoint).toContain("--conditions=react-server");
    expect(
      statSync(join(repositoryRoot, "scripts/container/entrypoint.sh")).mode &
        0o111,
    ).toBeGreaterThan(0);
  });

  it("documents every required variable without a real secret", () => {
    for (const variable of [
      "DATABASE_PATH",
      "DEMO_DATABASE_PATH",
      "APP_URL",
      "TZ",
      "HOST",
      "PORT",
      "APP_PORT",
    ]) {
      expect(envExample).toMatch(new RegExp(`^${variable}=`, "m"));
    }

    expect(envExample).toMatch(/^HOST=127\.0\.0\.1$/m);
    expect(envExample).toMatch(/^DATABASE_PATH=\.\//m);
    expect(envExample).toMatch(/^DEMO_DATABASE_PATH=\.\//m);
  });

  it("keeps the local development commands on loopback", () => {
    expect(packageJson.scripts.dev).toContain("-H 127.0.0.1");
    expect(packageJson.scripts.start).toContain("-H 127.0.0.1");
    expect(packageJson.scripts["start:server"]).toContain(
      "scripts/start-server.ts",
    );
  });
});
