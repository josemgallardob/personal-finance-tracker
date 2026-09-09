/**
 * Retention boundaries and destination ownership.
 *
 * Retention deletes data, so two properties are checked explicitly: the plan
 * keeps the newest artifact of each of the last 7 days, 4 ISO weeks and 12
 * months, and it can only ever propose names the destination reported as
 * owned. Any other file in the destination — an operator note, a foreign
 * backup, an in-flight partial upload — must survive untouched.
 */

import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  ARTIFACT_PARTIAL_SUFFIX,
  formatArtifactName,
} from "../../../src/shared/server/backup/artifact";
import {
  createLocalDirectoryDestination,
  LOCAL_DIRECTORY_SCHEME,
  resolveDestinationUri,
} from "../../../src/shared/server/backup/destination";
import { encryptFile } from "../../../src/shared/server/backup/encryption";
import {
  DAILY_RETENTION,
  DEFAULT_RETENTION_LIMITS,
  MONTHLY_RETENTION,
  planRetention,
  WEEKLY_RETENTION,
} from "../../../src/shared/server/backup/retention";
import { createBackupWorkspace, type BackupWorkspace } from "../helpers/backup";

const workspaces: BackupWorkspace[] = [];

afterEach(() => {
  while (workspaces.length > 0) {
    workspaces.pop()?.cleanup();
  }
});

function createWorkspace(): BackupWorkspace {
  const workspace = createBackupWorkspace();
  workspaces.push(workspace);
  return workspace;
}

/** Builds a candidate for the instant described by an ISO string. */
function candidate(iso: string): {
  readonly name: string;
  readonly createdAt: Date;
} {
  const createdAt = new Date(iso);

  return { name: formatArtifactName(createdAt), createdAt };
}

/** Daily candidates for `count` consecutive days ending on `lastDay`. */
function dailySeries(lastDay: string, count: number) {
  const last = new Date(`${lastDay}T02:00:00Z`);

  return Array.from({ length: count }, (_, offset) => {
    const createdAt = new Date(last);
    createdAt.setUTCDate(createdAt.getUTCDate() - offset);
    return { name: formatArtifactName(createdAt), createdAt };
  });
}

describe("retention limits", () => {
  it("matches the retention required by the technical design", () => {
    expect(DEFAULT_RETENTION_LIMITS).toEqual({
      daily: DAILY_RETENTION,
      weekly: WEEKLY_RETENTION,
      monthly: MONTHLY_RETENTION,
    });
    expect([DAILY_RETENTION, WEEKLY_RETENTION, MONTHLY_RETENTION]).toEqual([
      7, 4, 12,
    ]);
  });

  it("keeps nothing to remove when the destination is empty", () => {
    expect(planRetention([])).toEqual({ keep: [], remove: [] });
  });

  it("orders artifacts that share an instant by name so the plan is stable", () => {
    const createdAt = new Date("2026-03-10T02:00:00Z");
    const first = { name: "artifact-a", createdAt };
    const second = { name: "artifact-b", createdAt };
    const limits = { daily: 1, weekly: 1, monthly: 1 };

    const plan = planRetention([first, second], limits);

    expect(plan).toEqual({ keep: ["artifact-b"], remove: ["artifact-a"] });
    expect(planRetention([second, first], limits)).toEqual(plan);
  });
});

describe("daily boundary", () => {
  it("keeps the seven most recent days and only the newest copy of each", () => {
    const series = dailySeries("2026-03-10", 8);
    const olderSameDay = candidate("2026-03-10T01:00:00Z");

    const plan = planRetention([...series, olderSameDay]);

    for (const kept of series.slice(0, DAILY_RETENTION)) {
      expect(plan.keep).toContain(kept.name);
    }

    // A second run on the same day is not the representative of that day, and
    // its week and month are already represented by a newer artifact.
    expect(plan.remove).toContain(olderSameDay.name);

    // 2026-03-10 is a Tuesday, so the eighth day still belongs to the ISO week
    // already represented by 2026-03-08: nothing protects it any more.
    expect(series[7].createdAt.toISOString()).toBe("2026-03-03T02:00:00.000Z");
    expect(plan.remove).toEqual([olderSameDay.name, series[7].name]);
    expect(plan.keep).toHaveLength(DAILY_RETENTION);
  });

  it("keeps an older day when it is the only artifact of its ISO week", () => {
    const series = dailySeries("2026-03-10", 10);
    const plan = planRetention(series);

    // 2026-03-01 is a Sunday and closes the previous ISO week, so the weekly
    // rule protects it even though the daily window stops at 2026-03-04.
    expect(series[9].createdAt.toISOString()).toBe("2026-03-01T02:00:00.000Z");
    expect(plan.keep).toContain(series[9].name);
    expect(plan.remove).toEqual([series[7].name, series[8].name]);
    expect(plan.keep).toHaveLength(DAILY_RETENTION + 1);
  });
});

