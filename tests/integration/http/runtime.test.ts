/**
 * Route segment configuration.
 *
 * The handlers load `better-sqlite3`, a native addon that the Edge runtime
 * cannot execute, and they read personal data that changes on every mutation.
 * Both facts are declared through these constants, so a route that re-exports
 * them cannot be rendered on the wrong runtime or served from a cache.
 */

import { describe, expect, it } from "vitest";

import {
  API_DYNAMIC,
  API_REVALIDATE,
  API_RUNTIME,
} from "../../../src/shared/server/http/runtime";

describe("route segment configuration", () => {
  it("pins the Node.js runtime, which the native SQLite driver requires", () => {
    expect(API_RUNTIME).toBe("nodejs");
  });

  it("pins dynamic rendering, so a response is never reused", () => {
    expect(API_DYNAMIC).toBe("force-dynamic");
  });

  it("pins revalidation to zero", () => {
    expect(API_REVALIDATE).toBe(0);
  });
});
