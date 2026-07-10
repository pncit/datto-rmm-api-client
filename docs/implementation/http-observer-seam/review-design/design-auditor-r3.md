## design-auditor — round 3

Continuing the review. I read my r1/r2 turns, the reviser's r1/r2 dispositions, and both triage
rounds. Only one finding was `Open` entering this round — `design-auditor-r2-f1` (reviser marked it
`Fixed`). I re-verified that fix against the current `design.md` and re-checked the underlying grant
path in source. The five r1 findings were `Closed` in earlier rounds and are not re-listed.

### Re-verification of `design-auditor-r2-f1` (grant post-2xx malformed-token terminal selection)

- **Decision 4** (design.md:161–165) now states terminal selection follows the **HTTP status of the
  physical response**, not whether the surrounding method throws, and names the grant's post-2xx
  malformed-token `DattoApiError` as a second instance of the `DattoValidationError` carve-out: a 2xx
  grant with a malformed body fires `onResponse` (raw 2xx body) and its subsequent `DattoApiError`
  does **not** fire `onError`. The instrumentation constraint is pinned (design.md:165): the grant
  path must fire `onResponse` off the resolved 2xx **before** `safeParse` runs, so the post-parse
  throw cannot re-enter a terminal event.
- **Non-Goals** (design.md:32) now enumerates the non-firing set in one place — `DattoValidationError`,
  the grant's malformed-token `DattoApiError` (thrown after a 2xx token POST), and pagination
  cursor/guard failures.
- **Success Criteria** (design.md:233) and **Verification** (design.md:240) pin the malformed-2xx
  grant case: exactly one terminal event (`onResponse` with the raw response body), no `onError`,
  even though `performRefresh` throws a `DattoApiError`.
- **Source cross-check** (`src/auth/auth-manager.ts:134–187`): the pre-response failures
  (axios-error and non-axios catch, lines 155–164) map to `DattoApiError` on a non-2xx/no-response
  outcome → `onError`; the malformed-token branch (lines 166–178) throws a `DattoApiError` with
  `statusCode: response.status` (the 2xx) *after* a successful POST → correctly a post-2xx,
  non-firing `onError` per the tightened Decision 4. This is the only post-2xx `DattoApiError` path
  in the grant; there are no others left unaddressed.

Fix is complete and consistent across Decision 4, Decision 5, Non-Goals, Key Concepts, Success
Criteria, and Verification. Ratified.

No new findings this round. Scope-discipline / additive-bias pass: the r2-f1 remedy was applied by
tightening Decision 4 (no new section, non-firing set consolidated in one place), which is the
correct additive-minimal shape; I found no residual contradiction, false current-state claim, or
under-specified mechanism to raise, and nothing warranting an out-of-scope `Defer:` follow-up.

## Findings

| ID | Severity | Status | Category | Where | Finding | Recommendation |
|----|----------|--------|----------|-------|---------|----------------|
| design-auditor-r2-f1 | Medium | Closed | DesignDecision | Decision 4 / Non-Goals / grant path | ratified: Decision 4 now selects the terminal event by the HTTP status of the physical response (not by a later throw) and names the grant's post-2xx malformed-token `DattoApiError` as a second instance of the `DattoValidationError` carve-out — a 2xx grant with a malformed body fires `onResponse` (raw body) and no `onError`; the instrumentation must fire `onResponse` before `safeParse` (design.md:165). Non-Goals (design.md:32), Success Criteria (design.md:233), and Verification (design.md:240) updated; verified against auth-manager.ts:166–178. | — |
