## project-lead — round 1

Scope: `git diff f00f253` (the Phase 2 checkpoint) — `src/auth/auth-manager.ts`,
`src/client/datto-rmm-client.ts`, `tests/unit/auth/auth-manager.test.ts`. Phase 1/2 surfaces
(`src/http/http-observer.ts`, `src/http/observer.ts`, `src/http/http-client.ts`) are unchanged in
this diff and were reviewed under their own phase gates; not re-litigated here except where Phase 3
consumes their contract.

### Requirements Coverage
| Requirement | Status | Notes |
|---|---|---|
| R3 — OAuth grant/refresh call observed, body as raw urlencoded wire string | Fully Met | `captureRequest` built with `body: wireBody` (the same string posted); test asserts the parsed `URLSearchParams` fields match. |
| R5 — wire-fidelity bodies (grant as serialized string; responses as parsed object) | Fully Met | `fireResponse`'s `responseBody` is `response.data` (parsed JSON); grant request body is the serialized string, not pre-serialization object (correct — the grant is form-urlencoded, not JSON). |
| R6 — `onResponse` on 2xx, `onError` on non-2xx/no-response, with response fields when present | Fully Met | `onResponse` fires before `safeParse` (excludes the malformed-token throw per Decision 4 rule 3); `onError` fires once in the existing `catch`, with `statusCode` present for the 401 case and absent for the transport-failure case (both tested). |
| R7 — callback throw/rejection swallowed, request outcome unaffected, logged once | Fully Met | Exercised end-to-end (not just at the Phase 1 helper level) against the real grant flow via `nock`; asserts the token still resolves and exactly one `warn` per failing callback. |
| R8 — `onError.error` is the raw, unmapped error (`unknown`) | Fully Met | 401 test asserts `not.toBeInstanceOf(DattoApiError)` and `not.toBe(error)` (the thrown `DattoApiError`) — proves identity, not just structural similarity. |
| R9 — raw/unmasked delivery, no `withUdfMasking` | Fully Met | `httpObserver` threaded straight from `validated.httpObserver` into `AuthManager`'s config, alongside (not through) the masked `logger`. |

### Behavior vs Intent
Matches the plan's pinned mechanism exactly: `onRequest` fires before dispatch, `onResponse` fires
on the resolved 2xx strictly before `tokenResponseSchema.safeParse` (so a malformed-token 2xx emits
exactly one terminal event, never a spurious `onError`), and `onError` fires once in the existing
`catch` with the raw caught error, ahead of the unchanged mapping/rethrow to `DattoApiError`. Every
pre-existing line (`issuedAt` anchor, both log calls, the mapping/rethrow, the malformed-response
throw) is preserved verbatim — verified directly against the diff, not just by note. The one
sequencing nuance — `wireBody = body.toString()` is now computed one line before `issuedAt =
Date.now()`, where previously `.toString()` ran later at the POST call site — has no observable
effect (`issuedAt` remains the token-TTL anchor, unaffected by which of two adjacent synchronous
statements runs a beat earlier) and isn't a behavior-vs-intent mismatch.

### Scope & Focus
No scope creep. The three touched files are exactly what the plan's Phase 3 step list calls for. The
`wireBody` local (reusing one `.toString()` call for both the capture and the POST body, instead of
calling it twice) is a correctness-neutral simplification directly motivated by needing the wire
string at the capture site — not unrelated cleanup — and matches the plan's own opinionated example.

### Risk Assessment & Rollout
This touches the OAuth grant path (high-risk, security-sensitive), but the change is additive and
gated entirely behind an optional `httpObserver` config field — a client that doesn't supply one gets
identical behavior (verified: `fireRequest`/`fireResponse`/`fireError` all no-op when `observer` is
undefined). No secret newly reaches a log: the only logging this phase's new code path can trigger
beyond the pre-existing `debug`/`warn` lines is the swallow-`warn`, which logs only the callback name,
never the event payload. No feature flag is needed beyond the existing optionality of the config
field itself, consistent with the rest of the seam's rollout posture (Phases 1/2 already established
this pattern; this phase doesn't introduce new rollout risk).

### Dependencies & Licenses
No new dependencies.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| — | — | — | — | — | No findings. | — |