describe("weekly and monthly boundaries", () => {
  it("keeps one artifact for each of the four most recent ISO weeks", () => {
    const weekly = [
      candidate("2026-03-09T02:00:00Z"),
      candidate("2026-03-02T02:00:00Z"),
      candidate("2026-02-23T02:00:00Z"),
      candidate("2026-02-16T02:00:00Z"),
      candidate("2026-02-09T02:00:00Z"),
    ];

    const plan = planRetention(weekly, {
      daily: 1,
      weekly: WEEKLY_RETENTION,
      monthly: 1,
    });

    expect(plan.keep).toEqual(
      weekly.slice(0, WEEKLY_RETENTION).map((c) => c.name),
    );
    expect(plan.remove).toEqual([weekly[4].name]);
  });

  it("treats the turn of the year as a single ISO week", () => {
    const endOfYear = candidate("2025-12-29T02:00:00Z");
    const startOfYear = candidate("2026-01-01T02:00:00Z");

    // Two free weekly slots are offered. Both artifacts belong to ISO week
    // 2026-W01, so the second slot stays unused and the December artifact is
    // removed; a calendar-year week key would have kept it.
    expect(
      planRetention([startOfYear, endOfYear], {
        daily: 1,
        weekly: 2,
        monthly: 1,
      }),
    ).toEqual({ keep: [startOfYear.name], remove: [endOfYear.name] });

    // The same pair is kept in full once each month may hold one artifact.
    expect(
      planRetention([startOfYear, endOfYear], {
        daily: 1,
        weekly: 1,
        monthly: 2,
      }),
    ).toEqual({ keep: [startOfYear.name, endOfYear.name], remove: [] });
  });

  it("keeps one artifact for each of the twelve most recent months", () => {
    const monthly = Array.from({ length: 14 }, (_, offset) =>
      candidate(
        `${2026 - Math.floor((offset + 1) / 12)}-${String(
          ((14 - offset - 1) % 12) + 1,
        ).padStart(2, "0")}-15T02:00:00Z`,
      ),
    );
    const ordered = [...monthly].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );

    const plan = planRetention(ordered, {
      daily: 1,
      weekly: 1,
      monthly: MONTHLY_RETENTION,
    });

    expect(plan.keep).toHaveLength(MONTHLY_RETENTION);
    expect(plan.remove).toHaveLength(ordered.length - MONTHLY_RETENTION);
    expect(plan.remove).toEqual(
      ordered.slice(MONTHLY_RETENTION).map((entry) => entry.name),
    );
  });
});

