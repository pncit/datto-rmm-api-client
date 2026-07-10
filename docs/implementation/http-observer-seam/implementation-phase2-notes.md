# Implementation Notes — Phase 2

- **Plan:** HTTP Observer Seam (`docs/implementation/http-observer-seam/plan.md`)
- **Phase:** 2
- **Date:** 2026-07-10
- **Agent:** Implementor

---

## 1. Phase Scope Confirmation

**In-Scope (Phase 2 only):**
- Add `httpObserver` to `HttpClientConfig` (`src/http/http-client.ts`), threaded raw.
- Register the observer's request interceptor **first** inside `createHttpClient` (so it runs
  **last** under axios's LIFO ordering — after rate-limit acquisition and after `AuthManager
  .attachTo`'s later-registered Bearer interceptor), capturing-and-stashing the request via the
  Phase 1 `captureRequest` assembler and firing `onRequest`.
- Fire `onResponse` from the fulfilled response-interceptor slot on a 2xx, reusing the stash.
- Fire `onError` once per dispatched attempt from inside `handleResponseError`, immediately after
  its existing `!axios.isAxiosError` rethrow guard, threading `httpObserver` in as its new 6th
  positional parameter (inserted before `error`).
- Thread `validated.httpObserver` from `DattoRmmClient` into `createHttpClient`'s config,
  unmasked (not through `withUdfMasking`).
- Unit tests (`tests/unit/http/http-client.test.ts`) covering per-attempt firing, retry, wire
  fidelity, absolute URL, transport/HTTP failure terminal selection, throttle-exclusion,
  onError-only capture-independence, and callback-failure isolation.

**Explicitly Out-of-Scope:**
- `AuthManager.performRefresh` / the OAuth grant path — Phase 3.
- Assembled-client integration tests and README documentation — Phase 4.
- Any change to existing auth, rate-limit, retry, or pagination behavior (verified unchanged —
  see §7/§12).

---

## 2. Phase Intent (Interpreted)

Make the shared axios instance (`createHttpClient`) — through which every resource request and
every pagination page already flows — fire the Phase 1 observer primitives once per physical HTTP
attempt: `onRequest` at the post-throttle, post-auth dispatch point; `onResponse` on a 2xx; and
`onError` on every dispatched non-2xx or transport failure, including each attempt of a retried
request. This phase makes no change to what the shared instance actually does (auth, rate limit,
retry, error mapping); it only observes. Pagination fidelity (R4) is a consequence of instrumenting
this one shared send path, not special-cased code.

---

## 3. Files Touched

| File | Change Type | Rationale |
|------|------------|-----------|
| `src/http/http-client.ts` | Modified | Added `httpObserver` to `HttpClientConfig`; registered the observer's request interceptor first (Step 2); fired `onResponse` from the fulfilled response handler (Step 3); threaded `httpObserver` as `handleResponseError`'s new 6th positional parameter and fired `onError` after the `isAxiosError` guard (Step 4). |
| `src/client/datto-rmm-client.ts` | Modified | Threaded `validated.httpObserver` into `createHttpClient`'s config, unmasked (Step 5). |
| `tests/unit/http/http-client.test.ts` | Modified | Added a new `describe("createHttpClient — httpObserver", ...)` block (10 new tests) covering every scenario the plan's Tests section specifies for this phase. |

---

## 4. Implementation Summary

**`HttpClientConfig`** gained an optional `httpObserver?: DattoHttpObserver` field with a doc
comment explicitly flagging that, unlike the adjacent `logger` field, delivery is raw/unmasked.

**`createHttpClient`** registers a new request interceptor — only when `config.httpObserver` is
defined, so there is zero overhead when the seam is unused — *before* the existing rate-limit
request interceptor. Inside it, every capture is built through the Phase 1 `captureRequest`
assembler (never inline), with `url` composed as the absolute resolved
`` `${requestConfig.baseURL ?? ""}${requestConfig.url ?? ""}` `` and `body` read from
`requestConfig.data` — the pre-serialization object, since this interceptor runs before axios's
`transformRequest`. The capture is unconditionally stashed onto `requestConfig
.__dattoObserverCapture` (overwriting any prior attempt's stash on a reused config object) before
`fireRequest` is invoked. Because axios's request interceptors execute in LIFO (reverse
registration) order, registering this interceptor first means it executes *last* — after the
rate-limit interceptor (registered second, inside this same function) and after
`AuthManager.attachTo`'s Bearer interceptor, which is registered on the same instance later, from
`DattoRmmClient`'s constructor, after `createHttpClient` returns. So by the time the observer's
interceptor runs, throttling has already completed and the `Authorization` header is already
attached — exactly the post-throttle, post-auth dispatch point Decision 5 requires.

The existing fulfilled response handler (previously the bare identity `(response) => response`)
now reads `response.config.__dattoObserverCapture` and, when present, calls `fireResponse` before
returning the response unchanged.

`handleResponseError` gained a new `httpObserver: DattoHttpObserver | undefined` parameter,
inserted as the 6th positional argument immediately before `error` (after `logger`) — preserving
the plan's mandated stable-signature approach over an options-object refactor. Immediately after
the existing `if (!axios.isAxiosError(error)) throw error;` guard, the handler reads
`error.config?.__dattoObserverCapture` directly (no cast to `RetryTrackedConfig`, since the stash
lives on the globally-augmented `InternalAxiosRequestConfig`) and, when present, calls
`fireError(logger, httpObserver, capture, error)` — handing the raw `AxiosError` straight through
to `onError.error`, unmodified. Placing this immediately after the guard and before every other
branch (403, 401/`onUnauthorized`, 429, retryable 5xx/network, and the final
`DattoApiError.fromAxiosError` throw) means: (a) the two non-dispatched paths (a rate-limiter
`acquire()` rejection and the Bearer interceptor's `getToken()` throwing a `DattoApiError`) never
reach this point — both are non-axios rejects the guard rethrows first, so neither ever wrote a
stash nor fires an `onError` here; and (b) every dispatched attempt — including one that is about
to be retried — fires exactly one terminal `onError`, satisfying R2's "retries are never
collapsed."

**`DattoRmmClient`** passes `validated.httpObserver` straight into `createHttpClient`'s config
alongside the masked `logger`, with an inline comment noting it deliberately bypasses
`withUdfMasking`.

No other line in `http-client.ts`'s existing retry/rate-limit/error-mapping logic was touched.

---

## 5. Deviations From Plan (If Any)

No deviations. All five steps were implemented exactly as specified, including the plan's
mandated mechanism (interceptor-registration-order for LIFO execution, the 6th-positional-param
signature for `handleResponseError`, reading the stash directly off `error.config` without a
`RetryTrackedConfig` cast, and firing `onError` immediately after the `isAxiosError` guard).

---

## 6. Ambiguities & Decisions

- **`config.httpObserver` narrowed via a local `const observer` inside the `if` block.** The plan's
  example code references `config.httpObserver` directly inside the registered interceptor
  callback. I bound it to a local `const observer = config.httpObserver;` right after the `if
  (config.httpObserver)` guard and used that inside the interceptor closure instead. This is a
  narrow readability/defensiveness choice, not a behavior change — `HttpClientConfig`'s fields are
  `readonly`, so TypeScript's narrowing does carry into the closure either way (confirmed: both
  forms typecheck), but naming the guarded value once makes the closure's intent (an
  already-confirmed-present observer) explicit at the call site rather than requiring the reader to
  re-derive it from the outer `if`.
- **Test file placement.** Added the new tests as a second `describe` block in the existing
  `tests/unit/http/http-client.test.ts` (extending the file the plan names) rather than a separate
  file, consistent with how the rest of that file organizes `createHttpClient` scenarios.

---

## 7. Tests

`tests/unit/http/http-client.test.ts` — new `describe("createHttpClient — httpObserver", ...)`
block (10 tests), all via `nock`:
- 2xx read fires `onRequest` then `onResponse`; the observed request carries
  `Authorization: Bearer ...` (a Bearer interceptor is attached in the test *after*
  `createHttpClient` returns, mirroring `AuthManager.attachTo`'s real registration point); the
  response event carries the parsed body and a numeric `durationMs`.
- `429 (Retry-After: 0) → 200` fires `onRequest` twice and yields `onError(429)` then
  `onResponse(200)` — two fully observed attempts.
- A JSON `post` delivers `body`/`requestBody` as the pre-serialization object (asserted
  `typeof !== "string"`), and the terminal event's `requestHeaders`/`requestBody` equal what
  `onRequest` captured for the same attempt.
- Every event's `url` is the absolute resolved URL (`${apiUrl}${path}`), never the bare relative
  path.
- A transport failure (nock `replyWithError`, retried to exhaustion) fires `onError`
  `DEFAULT_RETRY.maxAttempts` times, each with the raw thrown error (not a `DattoApiError`,
  confirmed `axios.isAxiosError(...) === true`) and no `statusCode`.
- A non-2xx (404) fires one `onError` whose `error` is the raw `AxiosError` (not a `DattoApiError`)
  with `statusCode` present.
- `durationMs` excludes throttle wait: a rate limiter whose `acquire` is mocked to delay 200ms
  still yields a `durationMs` under 150ms against a near-instant `nock` round-trip.
- An `onError`-only observer (no `onRequest`) still receives a terminal `onError` on a dispatched
  non-2xx with `requestHeaders`/`requestBody`/`durationMs` populated from the stash, proving
  capture-and-stash runs independent of which callback is configured.
- A throwing `onRequest` and a promise-rejecting `onResponse` leave the request's successful
  outcome unchanged and log exactly one `warn` each (two total).
- Omitting `httpObserver` entirely registers no observer interceptor and leaves
  `response.config.__dattoObserverCapture` unset — additive-only sanity.

All pre-existing `http-client.test.ts` cases (retry, 403 classification, 401 handling, timeout,
User-Agent, rate-limit descriptor, etc.) were re-run unchanged and pass.

---

## 8. Security & Best-Practices Review

- No new dependency. `httpObserver` is threaded through exactly like the plan specifies — raw,
  never routed through `withUdfMasking` — which is the documented, intentional exemption (design
  Decision 6/R9), not an oversight; the pre-existing `logger` field remains masked.
- The observer's request interceptor is registered conditionally (`if (config.httpObserver)`), so
  a client built without an observer pays zero extra interceptor-dispatch cost — no behavior or
  performance change for the overwhelming majority of existing/future callers who never set it.
- `fireRequest`/`fireResponse`/`fireError` (Phase 1's `invokeObserver`) guarantee a callback
  `throw` or rejected-promise return can never alter, delay, or fail the real request — verified
  directly by this phase's throwing/rejecting-callback test against the real transport, not just
  the Phase 1 unit-level guarantee.
- `onError` firing is correctly excluded for the two non-dispatched paths (rate-limiter reject,
  lazy Bearer refresh failure) by construction — both are non-axios rejects the existing
  `!axios.isAxiosError` guard rethrows *before* the new `fireError` call, so no code change was
  needed to preserve that exclusion; it falls out of the fire's placement.
- No secrets are newly logged: the only logging this phase's code path can trigger is
  `invokeObserver`'s existing swallow-`warn`, which logs only the callback name, never a payload.

---

## 9. Self-Review Scoring

| Element | Before | After | Comments |
|---------|--------|-------|----------|
| Extensibility | 9.0 | 9.5 | The conditional interceptor registration and the shared `captureRequest`/`fireRequest`/`fireResponse`/`fireError` primitives mean Phase 3's grant-path instrumentation needs no new shared plumbing — it reuses exactly what this phase exercises. |
| Understandability | 9.0 | 9.5 | Added doc comments explaining *why* interceptor registration order matters (LIFO) and *why* the fire is placed exactly after the `isAxiosError` guard (the dispatched/non-dispatched distinction), not just restating what the code does. |
| Best Practices | 9.0 | 9.5 | Matched the plan's pinned mechanism exactly (registration order, 6th positional param, direct `error.config` read) rather than introducing a different-but-plausible alternative; zero-overhead-when-absent registration follows the existing rate-limiter/logger optionality pattern already in this file. |
| Plan Adherence | 9.5 | 10.0 | All five steps implemented as specified; the one documented deviation (§6) is a non-behavioral local-variable naming choice, not a substantive change. |
| Test Quality | 9.0 | 9.5 | Covers every scenario the plan's Tests section lists for this phase, plus an additive-only sanity test (no `httpObserver`) beyond the plan's minimum, closing the "does this actually change nothing when absent" gap explicitly. |

---

## 10. Iterative Improvements Made

1. Bound `config.httpObserver` to a local `const observer` inside the registration `if` block for
   closure-site readability (see §6) — no behavior change.
2. Added the "no `httpObserver` → no interceptor, no stash" sanity test beyond the plan's minimum
   test list, directly verifying the "zero overhead / zero behavior change when absent" claim in
   `HttpClientConfig`'s doc comment rather than leaving it merely asserted.
3. Added an explicit assertion in the transport-failure test that every one of the
   `DEFAULT_RETRY.maxAttempts` fired `onError` events carries a **non**-`DattoApiError` raw error
   (`axios.isAxiosError(...) === true`), directly proving R8's "never re-mapped" guarantee at the
   transport-integration level, not just at Phase 1's isolated-helper level.

---

## 11. Remaining Risks or Follow-Ups

- None specific to this phase. Phase 3 must instrument `AuthManager.performRefresh` at its own
  dispatch point (the grant client carries no interceptors) using the same `captureRequest`/
  `fireRequest`/`fireResponse`/`fireError` primitives this phase already exercises against the
  shared instance — no new shared plumbing is anticipated.
- Phase 4's assembled-client integration test should additionally confirm the lazy-refresh
  grant-failure case (Bearer `getToken()` throwing a `DattoApiError`) fires `onError` exactly once
  — on the grant attempt, per Phase 3 — and not a second time here; this phase's unit tests confirm
  the shared-instance side of that exclusion (the guard rethrows before this phase's `fireError`
  call) but cannot exercise the full lazy-refresh path without `AuthManager`, which is out of this
  phase's scope.

---

## 12. Commands Run / To Run

- `npm run typecheck` — clean (`typecheck:src` + `typecheck:test` + `typecheck:tools`).
- `npm test` — 575/575 passing, 39/39 test files (up from 565/565 on the pre-Phase-2 tree; +10 net
  from this phase's 10 new tests, with every pre-existing test unaffected).
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
- Confirmed manually: every pre-existing `http-client.test.ts` case (retry/403/401/timeout/
  User-Agent/rate-limit-descriptor) passed unchanged in the same run as the new observer tests.

---

## 13. Final Assertion

I assert that:
- Only Phase 2 has been implemented.
- No unnecessary scope expansion occurred.
- All quality scores are ≥ 9.5.
