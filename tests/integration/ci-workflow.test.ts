/**
 * Contract of the mandatory continuous-integration gates.
 *
 * The release criteria depend on a pull request being blocked by a run that
 * really exercises the product: static checks, the unit and integration suites
 * under their coverage thresholds, a production build, the end-to-end suite, a
 * secret scan and a dependency audit. A workflow keeps passing after any of
 * those steps is dropped, renamed away or made non-blocking, so nothing in the
 * repository notices the loss. These assertions read the real workflow file and
 * the real runner configuration and fail when a gate disappears, when a
 * threshold is lowered below the documented minimum, or when a step is allowed
 * to fail without failing the job.
 *
 * The remote branch-protection rules that mark a check as required are host
 * configuration and cannot be asserted from the repository; they are audited
 * separately.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import vitestConfig from "../../vitest.config";

const repositoryRoot = dirname(
  dirname(dirname(fileURLToPath(import.meta.url))),
);

const workflow = readFileSync(
  join(repositoryRoot, ".github/workflows/ci.yml"),
  "utf8",
);

const packageJson = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8"),
) as { scripts: Record<string, string> };

/** Returns the block of the named job, up to the next top-level job. */
function job(name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  expect(start).toBeGreaterThan(-1);

  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}\S+:\n/);

  return next === -1 ? rest : rest.slice(0, next + 1);
}

const qualityJob = job("quality");
const e2eJob = job("e2e");

describe("continuous-integration triggers", () => {
  it("publishes the check on pull requests against main and stable", () => {
    expect(workflow).toMatch(
      /on:\n {2}pull_request:\n {4}branches:\n {6}- main\n {6}- stable\n/,
    );
  });

  it("re-runs the same quality on the merge group that integrates the commit", () => {
    expect(workflow).toMatch(
      /merge_group:\n {4}types:\n {6}- checks_requested\n/,
    );
  });

  it("does not rely on a post-merge push run as the integration gate", () => {
    expect(workflow).not.toMatch(/^ {2}push:$/m);
  });
});

describe("mandatory quality gates", () => {
  it.each([
    ["formatting", "npm run format:check"],
    ["lint", "npm run lint"],
    ["types", "npm run typecheck"],
    ["unit and integration coverage", "npm run test:coverage"],
    ["clean migrations", "npm run verify:clean-migrations"],
    ["production build", "npm run verify:build-without-database"],
    ["secret scan", "npm run security:secrets"],
  ])("runs the %s gate", (_gate, command) => {
    expect(qualityJob).toContain(`run: ${command}`);
  });

  it("audits dependencies and fails on a high severity advisory", () => {
    expect(qualityJob).toContain("run: npm audit --audit-level=high");
  });

  it("runs the end-to-end suite against a production build in its own job", () => {
    expect(e2eJob).toContain("run: npm run verify:build-without-database");
    expect(e2eJob).toContain("run: npm run test:e2e");
  });

  it("keeps every step blocking", () => {
    expect(workflow).not.toContain("continue-on-error");
    expect(workflow).not.toContain("if: always()");
    expect(workflow).not.toContain("|| true");
  });

  it("installs dependencies from the committed lockfile in both jobs", () => {
    expect(qualityJob).toContain("run: npm ci");
    expect(e2eJob).toContain("run: npm ci");
  });
});

describe("gate commands exist in the package manifest", () => {
  it.each([
    "format:check",
    "lint",
    "typecheck",
    "test:coverage",
    "verify:clean-migrations",
    "verify:build-without-database",
    "security:secrets",
    "test:e2e",
  ])("declares the %s script", (script) => {
    expect(packageJson.scripts[script]).toBeDefined();
  });

  it("measures coverage while running the tests, not in a separate pass", () => {
    expect(packageJson.scripts["test:coverage"]).toContain("--coverage");
  });
});

describe("coverage thresholds enforced by the runner", () => {
  const thresholds = vitestConfig.test?.coverage?.thresholds;

  it.each([
    ["lines", 90],
    ["statements", 90],
    ["functions", 90],
    ["branches", 85],
  ])("keeps the %s threshold at or above %i per cent", (metric, minimum) => {
    expect(thresholds?.[metric as "lines"]).toBeGreaterThanOrEqual(minimum);
  });

  it("measures the application source rather than the tests", () => {
    expect(vitestConfig.test?.coverage?.include).toEqual(["src/**/*.{ts,tsx}"]);
  });

  it("declares no coverage exclusion", () => {
    expect(vitestConfig.test?.coverage?.exclude).toBeUndefined();
  });

  it("runs the integration suite in the same coverage run as the unit suite", () => {
    const projects = vitestConfig.test?.projects ?? [];
    const includes = projects.flatMap((project) =>
      typeof project === "object" && project !== null && "test" in project
        ? ((project.test?.include ?? []) as readonly string[])
        : [],
    );

    expect(includes).toContain("src/**/*.{test,spec}.{ts,tsx}");
    expect(includes).toContain("tests/integration/**/*.{test,spec}.ts");
  });
});
