/**
 * Serialises complete requests that target the same SQLite file.
 *
 * SQLite protects the file across processes, while this small in-process queue
 * also prevents an asynchronous request from resolving stale demo state while
 * a reset is waiting to replace it. The queue is keyed only by the already
 * closed-set application mode; neither a cookie path nor workspace identifier
 * can influence it.
 */

import "server-only";

import type { ApplicationMode } from "../../modules/preferences/contracts";
import { resolveApplicationMode } from "../../modules/preferences/server/mode";

const tails = new Map<ApplicationMode, Promise<void>>();

export function serializeApplicationRequest<TValue>(
  cookieHeader: string | null,
  work: () => Promise<TValue>,
): Promise<TValue> {
  const mode = resolveApplicationMode(cookieHeader);
  const queueMode = mode.ok ? mode.value : "personal";
  const previous = tails.get(queueMode) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);

  tails.set(
    queueMode,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );

  return next;
}
