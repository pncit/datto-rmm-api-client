## project-lead — round 3

In-progress review. Read my `project-lead-r2` turn and the reviser's `reviser-r3` disposition (which
marks `project-lead-r2-f1` and the unrelated `engineer-r2-f1` `Fixed`), then re-verified the fix against
`git diff HEAD -- src/auth/auth-manager.ts src/http/http-client.ts tests/unit/auth/auth-manager.test.ts
tests/unit/http/http-client.test.ts` (the only Phase 5 source/test delta since r2) and re-read the whole
Phase 5 tree (`src/rate-limit/**`, `src/http/**`, `src/auth/**`) fresh for anything the round-3 fixes
introduced. All three r1 findings were already `Closed` as of my r2 turn and are not re-listed per the
carry-forward rule.

Re-verification: `handleResponseError` (`src/http/http-client.ts`) now takes `error: unknown` (the
response interceptor's rejection handler is typed to match) and guards `if (!axios.isAxiosError(error))
throw error;` before any `.response`/`.config` access, so a `DattoApiError` thrown by an upstream
request interceptor on the same instance (the documented `AuthManager.attachTo` composition) now
propagates unchanged — confirmed against the new "propagates an already-typed DattoApiError thrown by
an upstream request interceptor unchanged" test, which asserts `error).toBe(upstreamError)` (identity,
not just shape) with the original `statusCode`/`response` intact. This closes `project-lead-r2-f1`.

Requirements coverage is unchanged from r2 and now clean: R10/R11 remain Fully Met; R12 is Fully Met
(both gaps noted in round 1 — missing `requestId` on direct-construction error paths, and untested
`Retry-After`-header-alone 403 classification — were closed in round 2 and hold).

No new findings. The round-3 diff is narrowly scoped to the two outstanding fixes, both correctly
targeted with no collateral behavior change or scope creep, and each has a regression test that
exercises the actual defect (identity-preservation for the interceptor-composition fix; absence of the
raw grant body plus a serialization check for the credential-exposure fix).

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| project-lead-r2-f1 | High | Closed | Risk | — | — | ratified: `handleResponseError` (`src/http/http-client.ts`) now guards `if (!axios.isAxiosError(error)) throw error;` before touching `.response`/`.config`, and its parameter type (and the response interceptor's rejection-handler type) changed to `unknown`. A `DattoApiError` thrown by an upstream request interceptor on the same instance (e.g. the documented future `AuthManager.attachTo` wiring) now reaches the caller unchanged instead of being lossily reconstructed via `DattoApiError.fromAxiosError` with a discarded real `statusCode`/`response`/`requestId`. Verified by the new test asserting the identical error object (`toBe`) with its original `statusCode`/`response` reaches the caller. |
