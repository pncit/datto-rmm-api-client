## project-lead — round 2

In-progress review. My round-1 turn (`project-lead-r1.md`) raised zero findings, so there is nothing
of mine to carry forward. Re-scoped via `git diff main` to Phase 2's files
(`src/http/http-client.ts`, `src/client/datto-rmm-client.ts`, `tests/unit/http/http-client.test.ts`)
and re-read the round-1 reviser disposition (`reviser-r1.md`) plus this round's sibling turns
(`architect-r2.md`, `engineer-r2.md`, `typescript-cop-r2.md`, `triage-r2.md`) for context only — not
as a substitute for verifying the diff myself.

The only round-2 delta from my domain's perspective is the human-ruled fix for `engineer-r1-f1`/`f2`
(replacing the manual `${baseURL}${url}` concatenation with `instance.getUri(requestConfig)` at
`src/http/http-client.ts:388`) plus its two new tests and the corresponding `design.md`/`plan.md`
prose amendments — none of which were project-lead findings, and none of which touch requirements
coverage, scope, or rollout risk in a new way. I re-verified the full current `http-client.ts` and
`datto-rmm-client.ts` against the design's Decision 2/4/5 and R2/R4–R9 independent of the other
reviewers' conclusions:

- Interceptor registration order is still observer (registered first, in `createHttpClient`) → rate
  limiter (registered second) → Bearer (`AuthManager.attachTo`, registered later from
  `DattoRmmClient`'s constructor); axios's LIFO execution order therefore still runs Bearer, then
  rate-limit, then observer last, so `onRequest` still fires post-throttle/post-auth and `durationMs`
  still excludes throttle wait.
- `fireError` in `handleResponseError` still sits immediately after the `!axios.isAxiosError` guard
  and before every status branch (403/401/429/5xx/final throw), so every dispatched attempt —
  including one about to be retried — still fires exactly one terminal `onError` before the retry
  re-dispatches (R2), and the two non-dispatched paths (rate-limiter reject, lazy Bearer
  `getToken()` throw) still never reach it.
- `httpObserver` is still threaded raw/unmasked from `DattoRmmClient` into `createHttpClient`'s
  config only (not yet into `AuthManager`, correctly deferred to Phase 3) — no scope creep.
- No new dependency; diff remains confined to the three files the plan names for this phase (plus
  the doc/process artifacts the ruling required).

No new requirements/behavior/scope/risk/dependency issue found this round.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|-----------------|
