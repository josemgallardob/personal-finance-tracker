/**
 * GET /api/analytics/summary, /evolution and /averages against a real,
 * migrated SQLite file.
 *
 * The handlers are the real composition: the pipeline opens the file, the
 * workspace comes from the database, the aggregations run inside one read
 * snapshot and the responses are the documented DTOs. Only the environment map,
 * the connection opener, the clock and the log sink are injected, which are the
 * process boundaries a test must own.
 *
 * The dataset is fixed and every figure is asserted in exact minor units, so a
 * change of rounding, of window or of drill-down semantics fails here instead
 * of reaching the dashboard.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as averagesRoute from "../../../src/app/api/analytics/averages/route";
import * as evolutionRoute from "../../../src/app/api/analytics/evolution/route";
import * as summaryRoute from "../../../src/app/api/analytics/summary/route";
import {
  createGetAnalyticsAveragesHandler,
  createGetAnalyticsEvolutionHandler,
  createGetAnalyticsSummaryHandler,
} from "../../../src/modules/analytics/server/analytics-http";
import { presentAverageMinor } from "../../../src/modules/analytics/application/dashboard-analytics";
import type { Category } from "../../../src/modules/classification/domain/category";
import type { Tag } from "../../../src/modules/classification/domain/tag";
import { FixedClock } from "../../../src/shared/domain/clock";
import type { LocalDate } from "../../../src/shared/domain/dates";
import {
  MAX_TRANSACTION_MINOR,
  type MoneyMinor,
} from "../../../src/shared/domain/money";
import {
  API_CACHE_CONTROL,
  API_DYNAMIC,
  API_REVALIDATE,
  API_RUNTIME,
} from "../../../src/shared/server/http";
import { archiveCategory } from "../analytics/helpers";
import {
  buildRequest,
  createHttpFixture,
  createLogCollector,
  openConnectionFrom,
  readEnvelope,
  storeCategory,
  storeTag,
  storeTransaction,
  type HttpFixture,
} from "./helpers";

/** Day every handler of this suite reports as today. */
const TODAY = "2026-03-14" as LocalDate;

interface Envelope {
  readonly data: Record<string, unknown>;
  readonly requestId: string;
}

interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
    readonly details?: readonly { field: string; code: string }[];
  };
}

function analyticsDeps(fixture: HttpFixture, today: LocalDate = TODAY) {
  const logs = createLogCollector();

  return {
    logs,
    deps: {
      env: fixture.env,
      openConnection: openConnectionFrom,
      logger: logs.logger,
      clock: new FixedClock(today),
    },
  };
}

function summaryRequest(query: string): Request {
  return buildRequest({
    path: `/api/analytics/summary${query}`,
    contentType: null,
  });
}

async function readSummary(
  fixture: HttpFixture,
  query: string,
  today: LocalDate = TODAY,
): Promise<{ response: Response; body: unknown }> {
  const { deps } = analyticsDeps(fixture, today);
  const response = await createGetAnalyticsSummaryHandler(deps)(
    summaryRequest(query),
  );

  return { response, body: await readEnvelope(response) };
}

async function readEvolution(
  fixture: HttpFixture,
  query = "",
  today: LocalDate = TODAY,
): Promise<{ response: Response; body: unknown }> {
  const { deps } = analyticsDeps(fixture, today);
  const response = await createGetAnalyticsEvolutionHandler(deps)(
    buildRequest({
      path: `/api/analytics/evolution${query}`,
      contentType: null,
    }),
  );

  return { response, body: await readEnvelope(response) };
}

async function readAverages(
  fixture: HttpFixture,
  query = "",
  today: LocalDate = TODAY,
): Promise<{ response: Response; body: unknown }> {
  const { deps } = analyticsDeps(fixture, today);
  const response = await createGetAnalyticsAveragesHandler(deps)(
    buildRequest({
      path: `/api/analytics/averages${query}`,
      contentType: null,
    }),
  );

  return { response, body: await readEnvelope(response) };
}

function data(body: unknown): Record<string, unknown> {
  return (body as Envelope).data;
}

function details(body: unknown): readonly { field: string; code: string }[] {
  return (body as ErrorEnvelope).error.details ?? [];
}

interface Dataset {
  readonly home: Category;
  readonly leisure: Category;
  readonly salary: Category;
  readonly travel: Tag;
  readonly friends: Tag;
}

