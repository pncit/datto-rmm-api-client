## typescript-cop — round 3

Scope re-confirmed via `git diff main...iss13`: within this agent's remit, Phase 1's source diff is
unchanged since round 2 — `src/validation.ts` and `src/__tests__/validation.test.ts` are byte-identical
to what round 2 reviewed (confirmed by diffing the current working tree against the round-2 turn's
quoted line numbers/content). The only changes since round 2 are to
`docs/implementation/resilient-device-validation/implementation-phase1-notes.md` and
`pipeline-run.json` (reviser-r5, disposing `project-lead-r2-f1`/`-f2`, both non-code documentation
fixes) and the untracked `reviser-r5.md` turn itself — none touch TypeScript source, so there is
nothing new to re-verify at the type-safety layer.

Re-read `src/validation.ts` end-to-end against this round's lens (type holes, narrowing/exhaustiveness,
boundary validation, async correctness, public export hygiene) with no residual doubt from prior
rounds:

- `data as T` / `item as T` / `items as T[]` casts in `off`/`warn` branches remain the pre-existing
  `off`-mode pattern plus the design-mandated raw-passthrough for `warn` (R8) — settled, not re-raised.
- `firstIssuePath`, `toProblemError`'s `identityOverride`, the hoisted `Array.isArray` guard, and the
  shared log-prefix constants (all landed by `reviser-r4`, ratified by this agent in round 2) are
  unchanged and still correctly typed: `firstIssuePath(error: ZodError): string` takes a concrete
  `ZodError`, not `unknown`; `identityOverride?: string` is additive and doesn't widen or weaken the
  existing four-argument call sites.
- `validation.ts`'s exports (`validate`, `validateItems`, `toProblemError`, `firstIssuePath`,
  `VALIDATION_ERROR_TYPE`, `VALIDATION_ERROR_STATUS`) remain absent from `src/index.ts`'s barrel
  (confirmed: `export *`s only `client.js`/`config.js`/`result.js`/`schemas.js`) — none of this
  phase's new surface reaches the public API.
- No floating promises, no new `async`, no exhaustiveness gaps — the module is still synchronous.
- `src/__tests__/validation.test.ts` still narrows correctly at every simulated-bad-value site (the
  non-array-cast-through-`unknown` pattern at `:139`/`:199`, the `Record<string, unknown>` narrowing
  at `:166` that closed `typescript-cop-r1-f1`); no `any` reintroduced.

My round-1 finding (`typescript-cop-r1-f1`) was already `Closed` (ratified) as of round 2 and stays
closed — no regression. No new findings this round.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|-----------------|
| typescript-cop-r1-f1 | Low | Closed | TypeHole | — | — | Ratified (round 2) and re-confirmed unchanged this round: `src/__tests__/validation.test.ts:166` still reads `(valid[0] as Record<string, unknown>).extra`, not `as any`. |
