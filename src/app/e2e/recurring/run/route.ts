import { FixedClock } from "../../../../shared/domain/clock";
import { parseLocalDate } from "../../../../shared/domain/dates";
import { catchUpPersonalRecurring } from "../../../../modules/recurring/application/run-personal-recurring";
import { getSqliteConnection } from "../../../../shared/server/database";
import { isE2eMaintenanceHarnessEnabled } from "../../../../shared/server/e2e-harness";
import type { E2eRecurringRunResult } from "../contracts";

function result(
  values: Partial<E2eRecurringRunResult> = {},
): E2eRecurringRunResult {
  return {
    ok: false,
    generated: 0,
    skipped: 0,
    failed: 0,
    message: "No se ha podido ejecutar la recuperación.",
    ...values,
  };
}

/**
 * Test-only clock control outside application API routes.
 *
 * The route is only reachable from the dedicated E2E process; the production
 * recurrence HTTP endpoints never receive a clock or date override.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isE2eMaintenanceHarnessEnabled()) {
    return Response.json(result(), { status: 404 });
  }

  const body = (await request.json()) as { today?: unknown };
  const parsedDate =
    typeof body.today === "string" ? parseLocalDate(body.today) : null;
  if (parsedDate === null || !parsedDate.ok) {
    return Response.json(
      result({ message: "Introduce una fecha de prueba válida." }),
      { status: 400 },
    );
  }

  const connection = getSqliteConnection();
  if (!connection.ok) {
    return Response.json(
      result({
        message: "No se ha podido preparar la prueba de recurrencias.",
      }),
      { status: 503 },
    );
  }

  const catchUp = catchUpPersonalRecurring(connection.value, {
    clock: new FixedClock(parsedDate.value),
  });
  return Response.json(
    result({
      ok: catchUp.ok,
      generated: catchUp.generated,
      skipped: catchUp.skipped,
      failed: catchUp.failed,
      message: catchUp.ok ? null : "No se ha podido ejecutar la recuperación.",
    }),
    { status: catchUp.ok ? 200 : 409 },
  );
}
