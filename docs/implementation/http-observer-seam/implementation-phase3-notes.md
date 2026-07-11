# Implementation Notes — Phase 3

- **Plan:** HTTP Observer Seam (`docs/implementation/http-observer-seam/plan.md`)
- **Phase:** 3
- **Date:** 2026-07-10
- **Agent:** Implementor

---

## 1. Phase Scope Confirmation

**In-Scope (Phase 3 only):**
- Add `httpObserver` to `AuthManagerConfig` (`src/auth/auth-manager.ts`), threaded raw.
- Capture-and-stash + fire `onRequest` at `performRefresh`'s own dispatch point (the grant
  client carries no interceptors), via the Phase 1 `captureRequest`/`fireRequest` primitives.
- Fire `onResponse` on the resolved 2xx, **before** `tokenResponseSchema.safeParse` runs, so a
  malformed-token 2xx fires exactly one terminal event and never `onError`.
- Fire `onError` in the existing `catch`, handing off the **raw caught error** unchanged, before
  the existing mapping/rethrow to `DattoApiError`.
- Preserve every existing line of `performRefresh` (the `issuedAt` TTL anchor, both
  `logger?.debug`/`logger?.warn` calls, the mapping/rethrow logic, the malformed-response throw)
  unchanged.
- Thread `validated.httpObserver` from `DattoRmmClient` into `AuthManager`'s config, unmasked.
- Unit tests (`tests/unit/auth/auth-manager.test.ts`) covering grant success, the malformed-token
  2xx exclusion, non-2xx/transport-failure terminal selection with raw-error identity, and
  callback-failure isolation.

**Explicitly Out-of-Scope:**
- The shared axios instance / `createHttpClient` / `handleResponseError` — Phase 2 (already done).
- Assembled-client integration tests and README documentation — Phase 4.
- Any change to the grant's existing error-mapping, retry (there is none by design), or
  token-caching behavior (verified unchanged — see §7/§12).

---

## 2. Phase Intent (Interpreted)

Make `AuthManager.performRefresh` — the one call site that dispatches the OAuth2 password-grant
round-trip through a bare, interceptor-free axios instance — fire the Phase 1 observer primitives
around its existing logic without altering any of it: `onRequest` before the POST with the exact
wire-form urlencoded body, `onResponse` on a 2xx (before the token-shape validation, so a
malformed-token 2xx cannot double-fire), and `onError` in the existing `catch` with the raw caught
error, never the `DattoApiError` the method still constructs and rethrows to its caller. This
completes R3 (grant/refresh observability) using exactly the shared `observer.ts` helper Phase 2
already exercises against the shared instance — no new shared plumbing is introduced.

---

## 3. Files Touched

| File | Change Type | Rationale |
|------|------------|-----------|
| `src/auth/auth-manager.ts` | Modified | Added `httpObserver` to `AuthManagerConfig` (Step 1); capture-and-stash + `fireRequest` before the POST (Step 2); `fireResponse` on the resolved 2xx before `safeParse` (Step 3); `fireError` in the existing `catch` with the raw caught error (Step 4). |
| `src/client/datto-rmm-client.ts` | Modified | Threaded `validated.httpObserver` into `AuthManager`'s config, unmasked (Step 5). |
| `tests/unit/auth/auth-manager.test.ts` | Modified | Added a new `describe("AuthManager — httpObserver", ...)` block (5 new tests) covering every scenario the plan's Tests section specifies for this phase. |

---

## 4. Implementation Summary

**`AuthManagerConfig`** gained an optional `httpObserver?: DattoHttpObserver` field with a doc
comment explicitly flagging raw/unmasked delivery, mirroring the equivalent field Phase 2 added to
`HttpClientConfig`.

**`performRefresh`** now, immediately after the pre-existing `issuedAt = Date.now()` and
`logger?.debug("refreshing…")` lines (both untouched), builds the capture through the shared
`captureRequest` assembler — method `"POST"`, `url` = `` `${apiUrl}${GRANT_PATH}` ``, headers
`{ "Content-Type": "application/x-www-form-urlencoded" }` (`Authorization` intentionally absent —
the `Basic` pair is applied by axios internally from the per-request `auth:` option), and `body`
the already-computed `wireBody` (`body.toString()`, the exact urlencoded string sent on the wire) —
then fires `onRequest`. The POST call itself is unchanged except that it now reuses the
`wireBody` local instead of re-calling `.toString()` a second time (a no-behavior-change
simplification directly enabled by needing the wire string for the capture anyway).

On success, `fireResponse` fires immediately after the `await this.grantClient.post(...)` resolves
— **before** `tokenResponseSchema.safeParse` runs — so a 2xx with a malformed token body has
already emitted its one terminal event (`onResponse`, carrying the raw unparsed body) by the time
the subsequent `safeParse` failure throws a `DattoApiError`; no `onError` fires on that path
(Decision 4 rule 3). Every line below `fireResponse` (the `safeParse` check, its `logger?.warn` +
throw, and the successful `TokenInfo` construction reusing `issuedAt`) is unchanged.

