/**
 * GET /api/preferences against a real, migrated SQLite file.
 *
 * The handler is the real composition: the pipeline opens the file, the
 * workspace comes from the database and the clock reports Madrid civil days.
 * Only the environment map, the connection opener, the clock and the log sink
 * are injected, which are the process boundaries a test must own.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as preferencesRoute from "../../../src/app/api/preferences/route";
import {
  PREFERENCES_CURRENCY,
  PREFERENCES_LOCALE,
  PREFERENCES_TIME_ZONE,
} from "../../../src/modules/preferences/contracts";
import { createGetPreferencesHandler } from "../../../src/modules/preferences/server/preference-http";
import { SystemClock } from "../../../src/shared/domain/clock";
import {
  parseLocalDate,
  type LocalDate,
} from "../../../src/shared/domain/dates";
import {
  API_CACHE_CONTROL,
  API_DYNAMIC,
  API_REVALIDATE,
  API_RUNTIME,
} from "../../../src/shared/server/http";
import { createServerComposition } from "../../../src/shared/server/composition";
import {
  getSqliteConnection,
  openSqliteConnection,
} from "../../../src/shared/server/database";
import { initializeDatabase } from "../../../src/shared/server/initialize";
import { loadAppConfig } from "../../../src/shared/server/config";
import {
  APP_ORIGIN,
  buildRequest,
  createHttpFixture,
  createLogCollector,
  openConnectionFrom,
  readEnvelope,
  type HttpFixture,
} from "./helpers";
import {
  createTemporarySqliteFile,
  createValidAppEnv,
} from "../helpers/sqlite";

function civilDate(text: string): LocalDate {
  const parsed = parseLocalDate(text);

  if (!parsed.ok) {
    throw new Error(`Expected "${text}" to be a valid date`);
  }

  return parsed.value;
}

function preferenceDeps(fixture: HttpFixture, clock?: SystemClock) {
  const logs = createLogCollector();

  return {
    logs,
    deps: {
      env: fixture.env,
      openConnection: openConnectionFrom,
      logger: logs.logger,
      ...(clock === undefined ? {} : { clock }),
    },
  };
}

describe("GET /api/preferences", () => {
  let fixture: HttpFixture;

  beforeEach(() => {
    fixture = createHttpFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it("returns the fixed personal configuration and a Madrid today under UTC", async () => {
    const { deps } = preferenceDeps(
      fixture,
      new SystemClock(() => new Date("2025-12-31T23:30:00Z")),
    );
    const response = await createGetPreferencesHandler(deps)(
      buildRequest({
        path: "/api/preferences",
        origin: null,
        contentType: null,
      }),
    );
    const envelope = await readEnvelope(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(API_CACHE_CONTROL);
    expect(API_CACHE_CONTROL).toBe("no-store");
    expect(envelope).toEqual({
      data: {
        locale: PREFERENCES_LOCALE,
        currency: PREFERENCES_CURRENCY,
        timeZone: PREFERENCES_TIME_ZONE,
        today: "2026-01-01",
      },
      requestId: expect.any(String),
    });
  });

  it("keeps the Madrid summer day when UTC is still the previous date", async () => {
    const { deps } = preferenceDeps(
      fixture,
      new SystemClock(() => new Date("2026-07-15T22:30:00Z")),
    );
    const response = await createGetPreferencesHandler(deps)(
      buildRequest({ path: "/api/preferences" }),
    );
    const envelope = (await readEnvelope(response)) as {
      data: { today: string };
    };

    expect(response.status).toBe(200);
    expect(envelope.data.today).toBe("2026-07-16");
    expect(civilDate(envelope.data.today)).toBe("2026-07-16");
  });

  it("uses the composed request identifier when the client does not propose one", async () => {
    const { deps } = preferenceDeps(
      fixture,
      new SystemClock(() => new Date("2026-09-06T10:00:00Z")),
    );
    const response = await createGetPreferencesHandler({
      ...deps,
      createRequestId: () => "composed-request",
      now: () => 1_000,
    })(buildRequest({ path: "/api/preferences" }));
    const envelope = (await readEnvelope(response)) as { requestId: string };

    expect(response.status).toBe(200);
    expect(envelope.requestId).toBe("composed-request");
    expect(response.headers.get("x-request-id")).toBe("composed-request");
  });

  it("preserves the fixed preferences after a process restart on the same file", async () => {
    const file = createTemporarySqliteFile();
    const env = createValidAppEnv(file.filePath, { APP_URL: APP_ORIGIN });
    const firstConfig = loadAppConfig(env);

    expect(firstConfig.ok).toBe(true);
    if (!firstConfig.ok) {
      file.cleanup();
      return;
    }

    const firstOpen = openSqliteConnection(firstConfig.value);
    expect(firstOpen.ok).toBe(true);
    if (!firstOpen.ok) {
      file.cleanup();
      return;
    }

    const initialized = initializeDatabase(firstOpen.value, {
      now: () => 1_746_268_800_000,
      seedCategories: false,
    });
    expect(initialized.ok).toBe(true);
    firstOpen.value.close();

    const first = await createGetPreferencesHandler({
      env,
      openConnection: openConnectionFrom,
      clock: new SystemClock(() => new Date("2026-01-01T10:00:00Z")),
    })(buildRequest({ path: "/api/preferences" }));
    const firstBody = await readEnvelope(first);

    const secondOpen = openSqliteConnection(firstConfig.value);
    expect(secondOpen.ok).toBe(true);
    if (!secondOpen.ok) {
      file.cleanup();
      return;
    }

    const restarted = initializeDatabase(secondOpen.value, {
      now: () => 2_000_000_000_000,
      seedCategories: false,
    });
    expect(restarted.ok).toBe(true);
    if (restarted.ok) {
      expect(restarted.value.createdWorkspace).toBe(false);
    }
    secondOpen.value.close();

    const second = await createGetPreferencesHandler({
      env,
      openConnection: openConnectionFrom,
      clock: new SystemClock(() => new Date("2026-06-15T22:30:00Z")),
    })(buildRequest({ path: "/api/preferences" }));
    const secondBody = (await readEnvelope(second)) as {
      data: {
        locale: string;
        currency: string;
        timeZone: string;
        today: string;
      };
    };
    const firstData = (
      firstBody as {
        data: {
          locale: string;
          currency: string;
          timeZone: string;
        };
      }
    ).data;

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(secondBody.data).toEqual({
      locale: firstData.locale,
      currency: firstData.currency,
      timeZone: firstData.timeZone,
      today: "2026-06-16",
    });
    expect(secondBody.data).toMatchObject({
      locale: "es-ES",
      currency: "EUR",
      timeZone: "Europe/Madrid",
    });

    file.cleanup();
  });
});

describe("preferences route wiring", () => {
  it("declares the Node runtime, stays dynamic and only exposes GET", async () => {
    const file = createTemporarySqliteFile();

    expect(preferencesRoute.runtime).toBe(API_RUNTIME);
    expect(preferencesRoute.dynamic).toBe(API_DYNAMIC);
    expect(preferencesRoute.revalidate).toBe(API_REVALIDATE);
    expect(preferencesRoute).not.toHaveProperty("POST");
    expect(preferencesRoute).not.toHaveProperty("PUT");
    expect(preferencesRoute).not.toHaveProperty("PATCH");
    expect(preferencesRoute).not.toHaveProperty("DELETE");

    const response = await preferencesRoute.GET(
      buildRequest({ path: "/api/preferences" }),
    );

    expect(response.status).toBe(503);
    file.cleanup();
  });
});

describe("server composition", () => {
  it("defers the connection and wires the process opener", () => {
    let opened = 0;
    const logger = () => undefined;
    const env = createValidAppEnv("/tmp/personal-finance.sqlite");
    const composition = createServerComposition({
      env,
      logger,
      now: () => 1_000,
      createRequestId: () => "composed-id",
      openConnection: (source) => {
        opened += 1;
        return openConnectionFrom(source);
      },
    });

    expect(opened).toBe(0);
    expect(composition.handlerDeps.env).toBe(env);
    expect(composition.handlerDeps.logger).toBe(logger);
    expect(composition.handlerDeps.now?.()).toBe(1_000);
    expect(composition.handlerDeps.createRequestId?.()).toBe("composed-id");

    const defaults = createServerComposition();

    expect(defaults.handlerDeps.openConnection).toBe(getSqliteConnection);
    expect(defaults.clock.today()).toEqual(expect.any(String));
  });

  it("keeps feature modules and composition free of route imports", () => {
    const roots = [
      join(process.cwd(), "src/modules"),
      join(process.cwd(), "src/shared/server/composition.ts"),
    ];
    const files = roots.flatMap((root) => collectTypeScript(root));
    const offenders = files.filter((file) => {
      const text = readFileSync(file, "utf8");
      return /from ["'][^"']*app\/api/.test(text);
    });

    expect(offenders).toEqual([]);
  });
});

function collectTypeScript(path: string): string[] {
  const stats = statSync(path);

  if (stats.isFile()) {
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  }

  return readdirSync(path).flatMap((entry) =>
    collectTypeScript(join(path, entry)),
  );
}
