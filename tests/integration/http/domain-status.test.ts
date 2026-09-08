/**
 * Deterministic translation of domain and storage refusals.
 *
 * Every domain code is asserted individually, so a code that later changes
 * class is caught here instead of silently changing the status of an endpoint.
 * The severity rule is asserted too: one response has one status, and the least
 * recoverable class of a mixed refusal is the one that wins.
 */

import { describe, expect, it } from "vitest";

import { API_ERROR_STATUS } from "../../../src/shared/contracts/api";
import { domainError } from "../../../src/shared/domain/errors";
import {
  DATABASE_ERROR_API_CODE,
  DOMAIN_ERROR_API_CODE,
  statusOf,
  toApiFailure,
  toDomainFieldErrors,
} from "../../../src/shared/server/http/domain-status";

describe("DOMAIN_ERROR_API_CODE", () => {
  it.each([
    "required",
    "tooLong",
    "invalidCharacter",
    "invalidIdentifier",
    "invalidTransactionType",
    "invalidSortOrder",
    "invalidTimestamp",
    "invalidMonthlyDay",
    "invalidTemplateVersion",
    "invalidDate",
    "futureDate",
    "invalidAmount",
    "duplicateTag",
    "tooManyTags",
    "incompatibleCategoryType",
    "invalidCursor",
    "invalidLimit",
    "incompatibleFilters",
  ] as const)("reports %s as unprocessable content", (code) => {
    expect(statusOf(DOMAIN_ERROR_API_CODE[code])).toBe(422);
  });

  it("reports a missing row as 404", () => {
    expect(statusOf(DOMAIN_ERROR_API_CODE.notFound)).toBe(404);
  });

  it.each([
    "duplicateName",
    "alreadyArchived",
    "alreadyDeactivated",
    "activeRuleExists",
    "usedByActiveRule",
    "archived",
  ] as const)("reports %s as a conflict", (code) => {
    expect(statusOf(DOMAIN_ERROR_API_CODE[code])).toBe(409);
  });

  it("reports unusable storage as 503", () => {
    expect(statusOf(DOMAIN_ERROR_API_CODE.unavailable)).toBe(503);
  });
});

describe("toApiFailure", () => {
  it("keeps the domain field and code in the details", () => {
    expect(toApiFailure([domainError("amountMinor", "invalidAmount")])).toEqual(
      {
        code: "validationFailed",
        status: 422,
        details: [{ field: "amountMinor", code: "invalidAmount" }],
      },
    );
  });

  it("reports every rejected field of one refusal", () => {
    expect(
      toApiFailure([
        domainError("date", "futureDate"),
        domainError("tags", "tooManyTags"),
      ]),
    ).toEqual({
      code: "validationFailed",
      status: 422,
      details: [
        { field: "date", code: "futureDate" },
        { field: "tags", code: "tooManyTags" },
      ],
    });
  });

  it("prefers a missing row over an unprocessable field", () => {
    const failure = toApiFailure([
      domainError("date", "invalidDate"),
      domainError("categoryId", "notFound"),
    ]);

    expect(failure.status).toBe(404);
    expect(failure.details).toHaveLength(2);
  });

  it("prefers a conflict over an unprocessable field", () => {
    expect(
      toApiFailure([
        domainError("date", "invalidDate"),
        domainError("categoryId", "archived"),
      ]).status,
    ).toBe(409);
  });

  it("prefers a missing row over a conflict", () => {
    expect(
      toApiFailure([
        domainError("tagId", "archived"),
        domainError("categoryId", "notFound"),
      ]).status,
    ).toBe(404);
  });

  it("prefers unusable storage over every client-side class", () => {
    expect(
      toApiFailure([
        domainError("categoryId", "notFound"),
        domainError("storage", "unavailable"),
      ]).status,
    ).toBe(503);
  });

  it("omits the details of a storage failure, which describes the server", () => {
    expect(toApiFailure([domainError("storage", "unavailable")])).toEqual({
      code: "serviceUnavailable",
      status: 503,
    });
  });

  it("falls back to unprocessable content for an empty refusal", () => {
    expect(toApiFailure([])).toEqual({ code: "validationFailed", status: 422 });
  });
});

describe("toDomainFieldErrors", () => {
  it("copies field and code without adding anything else", () => {
    expect(toDomainFieldErrors([domainError("concept", "tooLong")])).toEqual([
      { field: "concept", code: "tooLong" },
    ]);
  });
});

describe("DATABASE_ERROR_API_CODE", () => {
  it.each([
    "invalidConfig",
    "invalidPath",
    "openFailed",
    "buildTimeAccess",
  ] as const)("reports %s as 503, never as a client mistake", (code) => {
    expect(DATABASE_ERROR_API_CODE[code]).toBe("serviceUnavailable");
    expect(API_ERROR_STATUS[DATABASE_ERROR_API_CODE[code]]).toBe(503);
  });
});
