/**
 * Next.js process hooks.
 *
 * Catch-up of personal monthly due dates runs when a Node server starts, never
 * during `next build` and never on the Edge runtime. The module path is built
 * at runtime so the production bundler cannot trace SQLite into Edge.
 */

export function shouldRegisterStartupCatchUp(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): boolean {
  return (
    env.NEXT_RUNTIME !== "edge" && env.NEXT_PHASE !== "phase-production-build"
  );
}

export async function register(): Promise<void> {
  if (!shouldRegisterStartupCatchUp()) {
    return;
  }

  const specifier = [
    ".",
    "modules",
    "recurring",
    "server",
    "run-personal-recurring",
  ].join("/");
  const loaded = (await import(specifier)) as {
    readonly runPersonalRecurringCatchUp: (options: {
      readonly keepConnectionOpen?: boolean;
    }) => unknown;
  };

  loaded.runPersonalRecurringCatchUp({ keepConnectionOpen: true });
}
