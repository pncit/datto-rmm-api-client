/**
 * Cross-cutting scalar defaults, consumed across module/layer boundaries.
 *
 * Deliberately layer-neutral — `src/defaults.ts`, not `src/client/defaults.ts`. The
 * transport layers (`src/http/http-client.ts`, `src/auth/auth-manager.ts`, both added in
 * Phase 5) sit *below* the client layer (`DattoRmmClient` on top; `BaseResource` depends
 * on `AuthManager`/`RateLimiter`/`HttpClient`) and must depend downward on these values.
 * Homing them under `src/client/` would force the transport layers to import upward into
 * the client layer while the client imports the transport layers back down — a
 * `client → http → client` cycle. A top-level module both sides depend on downward breaks
 * that cycle.
 *
 * Domain constants that belong to a single subsystem — e.g. the write rate-limit table —
 * stay co-located with their consumer (`src/rate-limit/rate-limits.ts`, Phase 5) instead
 * of living here: cross-cutting scalars go in this module; single-subsystem domain
 * constants go in that subsystem's own module.
 */

/**
 * Default retry policy for the HTTP transport (`src/http/http-client.ts`, Phase 5):
 * up to 3 attempts, exponential backoff starting at 250ms, capped at 5s.
 */
export const DEFAULT_RETRY = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 5000,
} as const;

/**
 * Default proactive token-refresh threshold, as a percentage of the token's original
 * TTL remaining, below which `src/auth/auth-manager.ts` (Phase 5) refreshes it.
 */
export const DEFAULT_TOKEN_REFRESH_PCT = 25;

/**
 * Ceiling, in milliseconds, applied to a server-supplied 429 `Retry-After` before
 * `src/http/http-client.ts` (Phase 5) gives up waiting and surfaces a `DattoApiError`
 * instead of sleeping.
 */
export const MAX_RETRY_AFTER_MS = 30_000;

/**
 * Default per-request socket timeout, in milliseconds, for both axios instances the
 * transport layer constructs (`src/http/http-client.ts`'s shared instance and
 * `src/auth/auth-manager.ts`'s bare `grantClient`, both Phase 5). Without a timeout a
 * stalled/half-open connection hangs indefinitely instead of surfacing an error the
 * retry logic can act on.
 */
export const DEFAULT_TIMEOUT_MS = 30_000;
