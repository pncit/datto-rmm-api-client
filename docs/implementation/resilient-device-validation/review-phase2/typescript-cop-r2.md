## typescript-cop — round 2

Reconciled round-1 against the reviser's round-3 disposition, then re-scanned the full Phase-2 diff
(`git diff e8dc461...HEAD` — `src/client.ts`, `src/internal/devicesEnvelope.ts`,
`src/__tests__/devicesMethod.test.ts`; confirmed `src/validation.ts`/`schemas.ts`/`result.ts`/
`index.ts` are still byte-identical to the Phase 1 baseline) for new type-safety issues. Also ran
`npx tsc --noEmit -p .` (a static check only, no code execution) — clean, no errors.

- **typescript-cop-r1-f1 ratified.** All 14 new tests that read a `Result<T>` field now call
  `assertOk(result)`/`assertFail(result)` (defined `devicesMethod.test.ts:68-83` as proper
  `asserts result is Extract<...>` type guards) instead of `const r = result as any;`, so
  `result.ok` narrowing stays live for every subsequent field access. The reviser also fixed the
  latent gaps the blanket `any` cast had hidden: `warnings` reads go through `r.warnings ?? []`
  (legitimately optional on `Result<T>`'s type), the "discarded on later-page failure" assertion
  uses `"value" in r` (stronger than a `toBeUndefined()` on an `any`), and the `off`-mode
  `find()` result is bound and read via `?.deviceClass` rather than assumed present. The two
  pre-existing `(result as any).value` casts (lines 101, 124) predate this phase's diff and sit
  outside this finding's original scope, as the finding itself stated when first raised.
- No new type holes, unsafe casts, boundary-validation gaps, narrowing/exhaustiveness issues,
  floating promises, or public-export problems found in the current diff. The envelope
  `safeParse`-before-typed-access pattern, the `off`-mode casts (unchanged pre-existing behavior,
  already settled in Phase 1/round 1), the shared `ProblemError`/`firstIssuePath` reuse, and the
  `getAllPages<T, P>` generic plumbing all still hold as verified in round 1. `DevicesPageSchema`/
  `DevicesPage` remaining exported-but-unused in `schemas.ts` is a plan-mandated (R4 guard),
  explicitly documented decision (`plan.md:35,205,219`), not a phase-introduced export-hygiene
  defect, so it is not raised as a finding.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|-----------------|
| typescript-cop-r1-f1 | Medium | Closed | TypeHole | — | — | ratified: every new test narrows `Result<T>` via `assertOk`/`assertFail` instead of `result as any`; the two out-of-scope pre-existing casts are unchanged from before this phase's diff. |