/**
 * Dataset shared by the endpoint suites.
 *
 * December and January close before today, March is partial, one expense
 * carries two tags so the tag groups overlap, and one expense carries none so
 * the untagged group has an amount of its own.
 */
function seedDataset(fixture: HttpFixture): Dataset {
  const home = storeCategory(fixture, "Hogar", "expense");
  const leisure = storeCategory(fixture, "Ocio", "expense");
  const salary = storeCategory(fixture, "Nomina", "income");
  const travel = storeTag(fixture, "viajes");
  const friends = storeTag(fixture, "con amigos");

  storeTransaction(fixture, {
    category: home,
    amountMinor: 2_000,
    date: "2025-12-20",
  });
  storeTransaction(fixture, {
    category: home,
    amountMinor: 3_001,
    date: "2026-01-10",
  });
  storeTransaction(fixture, {
    category: home,
    amountMinor: 4_000,
    date: "2026-02-14",
    tagIds: [travel.id],
  });
  storeTransaction(fixture, {
    category: salary,
    amountMinor: 100_000,
    date: "2026-02-20",
  });
  storeTransaction(fixture, {
    category: home,
    amountMinor: 5_000,
    date: "2026-03-05",
  });
  storeTransaction(fixture, {
    category: leisure,
    amountMinor: 6_000,
    date: "2026-03-10",
    tagIds: [travel.id, friends.id],
  });
  storeTransaction(fixture, {
    category: salary,
    amountMinor: 200_000,
    date: "2026-03-12",
  });

  return { home, leisure, salary, travel, friends };
}

