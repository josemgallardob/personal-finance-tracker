import { existsSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import * as demoSessionRoute from "../../../src/app/api/demo/session/route";
import { createGetPreferencesHandler } from "../../../src/modules/preferences/server/preference-http";
import {
  APPLICATION_MODE_COOKIE,
  resolveApplicationMode,
} from "../../../src/modules/preferences/server/mode";
import { createPostDemoSessionHandler } from "../../../src/modules/preferences/server/demo-session-http";
import { DEMO_DATABASE_PATH_ENV } from "../../../src/shared/server/config";
import {
  closeSqliteConnection,
  getSqliteConnection,
} from "../../../src/shared/server/database";
import { initializeDatabase } from "../../../src/shared/server/initialize";
import { APP_ORIGIN, buildRequest, readEnvelope } from "../http/helpers";
import {
  createTemporarySqliteFile,
  createValidAppEnv,
  type TemporarySqliteFile,
} from "../helpers/sqlite";

const files: TemporarySqliteFile[] = [];

afterEach(() => {
  closeSqliteConnection();
  while (files.length > 0) {
    files.pop()?.cleanup();
  }
});

function createModeEnvironment() {
  const personal = createTemporarySqliteFile();
  const demo = createTemporarySqliteFile();
  files.push(personal, demo);

  return {
    personal,
    demo,
    env: createValidAppEnv(personal.filePath, {
      [DEMO_DATABASE_PATH_ENV]: demo.filePath,
      APP_URL: APP_ORIGIN,
    }),
  };
}

function requireConnection(
  env: Record<string, string | undefined>,
  mode: "personal" | "demo",
) {
  const opened = getSqliteConnection(env, mode);

  expect(opened.ok).toBe(true);
  if (!opened.ok) {
    throw new Error(`Expected an open SQLite file: ${opened.error.code}`);
  }

  return opened.value;
}

describe("application mode", () => {
  it("accepts only a single personal or demo mode cookie", () => {
    expect(resolveApplicationMode(null)).toEqual({
      ok: true,
      value: "personal",
    });
    expect(resolveApplicationMode("mode=demo")).toEqual({
      ok: true,
      value: "demo",
    });
    expect(resolveApplicationMode("mode=personal")).toEqual({
      ok: true,
      value: "personal",
    });

    for (const cookie of [
      "mode=../personal-finance.sqlite",
      "mode=%2Fetc%2Fpasswd",
      "mode=workspaceId",
      "mode=demo; mode=personal",
    ]) {
      expect(resolveApplicationMode(cookie)).toEqual({
        ok: false,
        failure: {
          code: "validationFailed",
          status: 422,
          details: [{ field: "cookie.mode", code: "invalidValue" }],
        },
      });
    }
  });

  it("keeps distinct real SQLite files across selection changes and restart", async () => {
    const { env, personal, demo } = createModeEnvironment();
    const personalConnection = requireConnection(env, "personal");
    const demoConnection = requireConnection(env, "demo");

    expect(personalConnection.filePath).toBe(personal.filePath);
    expect(demoConnection.filePath).toBe(demo.filePath);
    expect(
      initializeDatabase(personalConnection, { seedCategories: false }).ok,
    ).toBe(true);
    expect(
      initializeDatabase(demoConnection, { seedCategories: false }).ok,
    ).toBe(true);

    personalConnection.sqlite.exec(
      "CREATE TABLE mode_probe (label TEXT NOT NULL); INSERT INTO mode_probe VALUES ('personal');",
    );
    demoConnection.sqlite.exec(
      "CREATE TABLE mode_probe (label TEXT NOT NULL); INSERT INTO mode_probe VALUES ('demo');",
    );

    const preferences = createGetPreferencesHandler({
      env,
      openConnection: getSqliteConnection,
    });
    const demoResponse = await preferences(
      buildRequest({
        path: "/api/preferences",
        headers: { cookie: "mode=demo" },
      }),
    );
    const personalResponse = await preferences(
      buildRequest({ path: "/api/preferences" }),
    );

    expect(
      ((await readEnvelope(demoResponse)) as { data: { mode: string } }).data
        .mode,
    ).toBe("demo");
    expect(
      ((await readEnvelope(personalResponse)) as { data: { mode: string } })
        .data.mode,
    ).toBe("personal");

    closeSqliteConnection();

    const restartedPersonal = requireConnection(env, "personal");
    const restartedDemo = requireConnection(env, "demo");
    expect(
      restartedPersonal.sqlite.prepare("SELECT label FROM mode_probe").all(),
    ).toEqual([{ label: "personal" }]);
    expect(
      restartedDemo.sqlite.prepare("SELECT label FROM mode_probe").all(),
    ).toEqual([{ label: "demo" }]);
  });
});

describe("POST /api/demo/session", () => {
  it("changes only the session selection with a secure cookie contract", async () => {
    const { env, personal, demo } = createModeEnvironment();
    const response = await createPostDemoSessionHandler({ env })(
      buildRequest({
        method: "POST",
        path: "/api/demo/session",
        body: JSON.stringify({ mode: "demo" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await readEnvelope(response)).toEqual({
      data: { mode: "demo" },
      requestId: expect.any(String),
    });
    expect(response.headers.get("set-cookie")).toBe(
      `${APPLICATION_MODE_COOKIE}=demo; Path=/; HttpOnly; SameSite=Lax`,
    );
    expect(existsSync(personal.filePath)).toBe(false);
    expect(existsSync(demo.filePath)).toBe(false);
  });

  it("rejects path and workspace inputs through the shared HTTP validation", async () => {
    const { env } = createModeEnvironment();
    const handler = createPostDemoSessionHandler({ env });

    for (const body of [
      { mode: "../demo.sqlite" },
      { mode: "demo", databasePath: "/tmp/forged.sqlite" },
      { mode: "demo", workspaceId: "forged" },
    ]) {
      const response = await handler(
        buildRequest({
          method: "POST",
          path: "/api/demo/session",
          body: JSON.stringify(body),
        }),
      );

      expect(response.status).toBe(422);
      expect(await readEnvelope(response)).toMatchObject({
        error: { code: "validationFailed" },
      });
    }
  });

  it("uses the route runtime contract", () => {
    expect(demoSessionRoute.runtime).toBe("nodejs");
    expect(demoSessionRoute.dynamic).toBe("force-dynamic");
    expect(demoSessionRoute.revalidate).toBe(0);
    expect(demoSessionRoute).toHaveProperty("POST");
    expect(demoSessionRoute).not.toHaveProperty("GET");
  });
});
