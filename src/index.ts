/**
 * Public entry point (R1, R2, R9, R19, design "Public surface", plan Phase 8 Step 7). Replaces the
 * retired 0.1.x barrel (a wildcard re-export of `client.js`/`config.js`/`result.js`/`schemas.js`)
 * in the same commit the old surface is deleted (plan Phase 8 Step 8) — a breaking `1.0.0` with no
 * back-compat aliases (Decision 5, R19).
 *
 * Exports exactly: the client factory + class, the config/logger types, the throwing error
 * hierarchy, and the curated public type surface (`./public-types`). Deliberately **not** a
 * wildcard re-export of the raw generated types module — see that module's own doc for why.
 */
export { createDattoRmmClient, DattoRmmClient } from "./client/datto-rmm-client";
export type { DattoRmmClientConfig } from "./client/datto-client-config";
export type { DattoLogger } from "./logging/logger";
export type {
  DattoHttpObserver,
  DattoHttpRequestEvent,
  DattoHttpResponseEvent,
  DattoHttpErrorEvent,
  DattoHttpHeaders,
} from "./http/http-observer";
export {
  BaseError,
  DattoApiError,
  DattoValidationError,
  type DattoApiErrorCode,
  type DattoValidationStage,
} from "./errors";
// Curated list (`./public-types.ts`) — deliberately not a wildcard re-export of the generated
// types module (see this file's own doc and that module's doc for why).
export * from "./public-types";
