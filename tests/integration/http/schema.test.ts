/**
 * Strict request parsing and the workspace boundary.
 *
 * Two properties are pinned here. Unknown keys are refused instead of stripped,
 * so a client can never believe the server kept something it discarded. And no
 * request may carry a workspace identifier at any depth, because the workspace
 * is a server-derived value and accepting one would let a caller choose whose
 * data it reads or writes.
 *
 * The mapping from Zod issues to field codes is asserted for every issue code
 * the library can raise, so a payload value can never reach a response body
 * through a library message.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  apiObject,
  MAX_PAYLOAD_SCAN_DEPTH,
  parseRequestPayload,
  PAYLOAD_ROOT_FIELD,
  rejectClientWorkspace,
  RESERVED_REQUEST_KEYS,
  toSchemaFieldErrors,
} from "../../../src/shared/server/http/schema";

const movementSchema = apiObject({
  type: z.enum(["expense", "income"]),
  amountMinor: z.int().positive().max(100_000_000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  concept: z.string().max(200).nullable(),
  tags: z.array(apiObject({ name: z.string().min(1) })).max(20),
});

const validMovement = {
  type: "expense",
  amountMinor: 1250,
  date: "2026-03-14",
  concept: "Compra semanal",
  tags: [{ name: "hogar" }],
};

function issuesOf(schema: z.ZodType, payload: unknown): z.core.$ZodIssue[] {
  const parsed = schema.safeParse(payload);

  if (parsed.success) {
    throw new Error("Expected the schema to reject this payload");
  }

  return [...parsed.error.issues];
}

describe("parseRequestPayload", () => {
  it("returns the parsed value of an accepted payload", () => {
    expect(parseRequestPayload(movementSchema, validMovement)).toEqual({
      ok: true,
      value: validMovement,
    });
  });

  it("refuses an unknown key instead of stripping it", () => {
    const result = parseRequestPayload(movementSchema, {
      ...validMovement,
      isAdmin: true,
    });

    expect(result).toEqual({
      ok: false,
      failure: {
        code: "validationFailed",
        status: 422,
        details: [{ field: "isAdmin", code: "unknownField" }],
      },
    });
  });

  it("reports a missing property as required", () => {
    const withoutAmount = { ...validMovement, amountMinor: undefined };

    delete withoutAmount.amountMinor;

    const result = parseRequestPayload(movementSchema, withoutAmount);

    expect(result).toEqual({
      ok: false,
      failure: {
        code: "validationFailed",
        status: 422,
        details: [{ field: "amountMinor", code: "required" }],
      },
    });
  });

  it("reports a wrong type without echoing the submitted value", () => {
    const result = parseRequestPayload(movementSchema, {
      ...validMovement,
      amountMinor: "1250,00",
    });

    expect(result).toEqual({
      ok: false,
      failure: {
        code: "validationFailed",
        status: 422,
        details: [{ field: "amountMinor", code: "invalidType" }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("1250,00");
  });

  it("reports a nested field with its dotted path", () => {
    const result = parseRequestPayload(movementSchema, {
      ...validMovement,
      tags: [{ name: "" }],
    });

    expect(result).toEqual({
      ok: false,
      failure: {
        code: "validationFailed",
        status: 422,
        details: [{ field: "tags.0.name", code: "tooSmall" }],
      },
    });
  });

  it("reports an unknown key nested inside an array element", () => {
    const result = parseRequestPayload(movementSchema, {
      ...validMovement,
      tags: [{ name: "hogar", id: "t-1" }],
    });

    expect(result).toEqual({
      ok: false,
      failure: {
        code: "validationFailed",
        status: 422,
        details: [{ field: "tags.0.id", code: "unknownField" }],
      },
    });
  });

  it("collects every rejected field of one payload", () => {
    const result = parseRequestPayload(movementSchema, {
      type: "transfer",
      amountMinor: 0,
      date: "14/03/2026",
      concept: null,
      tags: [],
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.failure.details).toEqual([
      { field: "type", code: "invalidValue" },
      { field: "amountMinor", code: "tooSmall" },
      { field: "date", code: "invalidFormat" },
    ]);
  });

  it("reports a payload that is not an object at the root path", () => {
    const result = parseRequestPayload(movementSchema, []);

    expect(result).toEqual({
      ok: false,
      failure: {
        code: "validationFailed",
        status: 422,
        details: [{ field: PAYLOAD_ROOT_FIELD, code: "invalidType" }],
      },
    });
  });
});

describe("toSchemaFieldErrors", () => {
  it.each([
    ["too_big", "tooBig", z.string().max(2), "abc"],
    ["too_small", "tooSmall", z.string().min(5), "abc"],
    ["invalid_format", "invalidFormat", z.string().regex(/^a+$/u), "b"],
    ["not_multiple_of", "invalidValue", z.number().multipleOf(5), 7],
    ["invalid_value", "invalidValue", z.literal("expense"), "transfer"],
    ["invalid_union", "invalidValue", z.union([z.number(), z.boolean()]), "x"],
    ["custom", "invalid", z.string().refine(() => false), "x"],
    ["invalid_type", "invalidType", z.string(), 1],
  ])("maps a %s issue to %s", (code, expected, schema, input) => {
    const issues = issuesOf(schema as z.ZodType, input);

    expect(issues[0].code).toBe(code);
    expect(toSchemaFieldErrors(issues, input)).toEqual([
      { field: PAYLOAD_ROOT_FIELD, code: expected },
    ]);
  });

  it("maps an invalid_key issue of a record to invalidValue", () => {
    const payload = { ab: 1 };
    const issues = issuesOf(z.record(z.string().min(3), z.number()), payload);

    expect(issues[0].code).toBe("invalid_key");
    expect(toSchemaFieldErrors(issues, payload)).toEqual([
      { field: "ab", code: "invalidValue" },
    ]);
  });

  it("does not call a value inside a Map missing when it is only mistyped", () => {
    const payload = new Map<unknown, unknown>([[1, 2]]);
    const issues = issuesOf(z.map(z.string(), z.number()), payload);

    expect(issues[0].code).toBe("invalid_type");
    expect(toSchemaFieldErrors(issues, payload)).toEqual([
      { field: "1", code: "invalidType" },
    ]);
  });

  it("reports a missing property of an array element as required", () => {
    const payload = { ...validMovement, tags: [{}] };
    const issues = issuesOf(movementSchema, payload);

    expect(toSchemaFieldErrors(issues, payload)).toEqual([
      { field: "tags.0.name", code: "required" },
    ]);
  });

  it("does not call a path that runs into a primitive missing", () => {
    const schema = apiObject({ a: z.string() }).superRefine((_value, ctx) => {
      ctx.addIssue({
        code: "invalid_type",
        expected: "string",
        path: ["a", "b"],
        message: "unused",
      });
    });
    const payload = { a: "x" };
    const issues = issuesOf(schema, payload);

    expect(toSchemaFieldErrors(issues, payload)).toEqual([
      { field: "a.b", code: "invalidType" },
    ]);
  });

  it("reports an explicit undefined property as required", () => {
    const payload = { a: undefined };
    const issues = issuesOf(apiObject({ a: z.string() }), payload);

    expect(toSchemaFieldErrors(issues, payload)).toEqual([
      { field: "a", code: "required" },
    ]);
  });

  it("reports one error per unrecognised key of the same object", () => {
    const payload = { a: "x", b: 1, c: 2 };
    const issues = issuesOf(apiObject({ a: z.string() }), payload);

    expect(toSchemaFieldErrors(issues, payload)).toEqual([
      { field: "b", code: "unknownField" },
      { field: "c", code: "unknownField" },
    ]);
  });
});

describe("rejectClientWorkspace", () => {
  it.each(RESERVED_REQUEST_KEYS)("refuses a top-level %s", (key) => {
    expect(rejectClientWorkspace({ [key]: "w-1" })).toEqual({
      field: key,
      code: "unknownField",
    });
  });

  it("refuses a workspace identifier nested in an object", () => {
    expect(rejectClientWorkspace({ filters: { workspaceId: "w-1" } })).toEqual({
      field: "filters.workspaceId",
      code: "unknownField",
    });
  });

  it("refuses a workspace identifier nested in an array element", () => {
    expect(rejectClientWorkspace({ tags: [{ workspaceId: "w-1" }] })).toEqual({
      field: "tags.0.workspaceId",
      code: "unknownField",
    });
  });

  it("refuses it before the schema reports an unrelated shape error", () => {
    const result = parseRequestPayload(movementSchema, {
      workspaceId: "w-1",
      amountMinor: "not a number",
    });

    expect(result).toEqual({
      ok: false,
      failure: {
        code: "validationFailed",
        status: 422,
        details: [{ field: "workspaceId", code: "unknownField" }],
      },
    });
  });

  it("accepts a payload without any reserved key", () => {
    expect(rejectClientWorkspace(validMovement)).toBeNull();
  });

  it.each([
    ["a primitive", "workspaceId"],
    ["null", null],
    ["a number", 1],
  ])("accepts %s as a payload", (_reason, payload) => {
    expect(rejectClientWorkspace(payload)).toBeNull();
  });

  it("stops descending past the accepted depth", () => {
    let deep: Record<string, unknown> = { workspaceId: "w-1" };

    for (let level = 0; level <= MAX_PAYLOAD_SCAN_DEPTH; level += 1) {
      deep = { nested: deep };
    }

    expect(rejectClientWorkspace(deep)).toBeNull();
  });

  it("still finds a key at the deepest scanned level", () => {
    let deep: Record<string, unknown> = { workspaceId: "w-1" };

    for (let level = 1; level < MAX_PAYLOAD_SCAN_DEPTH; level += 1) {
      deep = { nested: deep };
    }

    expect(rejectClientWorkspace(deep)?.code).toBe("unknownField");
  });
});
