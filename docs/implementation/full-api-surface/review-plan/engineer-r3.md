## engineer — round 3

Plan Review Mode, round 3 (in-progress review). Read my `engineer-r1`/`engineer-r2` turns and the
reviser's latest dispositions (`reviser-r7`), then re-verified each disposition against the current
`plan.md`.

**Ratification of prior findings (all remain `Closed`).** Every `engineer-r1-f1…f16` and
`engineer-r2-f1…f5` finding was `Accept`ed by the reviser and I confirmed each fix is actually
present in the plan text:
- r2-f1: `WRITE_LIMITS` now enumerates every concrete write `opKey` as an explicit key (P5 Step 1,
  `device-udf-set` 600 + thirteen `…: 100` keys) and states the "add a write ⇒ add its key first"
  rule — the closed `WriteOpKey` union compiles for all writes. Ratified.
- r2-f2: `defaultWriteLimit` dropped from `config.rateLimit` (P3 Step 4) and `DEFAULT_WRITE_LIMIT`
  restated as a limiter-only defensive fallback reachable solely via the untyped `acquire` boundary
  (P5 Steps 1–2). Ratified.
- r2-f3: coverage-map test now supplies a per-write-op minimal valid sample body (P8 Step, coverage-map).
  Ratified (but see r3-f1 — the "every write op" phrasing overreaches bodiless writes).
- r2-f4: `MAX_RETRY_AFTER_MS = 30_000` in `defaults.ts`; P5 Step 3(b) + example + test bound the
  honored `Retry-After`. Ratified.
- r2-f5: value-in-`meta` masking invariant made explicit at `withUdfMasking` (P3 Step 3) and threaded
  into P4 Step 3 and P6 Step 1. Ratified.

I then re-swept the five plan-review axes for issues introduced or exposed by the round-2 revisions.
Two new findings follow (both surfaced by the round-2 coverage-map / transport-isolation edits).
Architecture-level and requirements-coverage concerns remain deferred to `/architect` and
`/project-lead`. Convergence is holding — fewer findings than prior rounds.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r3-f1 | Medium | Open | ErrorHandling | Phase 8 coverage-map test (line ~564: "for each write op, a minimal valid sample body … `surface`/coverage tests fail if a write op lacks a sample body") vs Phase 5 Step 1 write-op set + Phase 6 Step 1 `httpDelete`/write-body overrides | The r2-f3 fix requires **every** write op to carry a minimal valid sample body that satisfies "that op's write-body override" so `validateRequest` passes and the request reaches nock — and makes the test **fail if a write op lacks a sample body**. But several enumerated writes have **no request body and no write-body override**: `filter-delete` is a `DELETE` (`httpDelete` carries an `opKey` but sends no validated body), and the bodiless-POST writes (`alert-resolve`, `alert-unmute`, `user-reset-keys`, and likely `device-move`/`alert-mute`) mutate via path/verb alone. For those ops `validateRequest` is never run, so there is nothing for a sample body to satisfy — yet the coverage test as worded would *fail* because they "lack a sample body," making an exit-gate test contradictory for the write ops it is meant to cover. | Scope the sample-body requirement to write ops that **actually declare a request-body override**: those get a minimal valid sample body; bodiless writes (DELETEs, path/verb-only POSTs) reach the nock intercept with placeholder **path params only** and are explicitly exempt from the "lacks a sample body ⇒ fail" rule. State that the per-op sample-body factory has an entry **only** for ops with a write-body schema. |
| engineer-r3-f2 | Low | Open | ErrorHandling | Phase 5 Step 4 ("**Transport isolation**: bare axios instance … **no v2 error mapping**") vs Phase 5 Tests (line ~403: "a failed grant throws `DattoApiError`") | The token grant/refresh round-trip is deliberately routed through a **separate bare axios instance with none of the shared instance's response interceptors — explicitly "no v2 error mapping."** But the auth test requires a failed grant to throw a `DattoApiError`. With the mapping interceptor removed from the auth path, a raw `AxiosError` would propagate unless `AuthManager` maps it itself — and the plan never says where that mapping happens for auth, though it is meticulous about homing every other error-construction site (`isRateLimitBlock`, `fromAxiosError`, the 403/429 sites). An implementor could reasonably let the bare `AxiosError` escape, failing the test. | State that `AuthManager` wraps its own grant/refresh failures — e.g. catches the `AxiosError` from the bare instance and rethrows `DattoApiError.fromAxiosError(err)` — since its isolated transport has no mapping interceptor. Pin this in Phase 5 Step 4 so the "failed grant throws `DattoApiError`" test has a defined source. |
