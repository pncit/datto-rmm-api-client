/**
 * Committed static rate-limit table for the Datto RMM v2 API, seeded from the observed
 * `GET /api/v2/system/request_rate` contract (design "The real rate-limit model"): a read
 * window, an aggregate write window, and per-operation write sub-limits reported in that
 * endpoint's `operationWriteStatus`.
 *
 * This table gives {@link MultiWindowRateLimiter} (`./rate-limiter.ts`) concrete limits before
 * the first request — the client's init cannot depend on a prior `system.requestRate()` call
 * (that method, added in Phase 8, stays available for a consumer to reconcile against the live
 * budget, but the client never calls it itself). `system.requestRate()` remains a Future
 * Consideration for adaptive throttling.
 */

/**
 * Every concrete write `opKey` a resource method (Phases 7–8) calls, mapped to its
 * per-operation write ceiling. Declared `as const` so {@link WriteOpKey} below is a *closed*
 * union: a resource write method types its `opKey` parameter as `WriteOpKey`, so passing an
 * unlisted or mistyped key (e.g. a typo'd `'device-udf-set '`) is a **compile error**, not a
 * silent mis-throttle. **Adding a write method requires adding its `opKey` here first.**
 *
 * `device-udf-set` is six times every other write's ceiling — the one documented exception to
 * the common 100 write bucket (design "The real rate-limit model").
 */
export const WRITE_LIMITS = {
  "device-udf-set": 600,
  "site-create": 100,
  "site-update": 100,
  "site-variable-set": 100,
  "account-variable-set": 100,
  "alert-resolve": 100,
  "alert-mute": 100,
  "alert-unmute": 100,
  "device-move": 100,
  "device-job-create": 100,
  "device-warranty-set": 100,
  "device-proxy-set": 100,
  "user-reset-keys": 100,
} as const;

/**
 * The closed set of write operation keys a resource method may pass to a `BaseResource` write
 * primitive (Phase 6). `keyof typeof WRITE_LIMITS` ties this union to the table above so the two
 * can never drift apart.
 */
export type WriteOpKey = keyof typeof WRITE_LIMITS;

/** Read requests per {@link WINDOW_SECONDS}. */
export const READ_LIMIT = 600;

/** Aggregate write requests (across every write opKey combined) per {@link WINDOW_SECONDS}. */
export const WRITE_AGGREGATE_LIMIT = 600;

/** The sliding-window duration, in seconds, every limit above is measured against. */
export const WINDOW_SECONDS = 60;

/**
 * Fallback per-operation write ceiling for a write opKey with no explicit {@link WRITE_LIMITS}
 * entry — the observed default for every write except `device-udf-set`.
 *
 * This is a limiter-level *defensive* fallback only, never reachable via a typed resource call:
 * because {@link WriteOpKey} is closed and covers every real write, no resource can pass an
 * unlisted opKey. It exists solely for {@link MultiWindowRateLimiter}'s untyped `acquire`
 * boundary (`opKey` stays a plain `string` there — see `rate-limiter.ts`), as defence-in-depth
 * for a hypothetical direct/untyped caller. It is **not** a consumer-overridable config knob.
 */
export const DEFAULT_WRITE_LIMIT = 100;
