# Implementation Notes — Phase 5

- **Plan:** full-api-surface
- **Phase:** 5
- **Date:** 2026-07-09
- **Agent:** Implementor

---

## 1. Phase Scope Confirmation

**In-Scope (Phase 5 only):**
- `src/rate-limit/rate-limits.ts`: the committed static write-limit table (`WRITE_LIMITS`, the
  closed `WriteOpKey` union) and the scalar constants `READ_LIMIT`, `WRITE_AGGREGATE_LIMIT`,
  `WINDOW_SECONDS`, `DEFAULT_WRITE_LIMIT`.
- `src/rate-limit/rate-limiter.ts`: `MultiWindowRateLimiter` (read window, aggregate-write
  window, lazily-created per-opKey write windows) and the exported `RateDescriptor` type.
- `src/http/http-client.ts`: `createHttpClient(config)` — the shared, interceptor-bearing axios
  instance (`baseURL`, JSON + `User-Agent` headers, rate-limit request interceptor, error-mapping
  + retry response interceptor) — and the exported `isRateLimitBlock` predicate.
- `src/http/axios-augment.d.ts`: the private `rateDescriptor` module augmentation on Axios's
  request-config types.
- `src/auth/auth-manager.ts` + `src/auth/token-store.ts`: `AuthManager` (throwing OAuth2
  password-grant lifecycle, proactive `tokenRefreshPct`-driven refresh, transport-isolated
  grant/refresh call, `attachTo` for the shared instance's Bearer header) and the ported
  `InMemoryTokenStore`/`TokenInfo`.
- `tsconfig.test.json`: added `src/http/axios-augment.d.ts` to `include` — a necessary companion
  to the augmentation itself (see §5).
- Unit tests for every behavior named in the plan's Tests section, all via `nock` (no live calls).

**Explicitly Out-of-Scope:**
- Any change to the old runtime surface (`src/client.ts`, `src/config.ts`, `src/auth.ts`,
  `src/httpClient.ts`, `src/rateLimiter.ts`, `src/tokenStore.ts`, `src/validation.ts`,
  `src/schemas.ts`, `src/logger.ts`, `src/result.ts`, `src/internal/`) — untouched, still
  compiling, per the coexistence rule. Verified: `git status` after this phase shows only three
  new, untracked directories (`src/rate-limit/`, `src/http/`, `src/auth/` — plus their `tests/`
  counterparts) and one modified line in `tsconfig.test.json`; no other tracked file changed.
- `BaseResource`, `validateRequest`/`validateResponse`/`validateArrayResponse`, `paginate`, and
  `src/schema-overrides/` (Phase 6) — nothing in this phase is wired to a resource yet.
- Resource classes and `DattoRmmClient` itself (Phases 7–8) — `createHttpClient` and
  `AuthManager` are standalone primitives in this phase, not yet constructed together or mounted
  behind a client. `AuthManager.attachTo` and `createHttpClient`'s returned instance are each
  unit-tested independently and, in one `attachTo` test, together — but no `DattoRmmClient`
  scaffold exists yet.
- `system.requestRate()` (Phase 8) — the static table is the only budget source this phase reads.

---

## 2. Phase Intent (Interpreted)

Build the throwing HTTP transport every resource sits on: a dual-layer + per-operation rate
limiter seeded from a committed static table that throttles requests to stay inside Datto's real
server-side budget: an `HttpClient` (axios instance) that tags every request with a rate
descriptor, honors 429 `Retry-After` (bounded), and surfaces 403 IP-block/forbidden without
retry; and an `AuthManager` that throws instead of returning `Result<T>` and drives proactive
refresh from a remaining-TTL percentage instead of the old fixed 60s window. All three pieces are
adapted from the retired `src/httpClient.ts`/`src/rateLimiter.ts`/`src/auth.ts`/
`src/tokenStore.ts`, live under new paths per the coexistence rule, and are not yet wired to any
resource — that's Phase 6 (`BaseResource`) and Phase 7/8 (`DattoRmmClient`).

---

## 3. Files Touched

| File | Change Type | Rationale |
|------|------------|-----------|
| `src/rate-limit/rate-limits.ts` | Created | Committed static write-limit table + `WriteOpKey` closed union + scalar constants |
| `src/rate-limit/rate-limiter.ts` | Created | `MultiWindowRateLimiter`, `RateDescriptor` |
| `src/http/http-client.ts` | Created | `createHttpClient`, `isRateLimitBlock` |
| `src/http/axios-augment.d.ts` | Created | Private `rateDescriptor` type augmentation on Axios's request-config types |
| `src/auth/auth-manager.ts` | Created | `AuthManager` — throwing OAuth2 lifecycle, proactive refresh, transport isolation |
| `src/auth/token-store.ts` | Created | `InMemoryTokenStore`, `TokenInfo` (ported, extended with `issuedAt`) |
| `tsconfig.test.json` | Modified | Added `src/http/axios-augment.d.ts` to `include` so the test program also sees the ambient augmentation (§5) |
| `tests/unit/rate-limit/rate-limiter.test.ts` | Created | Burst/window/fallback/override coverage |
| `tests/unit/http/http-client.test.ts` | Created | 429/403/5xx/2xx, retry override, default descriptor, User-Agent |
| `tests/unit/auth/auth-manager.test.ts` | Created | Cache/reuse, proactive refresh, failure mapping, `attachTo` |

---

## 4. Implementation Summary

**`rate-limits.ts`.** Transcribed the plan's exact 14-entry `WRITE_LIMITS` table verbatim
(`device-udf-set: 600`, the other 13 at `100`) as `as const`, deriving `WriteOpKey =
keyof typeof WRITE_LIMITS`. `READ_LIMIT`/`WRITE_AGGREGATE_LIMIT`/`WINDOW_SECONDS`/
`DEFAULT_WRITE_LIMIT` are the plan's specified scalars (600/600/60/100).

**`rate-limiter.ts`.** `SlidingWindow` (module-private) ports the retired
`SlidingWindowRateLimiter`'s prune-then-check algorithm, but reports `msUntilRoom(now)` — how long
until the window has capacity — rather than a boolean, since `MultiWindowRateLimiter.acquire` must
reconcile *multiple* windows (aggregate write + per-opKey write, for a write) against one wait
time. `acquire(descriptor)` resolves the applicable window set (`[readWindow]` for a read;
`[aggregateWriteWindow, writeWindowFor(opKey)]` for a write — "the tightest applicable set," per
the plan), loops computing the max wait across them, sleeps if non-zero, and re-checks — so a
request that would exceed a window's budget is **throttled (delayed), not rejected**. See §6,
Decision 1, for why: this is a design-mandated behavior, not a free choice. `writeWindowFor`
lazily creates a per-opKey window sized from `WRITE_LIMITS[opKey]` if listed, else
`DEFAULT_WRITE_LIMIT` — the untyped `opKey?: string` boundary the plan specifies (Phase 6's
typed `WriteOpKey` call sites are the only path a resource can reach; this fallback is
defence-in-depth for a hypothetical untyped caller). `RateLimiterOptions` (`readLimit`/
`writeAggregateLimit`/`windowSeconds`) mirrors Phase 3's `rateLimit` config sub-schema shape so a
future client construction (Phase 7/8) can pass `config.rateLimit` straight through.

**`http-client.ts`.** `createHttpClient(config)` builds one `axios.create()` instance:
`baseURL`, `Content-Type: application/json`, and `User-Agent` (`datto-rmm-api-client` +
optional `userAgentExtra` suffix — see §6, Decision 3, for the format choice). A request
interceptor reads `config.rateDescriptor` (defaulting to `{ kind: 'read' }` when absent, per the
plan's "an untagged request is never sent unthrottled") and awaits
`rateLimiter.acquire(descriptor)` before the request proceeds. A response interceptor maps every
failure through `handleResponseError`:
- **403** → `build403Error` throws immediately, classified `ip-block`/`forbidden` via the
  exported `isRateLimitBlock` predicate (a `Retry-After` header or a rate-limit/block marker in
  the body's serialized text — see §6, Decision 4, for why this is a documented heuristic, not a
  confirmed contract). Never retried.
- **429** → parses `Retry-After` in either RFC form (delta-seconds via `Number`, HTTP-date via
  `Date.parse`) via `parseRetryAfterMs`, falling back to computed exponential backoff when
  unparseable. If the resolved wait exceeds `MAX_RETRY_AFTER_MS` **or** the retry-attempt cap is
  reached, throws `DattoApiError` with `retryAfterMs` populated instead of sleeping; otherwise
  sleeps and retries via `instance.request(config)`.
- **Network error / 5xx** → retries with exponential backoff (`calculateBackoffDelayMs`, base ×
  2^(n-1) capped at `maxDelayMs`, mirroring `fuze-api`'s `retry-interceptor.ts`) up to
  `retryPolicy.maxAttempts` **total attempts** (see §6, Decision 2, for this "total attempts, not
  total retries" reading of the field name).
- **Anything else** (plain 4xx, retry exhaustion) → `DattoApiError.fromAxiosError(error)`.

A hidden `__dattoRetryCount` property on the Axios request config (mirroring `fuze-api`'s
`RETRY_COUNT_KEY` pattern) tracks how many attempts a given request has made, so `maxAttempts` is
enforced per logical request across its own retries, not globally.

**`axios-augment.d.ts`.** A `declare module 'axios'` augmentation adding `rateDescriptor?:
RateDescriptor` to both `AxiosRequestConfig` and `InternalAxiosRequestConfig`, imported by
`RateDescriptor`'s home (`../rate-limit/rate-limiter`). Per the plan, this stays out of the
`src/index.ts` import graph (nothing imports it as a value module — ambient `.d.ts` files are
picked up by `tsc` purely through `tsconfig.json`'s `include: ["src"]`), so `tsup`'s `dts: true`
rollup never pulls it into `dist/index.d.ts` — verified directly (§7).

**`auth-manager.ts` / `token-store.ts`.** `InMemoryTokenStore` is `set`/`get`/`invalidate`,
unchanged from the retired version, with `TokenInfo` extended to carry `issuedAt` alongside
`expiresAt` (needed to compute remaining-TTL percentage — see §6, Decision 5).
`AuthManager` holds this store plus a **separate, bare** `axios.create()` instance
(`grantClient`) with none of `http-client.ts`'s interceptors, satisfying the plan's transport-
isolation requirement: the token round-trip never carries a Bearer header, never consumes the
read rate-limit window, and never runs through the 429/403 retry+classification path.
`getToken()` returns the cached token unless `needsRefresh` (remaining-TTL % <
`tokenRefreshPct ?? DEFAULT_TOKEN_REFRESH_PCT`) says otherwise, in which case it calls
`refreshToken()`, which performs the OAuth2 password grant (`grant_type=password`,
`username`/`password` = the caller's `apiKey`/`apiSecret`, HTTP Basic `public-client:public`) and
maps any failure — Axios or otherwise — to `DattoApiError` in its own `try`/`catch`, the one
error-mapping site on this path. `attachTo(instance)` is the sole point of contact with the
shared instance: it adds a request interceptor that calls `getToken()` and sets `Authorization:
Bearer <token>` via `requestConfig.headers.set(...)`.

---

## 5. Deviations From Plan (If Any)

1. **Added `src/http/axios-augment.d.ts` to `tsconfig.test.json`'s `include` list — a necessary
   companion, not a deviation, but worth flagging since it touches a file outside the plan's Files
   line for this phase.** `tsconfig.json`'s `include: ["src"]` picks up the ambient augmentation
   for the main (`typecheck:src`) program automatically, but `tsconfig.test.json` **overrides**
   (does not merge with) the base `include` array with its own list scoped to test files —
   `src/**/*.test.ts`, `src/__tests__/**/*.ts`, `tests/**/*.ts`, `scripts/**/*.mjs` — none of
   which glob-match a plain `.d.ts` file living directly under `src/http/`. Without this addition,
   `npm run typecheck:test` (part of the phase's own `npm run typecheck` gate) fails with
   `Property 'rateDescriptor' does not exist on type 'AxiosRequestConfig'` the moment a test file
   attaches one — exactly the failure the plan's own warning ("Without this the Phase 5-onward
   typecheck exit gates fail") describes, just surfacing in the *test* program rather than the
   *source* program the plan's prose focuses on. This is a "Phase X necessity": minimal (one
   line), config-only, and required to make this phase's own tests type-check. Confirmed
   `dist/index.d.ts` still carries no `declare module 'axios'` after the change (§7) — the fix
   only widens what the *test* `tsc` program sees, not what `tsup`'s rollup follows.

No other deviations. Every file, constant, and signature the plan pins (the `WriteOpKey` table,
`RateDescriptor`, `DattoApiError`'s pinned constructor from Phase 3, the `isRateLimitBlock` named
predicate, the `retryAfterMs`/`code` fields, `DEFAULT_RETRY`/`DEFAULT_TOKEN_REFRESH_PCT`/
`MAX_RETRY_AFTER_MS` from `src/defaults.ts`) is implemented and consumed as specified.

---

## 6. Ambiguities & Decisions

1. **`acquire` throttles (delays) rather than rejects.** The plan's Phase 5 prose alone doesn't
   pin this explicitly, but the design settles it: Success Criteria states "A write burst that
   would exceed a per-operation limit is **throttled locally** per the correct tier," and Decision
   3's rationale for having a local limiter at all is "*Rely solely on server 429s (no local
   limiter).* Rejected: persistent violations escalate to a 403 IP-block; **local limiting exists
   to avoid provoking it**." A limiter that only reports "you would have exceeded the budget" and
   lets the caller send anyway defeats that purpose. I implemented `acquire` as an async method
   that delays (via `setTimeout`) until every applicable window has room, then records the
   request — never throwing or returning a boolean. Tested by asserting a 101st write in a
   100-limited window doesn't resolve until the window rolls (`rate-limiter.test.ts`, using
   `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync` to avoid real 60s waits).

2. **`retry.maxAttempts` counts total attempts (initial request + retries), not retries alone.**
   The field is named `maxAttempts` (not `maxRetries`, which is what `fuze-api`'s own
   `retry-interceptor.ts` calls its equivalent field). Read literally, "max attempts" is the
   ceiling on the total number of HTTP attempts made for one logical request, so `DEFAULT_RETRY =
   { maxAttempts: 3, ... }` means at most 3 requests go out (1 original + up to 2 retries), not 1 +
   3 = 4. I implemented and tested this reading: `retries a 5xx exactly DEFAULT_RETRY.maxAttempts
   times` asserts `nock` receives exactly `DEFAULT_RETRY.maxAttempts` (3) requests total via
   `.times(DEFAULT_RETRY.maxAttempts)`, and the elapsed-time assertion expects exactly 2 backoff
   sleeps (between attempts 1→2 and 2→3), not 3.

3. **`User-Agent` format.** Neither the plan nor the design pins an exact `User-Agent` string
   format (R14 only says `userAgentExtra` "sets a `User-Agent` header"). I chose
   `datto-rmm-api-client` as the fixed product token, with `userAgentExtra` appended
   space-separated when present (`datto-rmm-api-client my-app/1.0`) — the conventional
   `product/version extra-product/version`-style layering `User-Agent` values follow, and simple
   enough that a future maintainer can extend it (e.g. append a package version) without
   revisiting call sites, since it's centralized in one `buildUserAgent` helper.

4. **`isRateLimitBlock`'s 403 classification heuristic.** The plan explicitly defers confirming
   Datto's real IP-block 403 marker to "Deferred Validation" and requires only that the logic live
   in one named, exported, unit-tested predicate. I implemented it as: a 403 carrying a
   `Retry-After` header (the server's own explicit throttling signal, reusable across both a 429
   and a 403 penalty), **or** a body whose serialized text matches a rate-limit/IP-block wording
   pattern (`/rate[\s._-]?limit|ip[\s._-]?block|blocked/i`). This is deliberately conservative
   (favors `forbidden` — the more common case — over `ip-block` when neither signal is present)
   and lives in exactly one place (`isRateLimitBlock`) for a future correction once the real
   marker is confirmed against a live account, per the plan's own instruction.

5. **`TokenInfo` gained `issuedAt` (not in the plan's prose, but required by its own
   requirement).** The plan requires proactive refresh "when the remaining lifetime is below
   `tokenRefreshPct` of **the original TTL**" — computing a *percentage of the original TTL*
   requires knowing when the token was issued, not just when it expires. The retired
   `src/tokenStore.ts`'s `TokenInfo` only carried `expiresAt`. I added `issuedAt` (set once, at
   the moment `refreshToken()` receives the grant response) so `needsRefresh` can compute
   `(expiresAt - now) / (expiresAt - issuedAt) * 100`. This is the minimal addition the plan's own
   "percentage of original TTL" requirement demands; `set`/`get`/`invalidate` behavior is
   otherwise unchanged, matching "port `InMemoryTokenStore` (unchanged behavior, R10)."

---

## 7. Tests

- `tests/unit/rate-limit/rate-limiter.test.ts` (6 tests): a 101st `alert-resolve` write trips the
  100-limited per-op window (doesn't resolve until the 60s window rolls); a 600-request
  `device-udf-set` burst does not trip; reads and writes are counted in separate windows; an
  unlisted write opKey falls back to the 100 default; the aggregate write window (600) trips
  across six distinct 100-limited opKeys even though no single per-op window is exhausted;
  `RateLimiterOptions` overrides (`readLimit`/`writeAggregateLimit`/`windowSeconds`) are honored.
  All use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync` to make a 60s window assertion run
  in milliseconds of wall-clock test time.
- `tests/unit/http/http-client.test.ts` (14 tests, `nock`): 2xx returns the body; a 429 with
  `Retry-After` in delta-seconds form is honored (retried after the delay); the same in HTTP-date
  form; an unparseable `Retry-After` falls back to computed backoff; a 429 with `Retry-After`
  exceeding `MAX_RETRY_AFTER_MS` throws `DattoApiError` with `retryAfterMs` populated without
  sleeping (asserted via an elapsed-time bound); a 403 with a rate/block marker throws classified
  `ip-block` (raw response body asserted); a 403 without one throws classified `forbidden` (raw
  response body asserted too); a 403 is never retried; a 5xx retries exactly
  `DEFAULT_RETRY.maxAttempts` times with an elapsed-time floor derived from
  `DEFAULT_RETRY.baseDelayMs`/backoff (not a magic number); an explicit `retry.maxAttempts`
  override is honored over the default; a plain 4xx (404) is not retried; an untagged request
  defaults to `{ kind: 'read' }` (asserted via a `vi.spyOn` on the limiter's `acquire`); the
  default `User-Agent` is set and `userAgentExtra` is appended when provided; `isRateLimitBlock`
  is `false` for an `undefined` response (the one branch not otherwise exercised through the
  403-classification tests above).
- `tests/unit/auth/auth-manager.test.ts` (10 tests, `nock`): a token is fetched once and reused
  across two `getToken()` calls; the grant body carries the caller's `apiKey`/`apiSecret` as
  `username`/`password`; a token below the default 25% remaining-TTL threshold is proactively
  refreshed; a token above it is not; an explicit `tokenRefreshPct` override changes the refresh
  point accordingly; a failed grant (401) throws `DattoApiError`; a transport-level failure
  (`replyWithError`) throws `DattoApiError` with `statusCode: 0`; `attachTo` sets `Authorization:
  Bearer <token>` on the shared instance's outgoing requests; a grant failure is not retried by
  the bare `grantClient` (proving the transport-isolation claim — the shared instance's own
  retry/rate-limit stack, exercised in `http-client.test.ts`, is absent here by construction).

Every test in this phase runs through `nock` (HTTP mocking) or in-process timing (`vi.useFakeTimers`)
— no live network calls, consistent with the plan's "all via `nock`" instruction.

---

## 8. Security & Best-Practices Review

- No secrets logged: nothing in this phase's modules calls a logger (that's Phase 6+, once
  `BaseResource` threads the masked `DattoLogger` through). `apiKey`/`apiSecret` only ever appear
  in the OAuth2 grant's URL-encoded request body, sent over HTTPS (the caller's own `apiUrl`), and
  are never placed in an error message or thrown value.
- `AuthManager`'s bare `grantClient` deliberately carries the OAuth2 grant credentials in the
  request body (per Datto's documented password-grant contract), not query string — avoids
  leaking them into server/proxy access logs.
- No `eval`, no dynamic `require`, no unsanitized string interpolation into a URL path (all paths
  in this phase's tests are literal; dynamic path construction is a Phase 6/7 concern).
- `Retry-After` header parsing (`parseRetryAfterMs`) treats any unparseable input as "fall back to
  computed backoff" rather than throwing or defaulting to zero-wait — a malformed/hostile header
  cannot cause a tight retry loop or an unhandled exception.
- `MAX_RETRY_AFTER_MS` bounds every 429 wait, preventing a large or hostile `Retry-After` value
  from hanging a request for hours (explicitly tested).
- The rate limiter's `setTimeout`-based waits are bounded by real window sizes (60s default) and
  cannot grow unbounded — a pathological input can only ever make `acquire` wait up to one window
  duration per loop iteration, and the loop terminates as soon as a window frees capacity.

---

## 9. Self-Review Scoring

| Element | Before | After | Comments |
|---------|--------|-------|----------|
| Extensibility | 9.0 | 9.5 | Extracted `RateLimiterOptions`/`RetryPolicyOverride` as named, independently-testable override shapes mirroring Phase 3's config sub-schemas, so Phase 7/8 client construction can pass `config.rateLimit`/`config.retry` straight through with no further translation layer. |
| Understandability | 9.0 | 9.5 | Added the throttle-vs-reject and maxAttempts-semantics rationale directly in module doc comments (not just these notes), so a future reader hits the "why" at the point of the ambiguity, not only in phase-notes archaeology. |
| Best Practices | 9.0 | 9.5 | Named, single-purpose helper functions for each classification concern (`isRateLimitBlock`, `parseRetryAfterMs`, `calculateBackoffDelayMs`, `build403Error`/`buildRateLimitError`) instead of inlining branching logic in `handleResponseError`, keeping that function's control flow scannable. |
| Plan Adherence | 9.5 | 10.0 | Verified every pinned constant/signature (`WriteOpKey` table values, `RateDescriptor` shape, `DattoApiError` construction sites, `isRateLimitBlock` as a named exported predicate, `DEFAULT_RETRY`/`DEFAULT_TOKEN_REFRESH_PCT`/`MAX_RETRY_AFTER_MS` sourced from `src/defaults.ts`) against the plan text line-by-line after the first implementation pass; found no drift. |
| Test Quality | 9.0 | 9.5 | Removed one low-value assertion-only-of-a-constant test from the auth-manager suite in favor of strengthening an existing test (asserting `statusCode: 0` on transport failure) — every remaining test asserts an actual behavior, not a static value. |

---

## 10. Iterative Improvements Made

1. Removed the runtime side-effect `import "./axios-augment"` from `http-client.ts` after
   discovering it broke `vitest`'s module resolution (a `.d.ts` file has no JS to import at
   runtime) — the ambient augmentation only needs to be part of the `tsc` *program* (via
   `tsconfig` `include`), never imported as a value module. Caught immediately by `npm test`
   failing with "Cannot find module" before this was finalized.
2. Added `src/http/axios-augment.d.ts` to `tsconfig.test.json`'s `include` after discovering
   `npm run typecheck:test` failed on `rateDescriptor` — `tsconfig.test.json` overrides
   (not merges with) the base config's `include`, so the ambient file needed listing there too.
3. Added explicit `response` body assertions to both 403-classification tests (`ip-block` and
   `forbidden`) to fully cover the plan's "both carry the raw `response` body" requirement, not
   just the status/code classification.
4. Removed a trivial "sanity check" test that only asserted `DEFAULT_TOKEN_REFRESH_PCT === 25` in
   isolation (no behavior exercised) and strengthened the adjacent transport-failure test to
   assert `statusCode: 0` instead, so every test in the suite verifies an actual `AuthManager`
   behavior.
5. Ran `prettier --write` over every new file for formatting consistency with the rest of the
   repo (no `.prettierrc` — default double-quote/2-space settings), then re-ran the full
   `lint`/`typecheck`/`test`/`build` sequence to confirm formatting-only changes didn't alter
   behavior.

---

## 11. Remaining Risks or Follow-Ups

- `isRateLimitBlock`'s 403 classification heuristic is unconfirmed against a real Datto IP-block
  response (plan Assumptions: "Deferred Validation"). It is isolated to one named, tested
  function, so correcting it later touches exactly one place.
- The rate limiter's throttling is local/in-process only — it has no cross-process/cross-instance
  coordination. Two separate client instances (or processes) sharing one Datto account would each
  enforce the budget independently, potentially doubling effective throughput against the real
  server limit. This matches the plan's scope (a single `MultiWindowRateLimiter` per client
  instance) and is not called out as a Non-Goal exception, so it's accepted as inherent to a
  local, static-table limiter design rather than flagged as a defect.
- `AuthManager.getToken()` has no in-flight de-duplication: if two calls race while a refresh is
  needed, both could independently call `refreshToken()` (two grant round-trips, the second
  overwriting the first's cached token). Nothing in the plan's Steps or Tests requires
  single-flight coalescing for Phase 5, and the old `src/auth.ts` had the same property, so this
  is preserved behavior, not a regression — worth a note for a future phase/hardening pass if
  high-concurrency use emerges.
- Retry/backoff timing (`DEFAULT_RETRY`) and the rate-limit table are both static, compiled-in
  values; `system.requestRate()` (Phase 8) will let a consumer reconcile against the live budget,
  but the client still won't adapt automatically (an explicit Future Consideration per the
  design, not a Phase 5 gap).

---

## 12. Commands Run / To Run

- `npm run lint` — 0 errors, 11 pre-existing warnings (all in the untouched old surface:
  `src/auth.ts`, `src/client.ts`, `src/httpClient.ts`, `src/logger.ts`).
- `npm run typecheck` (`typecheck:src` + `typecheck:test` + `typecheck:tools`) — clean.
- `npm test` — 220 tests passing across 19 files (30 new in this phase; all pre-existing tests
  from Phases 1–4 and the old `src/__tests__/*.test.ts` suite still green, confirming
  coexistence).
- `npm run build` — `tsup` succeeds; `dist/index.d.ts` contains no `declare module 'axios'` or
  `rateDescriptor` (spot-checked directly with `grep`, anticipating Phase 8's exit-gate assertion
  on the same fact).
- `npx prettier --check` / `--write` — applied to every new file for formatting consistency.

---

## 13. Final Assertion

I assert that:
- Only Phase 5 has been implemented.
- No unnecessary scope expansion occurred (the one config-file edit outside the plan's Files line
  — `tsconfig.test.json` — is a minimal, necessary companion to the plan's own
  `axios-augment.d.ts` requirement, documented in §5).
- All quality scores are ≥ 9.5.
