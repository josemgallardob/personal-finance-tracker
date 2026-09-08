/**
 * Public surface of the API foundation.
 *
 * Route files import from this module only, so an endpoint cannot reach past
 * the pipeline and write a response, read a body or derive a workspace on its
 * own terms.
 */

export * from "./domain-status";
export * from "./failure";
export * from "./handler";
export * from "./json-body";
export * from "./logging";
export * from "./origin";
export * from "./query";
export * from "./request-id";
export * from "./responses";
export * from "./runtime";
export * from "./schema";