describe("destination ownership", () => {
  it("resolves a local directory URI and refuses every other provider", () => {
    const workspace = createWorkspace();

    expect(
      resolveDestinationUri(pathToFileURL(workspace.destinationPath).href),
    ).toEqual({ ok: true, value: { directory: workspace.destinationPath } });

    for (const unsupported of [
      "s3://finance-backups/personal",
      "https://example.invalid/backups",
      "sftp://backup.invalid/personal",
    ]) {
      expect(resolveDestinationUri(unsupported)).toEqual({
        ok: false,
        error: "unsupportedDestinationScheme",
      });
    }

    expect(resolveDestinationUri("/var/backups")).toEqual({
      ok: false,
      error: "invalidDestinationUri",
    });
    expect(resolveDestinationUri("file://remote-host/backups")).toEqual({
      ok: false,
      error: "invalidDestinationUri",
    });
  });

  it("lists and deletes only artifacts this tool produced", async () => {
    const workspace = createWorkspace();
    const destination = createLocalDirectoryDestination(
      workspace.destinationPath,
    );
    const artifactName = formatArtifactName(new Date("2026-03-04T02:00:00Z"));
    const plaintextPath = join(workspace.directory, "snapshot.sqlite");

    expect(destination.scheme).toBe(LOCAL_DIRECTORY_SCHEME);
    writeFileSync(plaintextPath, "snapshot", "utf8");
    expect(
      (
        await encryptFile(
          plaintextPath,
          join(workspace.directory, artifactName),
          workspace.key,
          artifactName,
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await destination.upload(
          join(workspace.directory, artifactName),
          artifactName,
        )
      ).ok,
    ).toBe(true);

    // Files this tool never wrote: a foreign backup, an operator note, an
    // artifact-shaped name without the signature and an in-flight partial.
    const foreignName = formatArtifactName(new Date("2026-03-03T02:00:00Z"));
    writeFileSync(join(workspace.destinationPath, foreignName), "not ours");
    writeFileSync(join(workspace.destinationPath, "README.txt"), "notes");
    writeFileSync(
      join(
        workspace.destinationPath,
        `${artifactName}${ARTIFACT_PARTIAL_SUFFIX}`,
      ),
      "partial",
    );

    const listed = await destination.listOwnedArtifacts();

    expect(listed.ok && listed.value.map((entry) => entry.name)).toEqual([
      artifactName,
    ]);

    expect(await destination.remove(foreignName)).toEqual({
      ok: false,
      error: "notAnOwnedArtifact",
    });
    expect(await destination.remove("README.txt")).toEqual({
      ok: false,
      error: "notAnOwnedArtifact",
    });
    expect(await destination.remove(artifactName)).toEqual({
      ok: true,
      value: undefined,
    });

    expect(readdirSync(workspace.destinationPath).sort()).toEqual(
      [
        "README.txt",
        `${artifactName}${ARTIFACT_PARTIAL_SUFFIX}`,
        foreignName,
      ].sort(),
    );
  });

  it("refuses to upload under a name this tool does not own", async () => {
    const workspace = createWorkspace();
    const destination = createLocalDirectoryDestination(
      workspace.destinationPath,
    );
    const plaintextPath = join(workspace.directory, "snapshot.sqlite");

    writeFileSync(plaintextPath, "snapshot", "utf8");

    expect(await destination.upload(plaintextPath, "snapshot.sqlite")).toEqual({
      ok: false,
      error: "notAnOwnedArtifact",
    });
  });

  it("reports a listing failure instead of an empty destination", async () => {
    const workspace = createWorkspace();
    const destination = createLocalDirectoryDestination(
      join(workspace.directory, "absent"),
    );

    expect(await destination.listOwnedArtifacts()).toEqual({
      ok: false,
      error: "listFailed",
    });
  });

  it("reports a deletion that the destination refuses", async () => {
    const workspace = createWorkspace();
    const artifactName = formatArtifactName(new Date("2026-03-04T02:00:00Z"));
    const plaintextPath = join(workspace.directory, "snapshot.sqlite");

    mkdirSync(workspace.destinationPath, { recursive: true });
    writeFileSync(plaintextPath, "snapshot", "utf8");
    expect(
      (
        await encryptFile(
          plaintextPath,
          join(workspace.destinationPath, artifactName),
          workspace.key,
          artifactName,
        )
      ).ok,
    ).toBe(true);

    const destination = createLocalDirectoryDestination(
      workspace.destinationPath,
    );

    // A read-only destination directory makes the unlink fail while the
    // artifact itself is still a valid, owned backup.
    const { chmodSync } = await import("node:fs");
    chmodSync(workspace.destinationPath, 0o500);

    try {
      expect(await destination.remove(artifactName)).toEqual({
        ok: false,
        error: "removeFailed",
      });
    } finally {
      chmodSync(workspace.destinationPath, 0o700);
    }
  });
});
