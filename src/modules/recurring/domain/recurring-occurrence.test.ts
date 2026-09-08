import { describe, expect, it } from "vitest";

import type { RecurringOccurrenceInput } from "./recurring-occurrence";
import {
  createRecurringOccurrence,
  unlinkGeneratedTransaction,
} from "./recurring-occurrence";

const NOW = 1_757_145_600_000;

const VALID_INPUT: RecurringOccurrenceInput = {
  id: "0193f0a1-6f3d-7c62-9a24-8f5b0e1c2d50",
  recurringRuleId: "0193f0a1-6f3d-7c62-9a24-8f5b0e1c2d40",
  scheduledFor: "2026-09-30",
  transactionId: "0193f0a1-6f3d-7c62-9a24-8f5b0e1c2d51",
  createdAt: NOW,
};

function created(input: Partial<RecurringOccurrenceInput> = {}) {
  const result = createRecurringOccurrence({ ...VALID_INPUT, ...input });

  if (!result.ok) {
    throw new Error(
      `Expected a valid occurrence, got ${JSON.stringify(result.errors)}`,
    );
  }

  return result.value;
}

function rejected(input: Partial<RecurringOccurrenceInput>) {
  const result = createRecurringOccurrence({ ...VALID_INPUT, ...input });

  if (result.ok) {
    throw new Error("Expected the occurrence to be rejected");
  }

  return result.errors;
}

describe("createRecurringOccurrence", () => {
  it("records only the rule, the day and the generated movement", () => {
    expect(created()).toEqual({
      id: VALID_INPUT.id,
      recurringRuleId: VALID_INPUT.recurringRuleId,
      scheduledFor: "2026-09-30",
      transactionId: VALID_INPUT.transactionId,
      createdAt: NOW,
    });
  });

  it("accepts a processed date whose movement no longer exists", () => {
    expect(created({ transactionId: null }).transactionId).toBeNull();
  });

  it("rejects identifiers that are not accepted identifiers", () => {
    expect(rejected({ id: "not a valid id" })).toContainEqual({
      field: "id",
      code: "invalidIdentifier",
    });
    expect(rejected({ recurringRuleId: "not a valid id" })).toContainEqual({
      field: "recurringRuleId",
      code: "invalidIdentifier",
    });
    expect(rejected({ transactionId: "not a valid id" })).toContainEqual({
      field: "transactionId",
      code: "invalidIdentifier",
    });
  });

  it("rejects a scheduled day that is not a real calendar day", () => {
    expect(rejected({ scheduledFor: "2026-02-30" })).toContainEqual({
      field: "scheduledFor",
      code: "invalidDate",
    });
  });

  it("rejects a creation mark that is not an exact Unix millisecond", () => {
    expect(rejected({ createdAt: -1 })).toContainEqual({
      field: "createdAt",
      code: "invalidTimestamp",
    });
  });

  it("reports every rejected field at once", () => {
    expect(
      rejected({
        id: "not a valid id",
        scheduledFor: "ayer",
        createdAt: 1.5,
      }).map((error) => error.field),
    ).toEqual(["id", "scheduledFor", "createdAt"]);
  });
});

describe("unlinkGeneratedTransaction", () => {
  it("keeps the processed date after the movement is deleted", () => {
    const unlinked = unlinkGeneratedTransaction(created());

    expect(unlinked.transactionId).toBeNull();
    expect(unlinked.recurringRuleId).toBe(VALID_INPUT.recurringRuleId);
    expect(unlinked.scheduledFor).toBe("2026-09-30");
  });

  it("returns an already unlinked occurrence untouched", () => {
    const occurrence = created({ transactionId: null });

    expect(unlinkGeneratedTransaction(occurrence)).toBe(occurrence);
  });
});
