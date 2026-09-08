import { describe, expect, it } from "vitest";

import { shouldRegisterStartupCatchUp } from "./instrumentation";

describe("shouldRegisterStartupCatchUp", () => {
  it("runs on a Node server that is not building", () => {
    expect(shouldRegisterStartupCatchUp({ NEXT_RUNTIME: "nodejs" })).toBe(true);
    expect(
      shouldRegisterStartupCatchUp({
        NEXT_RUNTIME: "nodejs",
        NEXT_PHASE: "phase-development-server",
      }),
    ).toBe(true);
  });

  it("skips the Edge runtime and a production build", () => {
    expect(shouldRegisterStartupCatchUp({ NEXT_RUNTIME: "edge" })).toBe(false);
    expect(
      shouldRegisterStartupCatchUp({
        NEXT_RUNTIME: "nodejs",
        NEXT_PHASE: "phase-production-build",
      }),
    ).toBe(false);
  });

  it("skips a process that declares no Next.js runtime", () => {
    expect(shouldRegisterStartupCatchUp({})).toBe(false);
  });
});
