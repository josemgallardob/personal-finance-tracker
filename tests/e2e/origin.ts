/** Loopback origin of the dedicated Playwright production server. */

export const E2E_HOST = "127.0.0.1";

export const E2E_PORT = 4173;

export function e2eOrigin(): string {
  return `http://${E2E_HOST}:${E2E_PORT}`;
}
