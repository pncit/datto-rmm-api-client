## engineer — round 1

First engineer review of Phase 5 (rate limiting, HTTP transport, throwing auth). No prior
`engineer` turn exists for this phase; the review dir holds only `implementation-auditor` turns
(r1/r2, both test-coverage items, ratified by `reviser-r1`) — those belong to a different reviewer
role, so I conduct a fresh review and do not carry their IDs. Scope taken from `git diff main`,
restricted to the Phase 5 surface: `src/rate-limit/{rate-limits,rate-limiter}.ts`,
`src/http/{http-client.ts,axios-augment.d.ts}`, `src/auth/{auth-manager,token-store}.ts`, and the
supporting `src/defaults.ts` / `src/errors/datto-api-error.ts` construction sites they consume.

The transport is well-factored overall: helpers are small and single-purpose, the throttle-vs-reject
and `maxAttempts`-semantics rationale is captured at the call site, and the rate-limiter's
check-then-record is genuinely atomic under the event loop. The findings below are the real
maintainability / error-handling / DRY issues that remain.

### Analysis notes

- **Credential leakage via the error `cause` chain (f1)** is the highest-signal item. Every
  `DattoApiError` thrown on both the auth path and the v2 path attaches the raw `AxiosError` as
  `cause`. An `AxiosError`'s `config` is an own-enumerable property carrying `config.data`
  (the grant body `grant_type=password&username=<apiKey>&password=<apiSecret>`) and, on the v2 path,
  `config.headers.Authorization = "Bearer <token>"`. `util.inspect`/`console.error` walks the
  `cause` chain and prints `config`, so a consumer that logs a caught error leaks the API secret or
  bearer token in cleartext — directly contradicting the notes' §8 claim that credentials are
  "never placed in an error message or thrown value," and defeating the point of the UDF-masking
  layer the library ships elsewhere.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | High | Open | ErrorHandling | `src/auth/auth-manager.ts` l.123-131 (grant catch → `cause: err` / `DattoApiError.fromAxiosError`); `src/http/http-client.ts` l.181-203 (`buildRateLimitError`/`build403Error` `cause: error`) & `src/errors/datto-api-error.ts` l.169-174 (`cause: err`) | Every thrown `DattoApiError` attaches the raw `AxiosError` as `cause`. That `AxiosError.config` is own-enumerable and holds `config.data` (the grant body `…&password=<apiSecret>`) on the auth path and `config.headers.Authorization: Bearer <token>` on the v2 path. `console.error(err)` / `util.inspect` walk the `cause` chain and print `config`, leaking the API secret / bearer token in cleartext — contradicting the notes' §8 "never placed in a thrown value" claim and the library's own masking intent. | Before attaching the axios error as `cause`, redact the sensitive request fields — strip `config.data`, `config.auth`, and `config.headers.Authorization` (e.g. build the `cause` from a shallow-cloned config with those keys removed), or attach only a whitelisted subset (`status`, `method`, `url`) instead of the whole `AxiosError`. Do it at the shared mapping site (`DattoApiError.fromAxiosError` + the two direct-construction helpers) so no throw path leaks. |
| engineer-r1-f2 | Medium | Open | ErrorHandling | `src/auth/auth-manager.ts` l.80-86 (`getToken`) + l.68-74 (`attachTo`) | `getToken()` has no in-flight coalescing. `attachTo` installs a per-request interceptor that calls `getToken()` on *every* outgoing request; when several requests fire in parallel on a cold or expiring token, each independently sees `needsRefresh` and calls `refreshToken()`, producing N concurrent grant round-trips that each overwrite the store (last write wins). This is normal usage (any resource that fans out parallel calls), not an exotic race, so it will happen in practice. | Memoize the in-flight refresh: store the `refreshToken()` promise in a private field, return it to concurrent callers while pending, and clear it in a `finally`. A ~5-line single-flight guard collapses the burst to one grant round-trip. |
| engineer-r1-f3 | Medium | Open | Logging | `src/http/http-client.ts` l.56-65 (`HttpClientConfig`), l.212-260 (`handleResponseError`); `src/rate-limit/rate-limiter.ts` l.130-145 (`acquire`) | The transport has no logging/observability seam. `handleResponseError` retries network/5xx errors and sleeps on 429 `Retry-After` entirely silently, and `acquire` can block a request for up to a full window (60s) with zero emitted signal. `HttpClientConfig` doesn't accept a logger and the retry/throttle logic lives permanently inside the axios interceptor (which `BaseResource`'s Phase-6 logger threading never wraps), so these paths are structurally unloggable as built — a silent multi-second retry/throttle is an operational black hole. | Add an optional `logger?` seam to `HttpClientConfig` (and `AuthManagerConfig`) now, since the instances are constructed here, and emit a `debug`/`warn` at each retry attempt, each 429 wait, and each throttle delay ≥ a threshold (attempt number, status, waitMs, opKey/kind — no bodies/headers). This lets Phase 7 wire the masked `DattoLogger` in without re-architecting the interceptor. |
| engineer-r1-f4 | Low | Open | DRY | `src/http/http-client.ts` l.81-85 and `src/rate-limit/rate-limiter.ts` l.34-38 | The identical `sleep(ms)` promise-timeout helper is defined verbatim in both new Phase-5 modules. | Extract one shared `sleep` (e.g. `src/util/sleep.ts`) and import it in both — a single-line trivial utility duplicated across two files in the same phase is exactly the case for a shared helper. |
| engineer-r1-f5 | Low | Open | DRY | `src/http/http-client.ts` l.122-124 and `src/errors/datto-api-error.ts` l.53-55 | `isRecord(value): value is Record<string, unknown>` is defined identically in both modules (Phase 5's http-client re-introduces the Phase-3 errors copy). | Promote to a shared type-guard module (`src/util/is-record.ts`) and import it in both, so the guard has one definition. |
| engineer-r1-f6 | Low | Open | Complexity | `src/http/http-client.ts` l.126-136 (`readHeader`) | `readHeader` claims case-insensitive lookup but only tries three exact casings: `name`, `name.toLowerCase()`, `name.toUpperCase()`. For `"Retry-After"` the `.toUpperCase()` branch (`"RETRY-AFTER"`) is effectively dead (no HTTP stack emits it), and a mixed-case variant a proxy might send (`"Retry-after"`) is missed entirely — so the "case-insensitive" contract is not actually met. | Axios normalizes response-header keys to lowercase, so the honest fix is to look up `name.toLowerCase()` only (drop the dead exact/uppercase branches); if genuine case-insensitivity is wanted, iterate the header entries comparing keys lowercased, rather than probing three hand-picked casings. |
