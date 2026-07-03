## typescript-cop — round 4

Re-scoped via `git diff main` (working tree, not just `HEAD`, since `reviser-r6`'s fix is currently
unstaged) against `src/validation.ts` and `src/__tests__/validation.test.ts` — this agent's remit
for Phase 1. The only change since round 3 is `reviser-r6`'s disposition of `architect-r3-f1`:
`VALIDATION_WARN_PREFIX`/`VALIDATION_ERROR_PREFIX` changed from module-private `const` to
`export const`, matching the sibling `VALIDATION_ERROR_TYPE`/`VALIDATION_ERROR_STATUS` pair.
`src/__tests__/validation.test.ts` is byte-identical to what round 3 reviewed. The fixture JSON
changes (`device.json`, `devicesPage*.json`) and the new `review-plan/architect-r5.md` are not
TypeScript source and carry no type-safety concern.

- The newly-exported `VALIDATION_WARN_PREFIX`/`VALIDATION_ERROR_PREFIX` are `string` literals with
  no type widening (still inferred as `string`, not narrowed to a literal type, but they're used
  only as template-string interpolants, not as discriminants — no exhaustiveness or narrowing
  concern). `validation.ts` remains outside the `src/index.ts` barrel, so this new export still
  does not reach the public API surface — re-confirmed.
- All findings and non-findings from rounds 1–3 (the `off`/`warn` `as T`/`as T[]` casts as settled
  design-mandated passthrough, `firstIssuePath`/`toProblemError`'s `identityOverride` as correctly
  additive typing, the hoisted `Array.isArray` guard, no floating promises/new `async`, no
  exhaustiveness gaps) remain unchanged — re-verified against the current file, nothing regressed.
- `typescript-cop-r1-f1` was already `Closed` (ratified round 2, re-confirmed round 3) and stays
  closed — not re-listed per carry-forward discipline (only still-`Open` findings plus this round's
  closures re-appear).

No new findings this round.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|-----------------|

