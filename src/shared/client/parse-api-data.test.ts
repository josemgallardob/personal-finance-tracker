/**
 * Response validation against a public Zod contract.
 *
 * Only the payload of an accepted envelope is checked. A refused request, a
 * cancelled call or a 204 must keep the meaning the transport already assigned,
 * because collapsing them into "invalid" would hide a 422 a form has to mark.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseApiData } from "./parse-api-data";

const totalSchema = z.strictObject({ total: z.number() });

describe("parseApiData", () => {
  it("keeps a representation that matches the contract", () => {
    expect(
      parseApiData(
        {
          ok: true,
          noContent: false,
          status: 200,
          requestId: "req-01",
          data: { total: 1250 },
        },
        totalSchema,
      ),
    ).toEqual({
      ok: true,
      noContent: false,
      status: 200,
      requestId: "req-01",
      data: { total: 1250 },
    });
  });

  it("reports extra or mistyped fields as an invalid response", () => {
    expect(
      parseApiData(
        {
          ok: true,
          noContent: false,
          status: 200,
          requestId: "req-01",
          data: { total: 1250, workspaceId: "w-1" },
        },
        totalSchema,
      ),
    ).toEqual({ ok: false, reason: "invalidResponse", status: 200 });
    expect(
      parseApiData(
        {
          ok: true,
          noContent: false,
          status: 201,
          requestId: "req-01",
          data: { total: "1250" },
        },
        totalSchema,
      ),
    ).toEqual({ ok: false, reason: "invalidResponse", status: 201 });
  });

  it("passes a 204 and every failure through unchanged", () => {
    const noContent = {
      ok: true as const,
      noContent: true as const,
      status: 204 as const,
      requestId: "req-01",
    };
    const apiFailure = {
      ok: false as const,
      reason: "api" as const,
      status: 422,
      error: {
        code: "validationFailed" as const,
        message: "Los datos enviados no son válidos.",
        requestId: "req-01",
      },
    };
    const network = { ok: false as const, reason: "network" as const };
    const aborted = { ok: false as const, reason: "aborted" as const };
    const invalid = {
      ok: false as const,
      reason: "invalidResponse" as const,
      status: 502,
    };

    expect(parseApiData(noContent, totalSchema)).toEqual(noContent);
    expect(parseApiData(apiFailure, totalSchema)).toEqual(apiFailure);
    expect(parseApiData(network, totalSchema)).toEqual(network);
    expect(parseApiData(aborted, totalSchema)).toEqual(aborted);
    expect(parseApiData(invalid, totalSchema)).toEqual(invalid);
  });
});