On failure, the existing `catch` body — `logger?.warn("…refresh failed")`, the
`axios.isAxiosError` branch mapping to `DattoApiError.fromAxiosError`, and the non-axios fallback
`DattoApiError` — is preserved verbatim. A single `fireError(this.config.logger,
this.config.httpObserver, capture, err)` call is inserted between the `logger?.warn` and the
mapping branch, handing off the **raw caught `err`** — never the `DattoApiError` constructed
immediately after — to `onError.error`. `fireError` itself (Phase 1, unmodified) adds
`statusCode`/response fields only when `err` is an `AxiosError` carrying a `response`, so a
transport failure (no response) correctly yields no `statusCode`.

**`DattoRmmClient`** now passes `validated.httpObserver` into `AuthManager`'s config alongside the
masked `logger`, with the same "threaded raw/unmasked, unlike `logger`" comment already used at the
`createHttpClient` call site (Phase 2), for consistency between the two threading sites.

No other line in `auth-manager.ts`'s existing token-caching, single-flight, or `attachTo` logic was
touched.

---

## 5. Deviations From Plan (If Any)

No deviations. All five steps were implemented exactly as specified, including the plan's pinned
mechanism (fire `onResponse` before `safeParse`, hand off the raw caught error unmodified in the
`catch`, preserve `issuedAt` as a distinct anchor from `capture.startedAt`, and omit `Authorization`
from the captured header map).

One incidental simplification, not a deviation from any pinned requirement: `wireBody` (a local
holding `body.toString()`) is computed once and reused for both the capture and the POST call,
rather than calling `.toString()` twice as the plan's opinionated example does. This has no
behavioral difference (`URLSearchParams.toString()` is a pure, idempotent computation) and avoids a
redundant re-serialization at the same call site.

---

## 6. Ambiguities & Decisions

- **Reusing `wireBody` for both the capture and the POST.** The plan's opinionated example computes
  `body.toString()` once into a `wireBody` local and reuses it identically — this is not actually an
  ambiguity, just confirming the plan's own example was followed rather than the original two-call
  form the pre-Phase-3 code had. No decision was required beyond matching the plan's example, which
  is itself a correctness-neutral tidy-up directly motivated by needing the wire string at the
  capture site.
- **Test logger shape.** Where a test needed to assert on `logger.warn` (the failed-grant and
  callback-swallow tests), I constructed a full four-method `DattoLogger`-shaped object
  (`debug`/`info`/`warn`/`error`, all `vi.fn()`) rather than a partial object cast with `as never`,
  matching the `AuthManagerConfig.logger?: DattoLogger` field's actual type and the existing
  `http-client.test.ts` precedent for constructing a test logger — avoiding an unnecessary type
  assertion.

---

## 7. Tests

`tests/unit/auth/auth-manager.test.ts` — new `describe("AuthManager — httpObserver", ...)` block
(5 tests), all via `nock`, plus two small helper functions (`requestPayload`/`responsePayload`)
mirroring the discriminated-union event-capture pattern already established in
`http-client.test.ts`:
- A successful grant fires `onRequest` then `onResponse`; the request event's `url` is the absolute
  resolved `` `${apiUrl}${GRANT_PATH}` ``, its captured headers omit `Authorization`, and its `body`
  is the raw `grant_type=password&username=my-key&password=my-secret` urlencoded string (parsed via
  `URLSearchParams` to assert each field); the response event's `requestBody` is identity-equal to
  the request event's `body` (same stash), `responseBody` is the raw token JSON, and `durationMs` is
  numeric.
- A grant POST returning 2xx with a malformed token body (missing `access_token`) fires exactly one
  terminal event — `onResponse` with the raw `{ expires_in: 3600 }` body — and no `onError`, even
  though `getToken()` still rejects with a `DattoApiError` (Decision 4 rule 3).
- A grant returning 401 fires `onError` whose `error` is the raw caught error: `not.toBeInstanceOf
  (DattoApiError)`, `axios.isAxiosError(...) === true`, and identity-distinct (`not.toBe`) from the
  `DattoApiError` `getToken()` ultimately throws; `statusCode` is `401`; the pre-existing
  `logger?.warn("…refresh failed")` call is asserted to still fire via a full mock `DattoLogger`.
- A transport-level failure (`nock` `replyWithError`) fires `onError` with `statusCode` `undefined`,
  while `getToken()` still throws a `DattoApiError`.
- A throwing `onRequest` and a promise-rejecting `onResponse` leave a successful grant's outcome
  unchanged (`getToken()` still resolves with the correct token) and log exactly two `warn` calls
  total (one per swallowed callback failure).

All pre-existing `auth-manager.test.ts` cases (token caching, proactive refresh, single-flight,
error mapping, secret-non-leakage, `attachTo`, timeout) were re-run unchanged and pass.

---

## 8. Security & Best-Practices Review

- No new dependency. `httpObserver` is threaded through exactly like the plan specifies — raw,
  never routed through `withUdfMasking` — the documented, intentional exemption (design
  Decision 6/R9); the pre-existing `logger` field on `AuthManagerConfig` remains masked.
