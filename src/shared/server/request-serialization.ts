/**
 * Serialises complete requests that target the personal SQLite file.
 *
 * SQLite protects the file across processes, while this small in-process queue
 * keeps asynchronous application requests ordered within one server process.
 */

import "server-only";

let tail = Promise.resolve();

export function serializeApplicationRequest<TValue>(
  work: () => Promise<TValue>,
): Promise<TValue> {
  const next = tail.catch(() => undefined).then(work);

  tail = next.then(
    () => undefined,
    () => undefined,
  );

  return next;
}
