/**
 * The scheduled command's core on two production-configured SQLite connections.
 *
 * This intentionally uses distinct connections to the same temporary file:
 * idempotency is decided by the persisted occurrence uniqueness constraint,
 * not an in-memory guard in one runner.
 */

import { afterEach, expect, it } from "vitest";

import { catchUpPersonalRecurring } from "../../../src/modules/recurring/application/run-personal-recurring";
import { FixedClock } from "../../../src/shared/domain/clock";
import type { LocalDate } from "../../../src/shared/domain/dates";
import {
  type RecurringFixture,
  createRecurringFixture,
  openWriter,
  sequentialIds,
  storeCategory,
  storeRule,
} from "./helpers";

const fixtures: RecurringFixture[] = [];
const writers: ReturnType<typeof openWriter>[] = [];

afterEach(() => {
  while (writers.length > 0) {
    writers.pop()?.close();
  }
  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
});

function openedFixture(): RecurringFixture {
  const fixture = createRecurringFixture();
  fixtures.push(fixture);
  return fixture;
}

it("two scheduled command connections materialise each missed month once", () => {
  const fixture = openedFixture();
  storeRule(fixture, {
    id: "rule-command",
    category: storeCategory(fixture, "Alquiler", "expense"),
    monthlyDay: 31,
    nextDueDate: "2026-07-31",
  });
  const writer = openWriter(fixture);
  writers.push(writer);

  const first = catchUpPersonalRecurring(fixture.connection, {
    clock: new FixedClock("2026-09-08" as LocalDate),
    createId: sequentialIds("first"),
  });
  const second = catchUpPersonalRecurring(writer, {
    clock: new FixedClock("2026-09-08" as LocalDate),
    createId: sequentialIds("second"),
  });

  expect(first).toMatchObject({
    ok: true,
    generated: 2,
    skipped: 0,
    failed: 0,
  });
  expect(second).toMatchObject({
    ok: true,
    generated: 0,
    skipped: 0,
    failed: 0,
  });
});
