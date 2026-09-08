/**
 * Preferences HTTP handler.
 *
 * GET the fixed personal configuration and the civil day the server clock
 * reports in Madrid. There is no mutation endpoint: locale, currency, time
 * zone and mode are not client-writable. The handler is a factory so tests
 * inject the same environment, connection, clock and log sink the composition
 * already uses, while the route file calls the factory with process defaults.
 */

import "server-only";

import { accepted } from "../../../shared/server/http/failure";
import {
  createApiHandler,
  type ApiHandler,
} from "../../../shared/server/http/handler";
import {
  createServerComposition,
  type ServerCompositionDeps,
} from "../../../shared/server/composition";
import { toPreferencesDto, type PreferencesDto } from "../contracts";

/** Collaborators of the preferences handler. Clock is a test seam. */
export type PreferenceHttpDeps = ServerCompositionDeps;

/** GET /api/preferences. */
export function createGetPreferencesHandler(
  deps: PreferenceHttpDeps = {},
): ApiHandler {
  const composition = createServerComposition(deps);

  return createApiHandler<undefined, undefined, PreferencesDto>(
    {
      handle(context) {
        return accepted({
          status: 200,
          data: toPreferencesDto({
            locale: context.workspace.locale,
            currency: context.workspace.currency,
            timeZone: context.workspace.timeZone,
            mode: composition.mode,
            today: composition.clock.today(),
          }),
        });
      },
    },
    composition.handlerDeps,
  );
}
