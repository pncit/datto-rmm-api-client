## implementation-auditor — round 2

Scope re-reviewed: the Phase 1 implementation in the working tree. `src/validation.ts` was
checkpointed into `HEAD` (`512d883`), so `git diff HEAD` now shows only the reviser's
`src/__tests__/validation.test.ts` edits (+ the `pipeline-run.json` harness artifact, not
implementation). I re-read `src/validation.ts` in full and diffed the test changes. No protected
file (`schemas.ts`/`result.ts`/`index.ts`) changed and no `client.ts`/envelope work leaked in — the
Phase 1 R4 guard and scope discipline still hold. Tests not run, per skill policy.

### Round-1 disposition re-verification
- **implementation-auditor-r1-f1 (Fixed → ratified):** `validation.test.ts:27-29` now asserts
  `.toThrow(ZodError)` with `ZodError` imported from `zod/v4` (line 1). The thrown *type* — the
  load-bearing `e instanceof ZodError` contract Phase 2's `getDeviceByUid` keys on — is now pinned.
  Closed.
- **implementation-auditor-r1-f2 (Fixed → ratified):** both `warn`-path tests now install
  `jest.spyOn(console, "warn")` and assert `not.toHaveBeenCalled()`, restored in a `finally`
  (`validation.test.ts:36-53` and `:109-135`). A stray `console.warn` alongside `logger.warn` would
  now fail. Closed.

### New findings this round
Two residual Low test/comment-hardening items, consistent with the round-1 posture of pinning the
exact contracts this feature turns on. Implementation behavior is correct and matches the plan.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| implementation-auditor-r1-f1 | Low | Closed | Tests | `src/__tests__/validation.test.ts:27-29` | ratified: bare `.toThrow()` was changed to `.toThrow(ZodError)` (import added line 1), pinning the thrown type that Phase 2's `getDeviceByUid` fatality check depends on. | — |
| implementation-auditor-r1-f2 | Low | Closed | Tests | `src/__tests__/validation.test.ts:36-53, 109-135` | ratified: both `warn`-path tests now spy on `console.warn` and assert it stays uncalled (restored via `finally`), guarding the console→`config.logger` routing (R6). | — |
| implementation-auditor-r2-f1 | Low | Open | Docs | `src/validation.ts:7-9, 88-91` | Evergreen-comment violation (skill criterion 6): three source comments carry `(Phase 2)` plan-phase scaffolding — `"reused by … the envelope hard-fail in client.ts (Phase 2)"` (7-9) and `"getDeviceByUid's catch (Phase 2)"` (88-91). Once Phase 2 lands, `(Phase 2)` is a stale, meaningless reference to the build plan embedded in shipped code — the exact "no phase N" anti-pattern. The *why* (shared error shape, non-barrelled module) is worth keeping; the phase tags are not. | Drop the `(Phase 2)` parentheticals and phrase the reuse in the present tense (e.g. "reused by the envelope hard-fail in `client.ts`" / "shared by `validateItems` and `getDeviceByUid`'s catch"), keeping the rationale but no plan-phase references. |
| implementation-auditor-r2-f2 | Low | Open | Tests | `src/__tests__/validation.test.ts:89` | The strict `validateItems` test asserts only `warnings[0].raw` `toBeDefined()`, not that it is a `ZodError`. The plan's Phase 1 test spec and design R2 require "the `ZodError` in `raw`", and Phase 2 sites (envelope hard-fail, `getDeviceByUid`) all rely on `raw` carrying the full `ZodError` for consumers. A regression that stored a plain object/string in `raw` would pass — the same gap class as r1-f1 (a `toBeDefined` that doesn't pin the type). | Assert `expect(warnings[0].raw).toBeInstanceOf(ZodError)` (import already present) so the preserved-error contract is pinned, not merely non-undefined. |