describe("GET /api/analytics/summary", () => {
  let fixture: HttpFixture;

  beforeEach(() => {
    fixture = createHttpFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it("aggregates the current month against the equivalent previous interval", async () => {
    const dataset = seedDataset(fixture);
    const { response, body } = await readSummary(
      fixture,
      "?period=currentMonth",
    );
    const summary = data(body);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(API_CACHE_CONTROL);
    expect(API_CACHE_CONTROL).toBe("no-store");
    expect(summary.period).toEqual({
      kind: "currentMonth",
      from: null,
      to: null,
    });
    expect(summary.range).toEqual({ start: "2026-03-01", end: "2026-03-14" });
    expect(summary.comparison).toEqual({
      current: { start: "2026-03-01", end: "2026-03-14" },
      previous: { start: "2026-02-01", end: "2026-02-14" },
    });
    expect(summary.totals).toEqual({
      current: {
        incomeMinor: 200_000,
        expenseMinor: 11_000,
        netMinor: 189_000,
        incomeCount: 1,
        expenseCount: 2,
      },
      previous: {
        incomeMinor: 0,
        expenseMinor: 4_000,
        netMinor: -4_000,
        incomeCount: 0,
        expenseCount: 1,
      },
      income: {
        currentMinor: 200_000,
        previousMinor: 0,
        deltaMinor: 200_000,
        deltaPercent: null,
        reason: "noComparisonBase",
      },
      expense: {
        currentMinor: 11_000,
        previousMinor: 4_000,
        deltaMinor: 7_000,
        deltaPercent: 17_500,
        reason: null,
      },
      net: {
        currentMinor: 189_000,
        previousMinor: -4_000,
        deltaMinor: 193_000,
        deltaPercent: 482_500,
        reason: null,
      },
    });
    expect(summary.expenseByCategory).toEqual([
      {
        category: {
          id: dataset.leisure.id,
          name: "Ocio",
          type: "expense",
          isArchived: false,
        },
        totalMinor: 6_000,
        transactionCount: 1,
        drillDown: {
          dateFrom: "2026-03-01",
          dateTo: "2026-03-14",
          type: "expense",
          categoryId: dataset.leisure.id,
          tagIds: [],
          untagged: false,
        },
      },
      {
        category: {
          id: dataset.home.id,
          name: "Hogar",
          type: "expense",
          isArchived: false,
        },
        totalMinor: 5_000,
        transactionCount: 1,
        drillDown: {
          dateFrom: "2026-03-01",
          dateTo: "2026-03-14",
          type: "expense",
          categoryId: dataset.home.id,
          tagIds: [],
          untagged: false,
        },
      },
    ]);
  });

  it("keeps overlapping tag groups apart from the untagged expense", async () => {
    const dataset = seedDataset(fixture);
    const { body } = await readSummary(fixture, "?period=currentMonth");
    const breakdown = data(body).expenseByTag as {
      tags: readonly {
        tag: { id: string; name: string; isArchived: boolean };
        totalMinor: number;
        transactionCount: number;
        drillDown: Record<string, unknown>;
      }[];
      untagged: { totalMinor: number; drillDown: Record<string, unknown> };
      overlapping: boolean;
    };

    expect(breakdown.overlapping).toBe(true);
    expect(breakdown.tags).toEqual([
      {
        tag: { id: dataset.friends.id, name: "con amigos", isArchived: false },
        totalMinor: 6_000,
        transactionCount: 1,
        drillDown: {
          dateFrom: "2026-03-01",
          dateTo: "2026-03-14",
          type: "expense",
          categoryId: null,
          tagIds: [dataset.friends.id],
          untagged: false,
        },
      },
      {
        tag: { id: dataset.travel.id, name: "viajes", isArchived: false },
        totalMinor: 6_000,
        transactionCount: 1,
        drillDown: {
          dateFrom: "2026-03-01",
          dateTo: "2026-03-14",
          type: "expense",
          categoryId: null,
          tagIds: [dataset.travel.id],
          untagged: false,
        },
      },
    ]);
    expect(
      breakdown.tags.reduce((total, entry) => total + entry.totalMinor, 0),
    ).not.toBe(11_000);
    expect(breakdown.untagged).toEqual({
      totalMinor: 5_000,
      transactionCount: 1,
      drillDown: {
        dateFrom: "2026-03-01",
        dateTo: "2026-03-14",
        type: "expense",
        categoryId: null,
        tagIds: [],
        untagged: true,
      },
    });
  });

  it("explains every card with a history filter and lists the recent movements", async () => {
    seedDataset(fixture);
    const { body } = await readSummary(fixture, "?period=currentMonth");
    const summary = data(body);

    expect(summary.drillDowns).toEqual({
      income: {
        dateFrom: "2026-03-01",
        dateTo: "2026-03-14",
        type: "income",
        categoryId: null,
        tagIds: [],
        untagged: false,
      },
      expense: {
        dateFrom: "2026-03-01",
        dateTo: "2026-03-14",
        type: "expense",
        categoryId: null,
        tagIds: [],
        untagged: false,
      },
      net: {
        dateFrom: "2026-03-01",
        dateTo: "2026-03-14",
        type: null,
        categoryId: null,
        tagIds: [],
        untagged: false,
      },
    });

    const recent = summary.recentTransactions as readonly {
      date: string;
      amountMinor: number;
      tagIds: readonly string[];
    }[];

    expect(recent).toHaveLength(5);
    expect(recent.map((entry) => entry.date)).toEqual([
      "2026-03-12",
      "2026-03-10",
      "2026-03-05",
      "2026-02-20",
      "2026-02-14",
    ]);
    expect(recent[1].tagIds).toHaveLength(2);
  });

  it("still sums an archived category and marks it in the breakdown", async () => {
    const dataset = seedDataset(fixture);

    archiveCategory(fixture, dataset.leisure);

    const { body } = await readSummary(fixture, "?period=currentMonth");
    const summary = data(body);
    const groups = summary.expenseByCategory as readonly {
      category: { id: string; isArchived: boolean };
      totalMinor: number;
    }[];

    expect(
      (summary.totals as { current: { expenseMinor: number } }).current
        .expenseMinor,
    ).toBe(11_000);
    expect(groups[0]).toMatchObject({
      category: { id: dataset.leisure.id, isArchived: true },
      totalMinor: 6_000,
    });
  });

  it("aggregates a closed custom month range against the whole previous block", async () => {
    seedDataset(fixture);
    const { response, body } = await readSummary(
      fixture,
      "?period=customMonthRange&from=2026-01&to=2026-02",
    );
    const summary = data(body);

    expect(response.status).toBe(200);
    expect(summary.period).toEqual({
      kind: "customMonthRange",
      from: "2026-01",
      to: "2026-02",
    });
    expect(summary.range).toEqual({ start: "2026-01-01", end: "2026-02-28" });
    expect(summary.comparison).toEqual({
      current: { start: "2026-01-01", end: "2026-02-28" },
      previous: { start: "2025-11-01", end: "2025-12-31" },
    });
    expect(summary.totals).toMatchObject({
      current: { incomeMinor: 100_000, expenseMinor: 7_001 },
      previous: { incomeMinor: 0, expenseMinor: 2_000 },
    });
  });

  it("reports zeroed totals and empty breakdowns for a period without movements", async () => {
    const { response, body } = await readSummary(
      fixture,
      "?period=previousMonth",
    );
    const summary = data(body);

    expect(response.status).toBe(200);
    expect(summary.range).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(summary.totals).toMatchObject({
      current: {
        incomeMinor: 0,
        expenseMinor: 0,
        netMinor: 0,
        incomeCount: 0,
        expenseCount: 0,
      },
      income: { deltaPercent: 0, reason: null },
      expense: { deltaPercent: 0, reason: null },
      net: { deltaPercent: 0, reason: null },
    });
    expect(summary.expenseByCategory).toEqual([]);
    expect(summary.expenseByTag).toMatchObject({
      tags: [],
      untagged: { totalMinor: 0, transactionCount: 0 },
      overlapping: true,
    });
    expect(summary.recentTransactions).toEqual([]);
  });

  it("refuses a reversed custom month range", async () => {
    seedDataset(fixture);
    const { response, body } = await readSummary(
      fixture,
      "?period=customMonthRange&from=2026-02&to=2026-01",
    );

    expect(response.status).toBe(422);
    expect(details(body)).toEqual([
      { field: "to", code: "incompatibleFilters" },
    ]);
  });

  it("refuses a missing period, an unknown one and a repeated one", async () => {
    const missing = await readSummary(fixture, "");
    const unknown = await readSummary(fixture, "?period=lastDecade");
    const repeated = await readSummary(
      fixture,
      "?period=currentMonth&period=previousMonth",
    );

    // A missing enum is reported by the shared parser as an invalid value of
    // `period`, not as a missing property: the parameter has no valid absent
    // form, so both cases name the same field and the same fix.
    expect(missing.response.status).toBe(422);
    expect(details(missing.body)).toEqual([
      { field: "period", code: "invalidValue" },
    ]);
    expect(unknown.response.status).toBe(422);
    expect(details(unknown.body).map((entry) => entry.field)).toEqual([
      "period",
    ]);
    expect(repeated.response.status).toBe(422);
    expect(details(repeated.body).map((entry) => entry.field)).toEqual([
      "period",
    ]);
  });

  it("refuses months that do not belong to the selected period", async () => {
    const onPreset = await readSummary(
      fixture,
      "?period=currentMonth&from=2026-01&to=2026-02",
    );
    const missingMonths = await readSummary(
      fixture,
      "?period=customMonthRange",
    );
    const invalidMonths = await readSummary(
      fixture,
      "?period=customMonthRange&from=2026-13&to=not-a-month",
    );
    const invalidEnd = await readSummary(
      fixture,
      "?period=customMonthRange&from=2026-01&to=2026-1",
    );

    expect(onPreset.response.status).toBe(422);
    expect(details(onPreset.body)).toEqual([
      { field: "from", code: "unknownField" },
      { field: "to", code: "unknownField" },
    ]);
    expect(details(missingMonths.body)).toEqual([
      { field: "from", code: "required" },
      { field: "to", code: "required" },
    ]);
    expect(details(invalidMonths.body)).toEqual([
      { field: "from", code: "invalidDate" },
      { field: "to", code: "invalidDate" },
    ]);
    expect(details(invalidEnd.body)).toEqual([
      { field: "to", code: "invalidDate" },
    ]);
  });

  it("refuses a range whose comparison falls outside the calendar", async () => {
    const invalidStart = await readSummary(
      fixture,
      "?period=customMonthRange&from=2026-1&to=2026-02",
    );
    const beforeCalendar = await readSummary(
      fixture,
      "?period=customMonthRange&from=0001-01&to=0001-01",
    );

    expect(invalidStart.response.status).toBe(422);
    expect(details(invalidStart.body)).toEqual([
      { field: "from", code: "invalidDate" },
    ]);
    expect(beforeCalendar.response.status).toBe(422);
    expect(details(beforeCalendar.body)).toEqual([
      { field: "from", code: "invalidDate" },
    ]);
  });

  it("refuses a series selection and a client-supplied workspace", async () => {
    const dataset = seedDataset(fixture);
    const withSeries = await readSummary(
      fixture,
      `?period=currentMonth&categoryId=${dataset.home.id}&tagId=${dataset.travel.id}&untagged=true`,
    );
    const withWorkspace = await readSummary(
      fixture,
      `?period=currentMonth&workspaceId=${fixture.workspaceId}`,
    );

    expect(withSeries.response.status).toBe(422);
    expect(
      details(withSeries.body)
        .map((entry) => entry.field)
        .sort(),
    ).toEqual(["categoryId", "tagId", "untagged"]);
    expect(withWorkspace.response.status).toBe(422);
    expect(details(withWorkspace.body)).toEqual([
      { field: "workspaceId", code: "unknownField" },
    ]);
    expect(JSON.stringify(withWorkspace.body)).not.toContain(
      fixture.workspaceId,
    );
  });

  it("carries large exact totals as JSON-safe integers", async () => {
    const home = storeCategory(fixture, "Hogar", "expense");

    for (const date of ["2026-03-01", "2026-03-02", "2026-03-03"]) {
      storeTransaction(fixture, {
        category: home,
        amountMinor: MAX_TRANSACTION_MINOR,
        date,
      });
    }

    const { response, body } = await readSummary(
      fixture,
      "?period=currentMonth",
    );
    const totals = data(body).totals as {
      current: { expenseMinor: number; netMinor: number };
    };
    const expected = MAX_TRANSACTION_MINOR * 3;

    expect(response.status).toBe(200);
    expect(totals.current.expenseMinor).toBe(expected);
    expect(totals.current.netMinor).toBe(-expected);
    expect(Number.isSafeInteger(totals.current.expenseMinor)).toBe(true);
    expect(JSON.stringify(totals.current.expenseMinor)).toBe(String(expected));
  });
});

describe("GET /api/analytics/evolution", () => {
  let fixture: HttpFixture;

  beforeEach(() => {
    fixture = createHttpFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it("materialises every month of the window and explains each one", async () => {
    seedDataset(fixture);
    const { response, body } = await readEvolution(fixture);
    const evolution = data(body) as {
      kind: string;
      window: {
        start: string;
        end: string;
        months: readonly string[];
        monthCount: number;
        range: { start: string; end: string };
      };
      months: readonly {
        month: string;
        incomeMinor: number;
        expenseMinor: number;
        incomeCount: number;
        expenseCount: number;
        drillDown: Record<string, unknown>;
        incomeDrillDown: Record<string, unknown>;
        expenseDrillDown: Record<string, unknown>;
      }[];
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(API_CACHE_CONTROL);
    expect(evolution.kind).toBe("months");
    expect(evolution.window).toEqual({
      start: "2025-12",
      end: "2026-03",
      months: ["2025-12", "2026-01", "2026-02", "2026-03"],
      monthCount: 4,
      range: { start: "2025-12-01", end: "2026-03-31" },
    });
    expect(
      evolution.months.map((entry) => [
        entry.month,
        entry.incomeMinor,
        entry.expenseMinor,
      ]),
    ).toEqual([
      ["2025-12", 0, 2_000],
      ["2026-01", 0, 3_001],
      ["2026-02", 100_000, 4_000],
      ["2026-03", 200_000, 11_000],
    ]);
    expect(evolution.months[2].drillDown).toEqual({
      dateFrom: "2026-02-01",
      dateTo: "2026-02-28",
      type: null,
      categoryId: null,
      tagIds: [],
      untagged: false,
    });
    expect(evolution.months[2].incomeDrillDown).toMatchObject({
      dateFrom: "2026-02-01",
      dateTo: "2026-02-28",
      type: "income",
    });
    expect(evolution.months[3].expenseDrillDown).toEqual({
      dateFrom: "2026-03-01",
      dateTo: "2026-03-31",
      type: "expense",
      categoryId: null,
      tagIds: [],
      untagged: false,
    });
    expect(evolution.months[0].expenseCount).toBe(1);
    expect(evolution.months[1].incomeCount).toBe(0);
  });

  it("keeps a month without movements inside the window", async () => {
    const home = storeCategory(fixture, "Hogar", "expense");

    storeTransaction(fixture, {
      category: home,
      amountMinor: 1_500,
      date: "2026-01-05",
    });

    const { body } = await readEvolution(fixture);
    const evolution = data(body) as {
      window: { months: readonly string[]; monthCount: number };
      months: readonly { month: string; expenseMinor: number }[];
    };

    expect(evolution.window.monthCount).toBe(3);
    expect(evolution.months.map((entry) => entry.expenseMinor)).toEqual([
      1_500, 0, 0,
    ]);
  });

  it("answers an empty series for a workspace without movements", async () => {
    const { response, body } = await readEvolution(fixture);

    expect(response.status).toBe(200);
    expect(data(body)).toEqual({ kind: "empty" });
  });

  it("refuses any parameter, including a series selection", async () => {
    const { response, body } = await readEvolution(
      fixture,
      "?tagId=whatever&period=currentMonth",
    );

    expect(response.status).toBe(422);
    expect(
      details(body)
        .map((entry) => entry.field)
        .sort(),
    ).toEqual(["period", "tagId"]);
  });
});

describe("GET /api/analytics/averages", () => {
  let fixture: HttpFixture;

  beforeEach(() => {
    fixture = createHttpFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it("divides the closed months of its own window and never rounds", async () => {
    const dataset = seedDataset(fixture);
    const { response, body } = await readAverages(fixture);
    const averages = data(body) as {
      kind: string;
      context: {
        window: {
          start: string;
          end: string;
          months: readonly string[];
          monthCount: number;
          range: { start: string; end: string };
        };
        monthCount: number;
      };
      totalExpense: { totalMinor: number; monthCount: number };
      net: { totalMinor: number; monthCount: number };
      byCategory: readonly {
        category: { id: string };
        totalMinor: number;
        monthCount: number;
        transactionCount: number;
        drillDown: Record<string, unknown>;
      }[];
      byTag: readonly {
        tag: { id: string };
        totalMinor: number;
        monthCount: number;
        drillDown: Record<string, unknown>;
      }[];
      untagged: { totalMinor: number; monthCount: number };
      overlapping: boolean;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(API_CACHE_CONTROL);
    expect(averages.kind).toBe("months");
    expect(averages.context).toEqual({
      window: {
        start: "2026-01",
        end: "2026-02",
        months: ["2026-01", "2026-02"],
        monthCount: 2,
        range: { start: "2026-01-01", end: "2026-02-28" },
      },
      monthCount: 2,
    });
    expect(averages.totalExpense).toMatchObject({
      totalMinor: 7_001,
      monthCount: 2,
    });
    expect(averages.totalExpense).not.toHaveProperty("averageMinor");
    expect(
      presentAverageMinor(averages.totalExpense.totalMinor as MoneyMinor, 2),
    ).toEqual({ ok: true, value: 3_501 });
    expect(averages.net).toMatchObject({
      totalMinor: 92_999,
      monthCount: 2,
    });
    expect(averages.byCategory).toEqual([
      {
        category: {
          id: dataset.home.id,
          name: "Hogar",
          type: "expense",
          isArchived: false,
        },
        totalMinor: 7_001,
        monthCount: 2,
        transactionCount: 2,
        drillDown: {
          dateFrom: "2026-01-01",
          dateTo: "2026-02-28",
          type: "expense",
          categoryId: dataset.home.id,
          tagIds: [],
          untagged: false,
        },
      },
    ]);
    expect(averages.byTag).toEqual([
      {
        tag: { id: dataset.travel.id, name: "viajes", isArchived: false },
        totalMinor: 4_000,
        monthCount: 2,
        transactionCount: 1,
        drillDown: {
          dateFrom: "2026-01-01",
          dateTo: "2026-02-28",
          type: "expense",
          categoryId: null,
          tagIds: [dataset.travel.id],
          untagged: false,
        },
      },
    ]);
    expect(averages.untagged).toEqual({
      totalMinor: 3_001,
      monthCount: 2,
      drillDown: {
        dateFrom: "2026-01-01",
        dateTo: "2026-02-28",
        type: "expense",
        categoryId: null,
        tagIds: [],
        untagged: true,
      },
    });
    expect(averages.overlapping).toBe(true);
  });

  it("keeps months without movements in the divisor and excludes earlier ones", async () => {
    const home = storeCategory(fixture, "Hogar", "expense");

    storeTransaction(fixture, {
      category: home,
      amountMinor: 1_000,
      date: "2025-11-05",
    });
    storeTransaction(fixture, {
      category: home,
      amountMinor: 2_000,
      date: "2026-02-10",
    });

    const { body } = await readAverages(fixture);
    const averages = data(body) as {
      context: { monthCount: number; window: { months: readonly string[] } };
      totalExpense: { totalMinor: number; monthCount: number };
    };

    expect(averages.context.window.months).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
    expect(averages.context.monthCount).toBe(3);
    expect(averages.totalExpense).toMatchObject({
      totalMinor: 2_000,
      monthCount: 3,
    });
  });

  it("reports insufficient history instead of zeroed averages", async () => {
    const home = storeCategory(fixture, "Hogar", "expense");

    storeTransaction(fixture, {
      category: home,
      amountMinor: 900,
      date: "2026-03-02",
    });

    const withOnlyThisMonth = await readAverages(fixture);
    const emptyFixture = createHttpFixture();

    try {
      const empty = await readAverages(emptyFixture);

      expect(data(empty.body)).toEqual({ kind: "insufficientHistory" });
    } finally {
      emptyFixture.cleanup();
    }

    expect(withOnlyThisMonth.response.status).toBe(200);
    expect(data(withOnlyThisMonth.body)).toEqual({
      kind: "insufficientHistory",
    });
  });

  it("refuses any parameter, including a series selection", async () => {
    const { response, body } = await readAverages(fixture, "?categoryId=any");

    expect(response.status).toBe(422);
    expect(details(body)).toEqual([
      { field: "categoryId", code: "unknownField" },
    ]);
  });
});

/**
 * Writes a movement whose stored date passes the SQL check but not the domain
 * contract, which is how a file edited outside the application looks.
 */
function storeUnparsableTransaction(
  fixture: HttpFixture,
  category: Category,
): void {
  fixture.connection.sqlite
    .prepare(
      `INSERT INTO "transaction" (id, workspace_id, type, amount_minor, date, category_id, concept, note, created_at, updated_at)
       VALUES (?, ?, 'expense', 1000, '2020-13-45', ?, NULL, NULL, 1746268800000, 1746268800000)`,
    )
    .run("corrupted-row", fixture.workspaceId, category.id);
}

describe("analytics storage failures", () => {
  let fixture: HttpFixture;

  beforeEach(() => {
    fixture = createHttpFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it("answers a service failure when a stored row breaks its own contract", async () => {
    const home = storeCategory(fixture, "Hogar", "expense");

    storeTransaction(fixture, {
      category: home,
      amountMinor: 1_500,
      date: "2026-02-05",
    });
    storeUnparsableTransaction(fixture, home);

    const evolution = await readEvolution(fixture);
    const averages = await readAverages(fixture);
    const summary = await readSummary(fixture, "?period=currentMonth");

    for (const { response, body } of [evolution, averages, summary]) {
      expect(response.status).toBe(503);
      expect((body as ErrorEnvelope).error.code).toBe("serviceUnavailable");
      expect(details(body)).toEqual([]);
      expect(JSON.stringify(body)).not.toContain(fixture.connection.filePath);
      expect(JSON.stringify(body)).not.toContain("2020-13-45");
    }
  });
});

describe("analytics route wiring", () => {
  it("declares the Node runtime, stays dynamic and only exposes GET", async () => {
    for (const route of [summaryRoute, evolutionRoute, averagesRoute]) {
      expect(route.runtime).toBe(API_RUNTIME);
      expect(route.dynamic).toBe(API_DYNAMIC);
      expect(route.revalidate).toBe(API_REVALIDATE);
      expect(route).not.toHaveProperty("POST");
      expect(route).not.toHaveProperty("PUT");
      expect(route).not.toHaveProperty("PATCH");
      expect(route).not.toHaveProperty("DELETE");
    }

    const responses = await Promise.all([
      summaryRoute.GET(summaryRequest("?period=currentMonth")),
      evolutionRoute.GET(buildRequest({ path: "/api/analytics/evolution" })),
      averagesRoute.GET(buildRequest({ path: "/api/analytics/averages" })),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe(API_CACHE_CONTROL);
    }
  });
});
