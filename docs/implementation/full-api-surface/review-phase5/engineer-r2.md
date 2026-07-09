## engineer — round 2

In-progress review. `reviser-r2` marked all six of my round-1 findings `Fixed`; I re-verified each
against the current source (`src/http/http-client.ts`, `src/auth/auth-manager.ts`,
`src/errors/datto-api-error.ts`, `src/rate-limit/{rate-limiter,rate-limits}.ts`,
`src/util/{sleep,is-record}.ts`, `src/defaults.ts`). All six hold — ratified and `Closed` below. I
also reviewed the new code those revisions introduced (`sanitizeAxiosErrorCause`, the 401
`onUnauthorized` single-retry, the logging seam, timeouts, `pendingRefresh` coalescing, and the
`tokenResponseSchema` grant validation) as fresh surface; one new finding follows.

### Re-verification notes

- **engineer-r1-f1 (credential leak via `cause`)** — `sanitizeAxiosErrorCause`
  (`datto-api-error.ts` l.147-158) returns only `{name, message, code, status, method, url}` and is
  applied at `fromAxiosError` (l.210) and at both direct-construction helpers `buildRateLimitError`
  (l.208) / `build403Error` (l.225). No throw path attaches a raw `AxiosError` as `cause` anymore.
  `config.url` is a request path, not a credential carrier (query/auth live elsewhere). Ratified.
- **engineer-r1-f2 (in-flight coalescing)** — `refreshToken` (l.124-131) memoizes the in-flight
  `performRefresh()` on `pendingRefresh` and clears it in `finally`; a rejected refresh isn't cached
  (finally clears regardless), so a burst collapses to one grant. Ratified.
- **engineer-r1-f3 (logging seam)** — `logger?` on `HttpClientConfig`/`RateLimiterOptions`/
  `AuthManagerConfig`; `handleResponseError` emits `debug` on each 429/backoff retry and `warn` on
  giving up, `acquire` emits `debug` per throttle wait (kind/opKey/waitMs, no bodies/headers),
  `performRefresh` emits `debug`/`warn` with no credential context. Ratified.
- **engineer-r1-f4 / f5 (duplicated `sleep` / `isRecord`)** — both now live once under `src/util/`
  and are imported by all prior duplicate sites; no second definition remains. Ratified.
- **engineer-r1-f6 (`readHeader` false case-insensitivity)** — rewritten (l.140-152) to iterate
  entries and compare keys lowercased; the dead uppercase branch and the missed mixed-case gap are
  gone. Ratified.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | High | Closed | ErrorHandling | `datto-api-error.ts` l.147-158, l.202-212; `http-client.ts` l.202-228 | Ratified — `sanitizeAxiosErrorCause` redacts `config.data`/`config.auth`/`config.headers` at every throw site (`fromAxiosError` + both direct constructors); no raw `AxiosError` reaches `cause`. | No change; fix confirmed in source. |
| engineer-r1-f2 | Medium | Closed | ErrorHandling | `auth-manager.ts` l.124-131 | Ratified — `pendingRefresh` single-flight collapses a concurrent `getToken` burst to one grant round-trip; rejected refreshes aren't cached. | No change; fix confirmed. |
| engineer-r1-f3 | Medium | Closed | Logging | `http-client.ts` l.238-318; `rate-limiter.ts` l.150-167; `auth-manager.ts` l.141-169 | Ratified — optional `logger?` seam added to all three configs; retry/429/throttle/refresh paths emit `debug`/`warn` with safe context only. | No change; fix confirmed. |
| engineer-r1-f4 | Low | Closed | DRY | `src/util/sleep.ts` | Ratified — one shared `sleep`, imported by `http-client.ts` and `rate-limiter.ts`; duplicates removed. | No change; fix confirmed. |
| engineer-r1-f5 | Low | Closed | DRY | `src/util/is-record.ts` | Ratified — one shared `isRecord`, imported by `http-client.ts` and `datto-api-error.ts`; duplicates removed. | No change; fix confirmed. |
| engineer-r1-f6 | Low | Closed | Complexity | `http-client.ts` l.140-152 | Ratified — `readHeader` now iterates and lowercases keys; dead uppercase branch and mixed-case gap eliminated. | No change; fix confirmed. |
| engineer-r2-f1 | Medium | Open | ErrorHandling | `src/auth/auth-manager.ts` l.165-178 (`performRefresh`, malformed-token branch) | The malformed-token-response error attaches the **raw grant body** as `response: response.data`. A realistic malformed shape is an HTTP 200 that carries a valid `access_token` string but a bad `expires_in` (fails `tokenResponseSchema` on the numeric field) — in that case `response.data` contains a live bearer token, and it is stored on `DattoApiError.response`, a **public field the library invites consumers to inspect/log**. This re-opens the exact credential-exposure surface `engineer-r1-f1` closed for the `cause` chain, on the one auth path where the response body *is* the credential — a consumer that logs `error.response` leaks the token in cleartext. | Do not attach the raw grant body on this error. Either omit `response` entirely here (the `message`/`statusCode`/zod `cause` already convey "malformed token response"), or pass a redacted copy with `access_token` (and any `refresh_token`) stripped. The v2 direct-construction sites don't need this because their `response.data` is a server error body, not a credential — so scope the change to `performRefresh`'s malformed branch only. |
</content>
</invoke>