- `fireError` hands off the **raw** caught error (which may be an `AxiosError` whose `config` still
  references the grant's `auth:` Basic credentials only as the non-secret `public-client:public`
  pair) — the security-relevant secret, the API key, only ever appears in the request event's
  `body`, which is the documented, intentional raw-delivery contract (R9), not a new leak surface.
  The existing "does not expose apiKey/apiSecret … via the thrown error's cause" test is unaffected
  since it asserts on the *thrown* `DattoApiError`, which this phase does not change.
- `fireRequest`/`fireResponse`/`fireError` (Phase 1's `invokeObserver`) guarantee a callback
  `throw` or rejected-promise return can never alter, delay, or fail the real grant round-trip —
  verified directly by this phase's throwing/rejecting-callback test against the real grant flow
  (`nock`), not just Phase 1's isolated-helper-level guarantee.
- No secrets are newly logged: the only logging this phase's code path can trigger beyond the
  pre-existing `debug`/`warn` calls is `invokeObserver`'s swallow-`warn`, which logs only the
  callback name, never the event payload (and hence never the API key or bearer credentials).
- The malformed-token-2xx exclusion (no `onError` after a 2xx) is exercised end-to-end here, not
  just asserted by inspection of the code ordering — closing the one place in the grant path where
  a post-2xx failure could otherwise have double-fired a terminal event.

---

## 9. Self-Review Scoring

| Element | Before | After | Comments |
|---------|--------|-------|----------|
| Extensibility | 9.5 | 9.5 | Reuses the exact Phase 1 primitives (`captureRequest`/`fireRequest`/`fireResponse`/`fireError`) with zero new shared plumbing, confirming the design's Decision 2 claim that both instrumentation sites can share one helper without drift. |
| Understandability | 9.0 | 9.5 | Added an inline comment at the capture site distinguishing `capture.startedAt` (the observer's dispatch timestamp) from `issuedAt` (the pre-existing token-TTL anchor), preventing a future reader from assuming they should be collapsed. |
| Best Practices | 9.0 | 9.5 | Matched the plan's pinned mechanism exactly (fire `onResponse` before `safeParse`; raw-error pass-through in `catch`; every pre-existing log line and error-mapping branch left verbatim) rather than introducing a plausible-but-different ordering. |
| Plan Adherence | 9.5 | 10.0 | All five steps implemented as specified; the one noted deviation (§5) is a non-behavioral reuse of an already-computed local, not a substantive change. |
| Test Quality | 9.0 | 9.5 | Covers every scenario the plan's Tests section lists for this phase, including the identity-inequality assertion (`errorEvents[0].error).not.toBe(error)`) proving the observer's raw error is distinct from the client's mapped `DattoApiError`, not merely structurally similar. |

---

## 10. Iterative Improvements Made

1. Added the identity-inequality assertion (`errorEvents[0]!.error).not.toBe(error)`) in the non-2xx
   test, directly proving the observer receives the *raw* caught error object rather than a
   coincidentally-similar re-derived one — closing a gap the plan's Success Criteria call for
   ("identity-equal … not a re-derived `DattoApiError`") but that a looser type-only check would
   have left unverified.
2. Constructed a full four-method mock `DattoLogger` in the tests that assert on `warn`, rather than
   a partial cast, avoiding an unnecessary `as never`/`as unknown` type assertion in test code.

---

## 11. Remaining Risks or Follow-Ups

- None specific to this phase. Phase 4's assembled-client integration test should confirm the
  lazy-refresh grant-failure case (the Bearer `getToken()` throwing a `DattoApiError`, observed via
  this phase's grant-path `onError`) fires `onError` exactly once overall — on the grant attempt —
  and not a second time on the shared instance; this phase's and Phase 2's unit tests each confirm
  their own side of that exclusion in isolation but cannot exercise the full lazy-refresh path
  without both `AuthManager` and `createHttpClient` wired together, which is Phase 4's scope.

---

## 12. Commands Run / To Run

- `npm run typecheck` — clean (`typecheck:src` + `typecheck:test` + `typecheck:tools`).
- `npm test` — 583/583 passing, 39/39 test files (up from 578/578 on the pre-Phase-3 tree; +5 net,
  exactly this phase's 5 new tests, with every pre-existing test unaffected).
- `npm run build` — clean; `dist/index.d.ts` contains no `declare module` block.
- `npm run lint` — clean (`eslint src`).
- Manual exit-gate script (plan-specified) run verbatim:
  ```bash
  npm run typecheck
  npm test
  npm run build
  ! grep -q 'declare module' dist/index.d.ts
  ```
  All checks passed.
- Confirmed manually: every pre-existing `auth-manager.test.ts` case (token caching, proactive
  refresh, single-flight, `attachTo`, secret non-leakage, timeout) passed unchanged in the same run
  as the new observer tests.

---

## 13. Final Assertion

I assert that:
- Only Phase 3 has been implemented.
- No unnecessary scope expansion occurred.
- All quality scores are ≥ 9.5.
