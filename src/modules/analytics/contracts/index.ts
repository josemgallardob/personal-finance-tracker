/**
 * HTTP contracts of the dashboard analytics.
 *
 * Route handlers and a later browser client share these types and mappers so
 * the documented representation cannot drift between the two sides. Every
 * amount stays an exact integer of minor units, every average keeps its sum and
 * its divisor, and every figure carries the history filter that explains it.
 */

export * from "./averages";
export * from "./drill-down";
export * from "./evolution";
export * from "./summary";
