## implementation-auditor — round 1

Phase 5 builds the throwing HTTP transport layer: the static write-limit table + dual-layer
rate limiter, the interceptor-bearing axios factory (`createHttpClient`) with 429/403/5xx
handling, the private axios-config augmentation, and the throwing `AuthManager` + ported
`InMemoryTokenStore`. I scoped the review to the untracked Phase 5 tree (`src/rate-limit/`,
`src/http/`, `src/auth/`, their tests) plus the one-line `tsconfig.test.json` change; the prior
phases are committed and untouched, and no old-surface file (`src/rateLimiter.ts`,
`src/auth.ts`, `src/httpClient.ts`, `src/tokenStore.ts`, …) was modified, honoring the
coexistence rule.

Overall this is a clean, faithful implementation. Every pinned constant, signature, and behavior
in the plan (the 14-entry `WRITE_LIMITS` table with `device-udf-set: 600`, the closed
`WriteOpKey` union, `RateDescriptor`, the `{kind,opKey}` descriptor, `DattoApiError`'s pinned
constructor and direct-construction 403/429 paths, `isRateLimitBlock` as a named exported
predicate, both `Retry-After` RFC forms bounded by `MAX_RETRY_AFTER_MS`, the transport-isolated
bare `grantClient`, `tokenRefreshPct` remaining-TTL refresh with `DEFAULT_TOKEN_REFRESH_PCT = 25`,
and the ambient augmentation kept out of the entry import graph) is present and consumed as
specified. The `SlidingWindow` port correctly switches the prune boundary to `<=` — a necessary
adaptation for the `msUntilRoom`-based (delay-not-reject) model, since a `<` boundary would return
`0` while still full and over-record; this is a justified deviation from the literal old algorithm
even though the notes describe it as "unchanged behavior." The `maxAttempts`-as-total-attempts
reading (Decision 2) is the correct literal reading of the field name (not `fuze-api`'s
`maxRetries`), so it is not a defect. Findings below are limited to two test-coverage gaps against
behaviors the plan explicitly promises.

### Phase Coverage Checklist
| Step | Status | Notes |
|------|--------|-------|
| 1. Static limit table (`rate-limits.ts`) | ✅ Implemented | 14-entry `WRITE_LIMITS` verbatim, `WriteOpKey = keyof typeof`, scalars 600/600/60/100, `DEFAULT_WRITE_LIMIT` documented as defensive-only. |
| 2. Dual-layer limiter (`rate-limiter.ts`) | ✅ Implemented | Read + aggregate-write + lazy per-opKey windows; `acquire` throttles across the tightest applicable set; untyped `opKey?: string` boundary preserved. |
| 3. HTTP transport (`http-client.ts`) | ✅ Implemented | `baseURL`, JSON + `User-Agent`, rate-limit request interceptor with `{kind:'read'}` default, error/retry response interceptor, both `Retry-After` forms, `MAX_RETRY_AFTER_MS` bound, 403 no-retry via `isRateLimitBlock`. |
| 3. Axios augmentation (`axios-augment.d.ts`) | ✅ Implemented | Augments both `AxiosRequestConfig`/`InternalAxiosRequestConfig`; kept out of the `src/index.ts` value graph; added to `tsconfig.test.json` include. |
| 4. Auth (`auth-manager.ts` / `token-store.ts`) | ✅ Implemented | Throwing OAuth2 password grant, bare isolated `grantClient`, own error-mapping try/catch, `tokenRefreshPct` remaining-TTL refresh, `attachTo` Bearer interceptor, `TokenInfo` gains `issuedAt`. |
| Tests (rate-limit / http / auth) | ✅ Implemented | All plan-named behaviors covered via `nock`/fake timers; two promised bounding behaviors uncovered (see findings). |

### Drift Report
**Out-of-scope changes:** None. (`pipeline-run.json` is orchestrator bookkeeping, not implementation code.)
**Acceptable Phase X necessities:** `tsconfig.test.json` +1 line adding `axios-augment.d.ts` to the test program's `include` — required because the test config *overrides* rather than merges the base `include` and no test glob matches a bare `.d.ts`; minimal, config-only, and needed for this phase's own tests to typecheck. `TokenInfo.issuedAt` — required by the plan's own "percentage of the original TTL" refresh rule, which cannot be computed from `expiresAt` alone.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| implementation-auditor-r1-f1 | Low | Open | Tests | `tests/unit/http/http-client.test.ts` (5xx retry test, l.177-197) + `src/http/http-client.ts` `calculateBackoffDelayMs` l.91-97 | The plan promises backoff "bounded by `DEFAULT_RETRY.baseDelayMs`/`maxDelayMs`", but the `Math.min(delay, maxDelayMs)` cap is never exercised: with the defaults (base 250, cap 5000, 3 attempts) the largest computed delay is 500 ms — far under the cap — and no test uses a config where `baseDelayMs * 2^(n-1)` would exceed `maxDelayMs`. The cap branch is untested dead-appearing behavior. | Add a retry test with a config whose backoff would exceed `maxDelayMs` (e.g. `retry:{ baseDelayMs: 4000, maxDelayMs: 5000, maxAttempts: 3 }` on a repeated 5xx) and assert the elapsed inter-attempt delay is clamped at `maxDelayMs`, proving the cap actually clamps. |
| implementation-auditor-r1-f2 | Low | Open | Tests | `tests/unit/http/http-client.test.ts` + `src/http/http-client.ts` `handleResponseError` 429 branch l.232-247 | The 429 retry-*exhaustion* path (`failedAttemptNumber >= retryPolicy.maxAttempts` → `throw buildRateLimitError`) has no coverage. Tests cover 429-then-200, the over-`MAX_RETRY_AFTER_MS` throw, and unparseable fallback, but never a persistent 429 (short parseable `Retry-After`) that runs out of attempts and throws a `DattoApiError` with `statusCode:429` + `retryAfterMs` populated. This is a distinct branch from the 5xx-exhaustion path. | Add a `nock` test replying 429 with a small `Retry-After` (e.g. `"0"`) `.times(DEFAULT_RETRY.maxAttempts)` and assert the result is a `DattoApiError` with `statusCode:429` and a populated `retryAfterMs`, confirming exhaustion throws rather than looping. |
