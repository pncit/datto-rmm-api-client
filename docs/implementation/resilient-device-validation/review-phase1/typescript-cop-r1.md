## typescript-cop — round 1

Scope: `git diff` vs `origin/main` for Phase 1 — `src/validation.ts` (modified) and
`src/__tests__/validation.test.ts` (new). No prior `typescript-cop` turn exists in this review
directory, so this is a first-pass, exhaustive type-safety review (not a reconciliation). Other
reviewers' turns in this directory (implementation-auditor r1–r3, reviser r1–r3, gate-runner r1–r2)
were read for context only, per this skill's instruction to disregard an orchestrator's digest and
review the source myself; their findings are not carried into this table since none are
type-safety findings this agent owns.

Reviewed with a strict type-safety lens: type holes/unsafe casts, boundary validation, control-flow
narrowing/exhaustiveness, async correctness, and public export hygiene.

- `validate<T>`'s `off`/`warn` branches (`data as T`) and `validateItems`'s `off`/`warn` branches
  (`item as T`, `(Array.isArray(items) ? items : []) as T[]`) are all unvalidated casts from
  `unknown`/`unknown[]` to `T`/`T[]`. These are not new type holes: they reproduce the pre-existing
  `off`-mode cast already in `validate()` before this phase, and the `warn`-mode raw-passthrough cast
  is an explicit, already-approved design requirement (R8 / Decision 1's "keep every item raw"
  rationale) — re-litigating it here would contradict a settled design decision, which is out of this
  agent's scope.
- `switch (mode)`'s `default: throw new Error(...)` in `validate()` is dead code once `mode` is
  narrowed to `"strict" | "warn"` by the preceding `off` early-return, but it is unchanged from the
  pre-phase file and functions as a harmless defensive fallback, not a narrowing defect.
- `toProblemError`/`extractIdentity` narrow `unknown` via `typeof`/truthiness checks before casting
  to `Record<string, unknown>` — a correctly-guarded pattern, not a bypass.
- `validation.ts`'s new exports (`validateItems`, `toProblemError`, `VALIDATION_ERROR_TYPE`,
  `VALIDATION_ERROR_STATUS`) are confirmed absent from `src/index.ts`'s barrel (`export *` of only
  `client.js`/`config.js`/`result.js`/`schemas.js`), so none of them reach the public surface.
- No floating promises, no new `async` functions, no `Promise.all`/`allSettled` concerns — this phase
  is synchronous.

One new, real (if minor) type hole was introduced in the test file.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| typescript-cop-r1-f1 | Low | Open | Type Holes | `src/__tests__/validation.test.ts:124` | `expect((valid[0] as any).extra).toBe("keepme")` casts to `any` to reach an unknown-to-the-schema property, rather than a narrower type. `any` here silently disables checking on the entire expression, and the file otherwise avoids `any` (it uses a proper double-cast-through-`unknown` at lines 157/165 to simulate a bad runtime value). | Replace `as any` with `as Record<string, unknown>` (e.g. `(valid[0] as Record<string, unknown>).extra`), consistent with the narrowing style already used elsewhere in this file and in `extractIdentity`. |
