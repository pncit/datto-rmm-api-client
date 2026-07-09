## architect — round 2

In-progress review. I read my `architect-r1` turn and the reviser's latest disposition
(`reviser-r2`, which marks all six of my r1 findings `Fixed`), then re-verified each fix against the
current Phase 5 tree (`src/http/`, `src/auth/`, `src/rate-limit/`, `src/errors/`, `src/defaults.ts`,
and the new `src/util/`), scoped via `git diff` against `main`. Each `Fixed` claim holds up on the
source, so every r1 finding is carried forward at its original ID and closed as **ratified**.

Re-verification detail:

- **f1 (credential leak via `cause`)** — `sanitizeAxiosErrorCause` (`datto-api-error.ts` l.147-158)
  returns only `{name,message,code,status,method,url}` and is now the `cause` at every axios-backed
  throw site: `fromAxiosError` (l.210), `buildRateLimitError`/`build403Error` (`http-client.ts`
  l.208/225), and — via `fromAxiosError` — `AuthManager.performRefresh`'s axios catch (l.157). I
  grep-swept every remaining `cause:`/`new DattoApiError`/`fromAxiosError` site: the only other
  causes are `performRefresh`'s non-axios branch (`cause: err`, l.161, reached only when
  `isAxiosError` is false, so no `config`/body) and the malformed-body branch (`cause: parsed.error`,
  a zod error). No raw `AxiosError` reaches `cause` on any path. Ratified.
- **f2 (403 `Retry-After` dropped)** — `build403Error` (l.212-228) now parses `Retry-After` via the
  shared `parseRetryAfterMs`/`readHeader` on the `ip-block` branch and sets `retryAfterMs`. Ratified.
- **f3 (no single-flight refresh)** — `refreshToken` (l.124-131) memoizes the in-flight
  `performRefresh()` on `this.pendingRefresh`, returns it to concurrent callers, and clears it in
  `.finally`; `getToken`'s check→`refreshToken` is synchronous so a same-tick burst coalesces to one
  grant. Ratified.
- **f4 (no request timeout)** — `DEFAULT_TIMEOUT_MS = 30_000` added to `defaults.ts`; both
  `axios.create` sites set `timeout` (shared instance l.331, `grantClient` l.71) with per-config
  overrides. Ratified.
- **f5 (undefined 401→invalidate seam)** — the seam is now defined: `HttpClientConfig.onUnauthorized`
  hook + a single tracked retry in `handleResponseError` (l.257-268), with the Phase 7 wiring
  (`onUnauthorized: () => authManager.invalidate()`) documented on both modules and on `invalidate()`
  itself. The hook keeps `http-client.ts` from depending on `AuthManager`; actual wiring is legitimate
  Phase 7 scope. The failure mode is owned and the method's caller is specified. Ratified.
- **f6 (duplicated primitives)** — `sleep` and `isRecord` now have single definitions in
  `src/util/`, imported by all three consumers; `readHeader` is one case-insensitive iterator and
  `firstNonEmptyString` already backs both extractors. Ratified.

No new architectural issues surfaced. The fixes introduced no new cross-layer coupling, boundary
break, or unowned seam; module ownership, dependency direction (transport → `defaults`/`util`, never
upward into the client layer), and the transport-isolation of the grant round-trip all remain intact.
Converging to zero new findings.

### Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | Medium | Closed | Security / Data handling | `src/errors/datto-api-error.ts` `sanitizeAxiosErrorCause` l.147-158; applied at `fromAxiosError` l.210, `http-client.ts` `buildRateLimitError`/`build403Error` l.208/225, `auth-manager.ts` `performRefresh` l.157 | Ratified: raw `AxiosError` is no longer attached as `cause` anywhere. `sanitizeAxiosErrorCause` keeps only `name/message/code/status/method/url` — never `config.data`, `config.auth`, or `config.headers.Authorization` — so no serialization of a thrown `DattoApiError`'s cause chain can surface `apiSecret`/`password`/bearer token. Remaining `cause` sites carry only a non-axios error or a zod error. | None — resolved. |
| architect-r1-f2 | Medium | Closed | Data flow / Boundary mapping | `src/http/http-client.ts` `build403Error` l.212-228 | Ratified: the `ip-block` branch now parses the 403's `Retry-After` (`parseRetryAfterMs(readHeader(...,"Retry-After"))`) and sets `retryAfterMs`, so the block duration survives on the thrown error; `forbidden` correctly leaves it `undefined`. | None — resolved. |
| architect-r1-f3 | Medium | Closed | Concurrency / Boundary | `src/auth/auth-manager.ts` `refreshToken` l.124-131 (`pendingRefresh`) | Ratified: refresh is single-flight — the in-flight `performRefresh()` promise is cached and shared by every concurrent `getToken()` caller, cleared on settle, so a startup burst yields exactly one grant round-trip. | None — resolved. |
| architect-r1-f4 | Medium | Closed | Resilience / Hot path | `src/defaults.ts` `DEFAULT_TIMEOUT_MS` l.49; `http-client.ts` l.331; `auth-manager.ts` l.71 | Ratified: both the shared instance and `grantClient` set a `timeout` (default 30s, per-config overridable), so a stalled/half-open connection converts to a retryable/throwable error instead of hanging the retry design's one blind spot. | None — resolved. |
| architect-r1-f5 | Low | Closed | Boundary / Lifecycle seam | `src/http/http-client.ts` `HttpClientConfig.onUnauthorized` l.73-80 + `handleResponseError` l.257-268; `auth-manager.ts` `invalidate` l.189-199 | Ratified: the 401→invalidate seam is now defined via an optional `onUnauthorized` hook and a single tracked retry (`__dattoUnauthorizedRetried`), decoupled from `AuthManager`, with the Phase 7 wiring documented and assigned. The recovery method has a specified caller and the failure mode is owned. | None — resolved. |
| architect-r1-f6 | Low | Closed | Maintainability / DRY | `src/util/sleep.ts`, `src/util/is-record.ts`; `readHeader` `http-client.ts` l.140-152 | Ratified: `sleep` and `isRecord` each have one definition under `src/util/`, imported by all Phase 5 consumers; `readHeader` is a single case-insensitive iterator. No duplicated transport primitives remain. | None — resolved. |
