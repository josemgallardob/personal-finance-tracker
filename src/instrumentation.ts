/**
 * Next.js process hooks.
 *
 * Catch-up of personal monthly due dates runs when a Node server starts, never
 * during `next build` and never on the Edge runtime. The runtime guard compares
 * `process.env.NEXT_RUNTIME` to a literal so the Edge compiler removes the
 * branch and never traces SQLite into the Edge bundle, and the module is loaded
 * through a static specifier the production bundler can resolve.
 */

const NODE_RUNTIME = "nodejs";
const PRODUCTION_BUILD_PHASE = "phase-production-build";

export function shouldRegisterStartupCatchUp(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): boolean {
  return (
    env.NEXT_RUNTIME === NODE_RUNTIME &&
    env.NEXT_PHASE !== PRODUCTION_BUILD_PHASE
  );
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  if (!shouldRegisterStartupCatchUp()) {
    return;
  }

  const { runPersonalRecurringCatchUp } =
    await import("./modules/recurring/server/run-personal-recurring");

  runPersonalRecurringCatchUp({ keepConnectionOpen: true });
}
