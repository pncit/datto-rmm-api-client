## typescript-cop — round 3

In-progress review. Round 1 raised one finding (`typescript-cop-r1-f1`); round 2 ratified it
`Closed` after re-verifying the `assertOk`/`assertFail` narrowing fix, leaving zero prior `Open`
findings to carry forward into this round.

Scope this round: `git diff e8dc461...HEAD` (Phase 1 completion → HEAD) plus the current uncommitted
working-tree delta (`git diff HEAD`) — i.e. `src/client.ts`, `src/internal/devicesEnvelope.ts`,
`src/__tests__/devicesMethod.test.ts`, and the one Phase-2-consumed edit to `src/validation.ts`
(the `reviser-r4` fix for `engineer-r2-f1`: removed the dead `identityOverride` parameter from
`toProblemError` and gave `index` a default of `0`). Confirmed `src/validation.ts` is otherwise
byte-identical to `e8dc461`, and `schemas.ts`/`result.ts`/`index.ts`/`logger.ts` are untouched.

- **The only production delta since round 2 is type-safe.** `toProblemError`'s signature narrowed
  from `(entityLabel, error, item, index: number, identityOverride?: string)` to
  `(entityLabel, error, item, index = 0)` — a strictly smaller, still-fully-typed surface (no
  parameter widened, no new `any`/cast introduced). `validateItems` (`validation.ts:98`) is
  unaffected — it still passes its real array index explicitly, so the default is only reached by
  `getDeviceByUid`'s call site (`client.ts:194`, `toProblemError("Device", e, res.value)`), which
  is exactly the intended fallback. Ran `npx tsc --noEmit -p .` (static check only) — clean.
- Re-confirmed round 1/2's conclusions still hold against the current diff: the envelope
  `safeParse`-before-typed-access boundary pattern, the `off`-mode raw-passthrough casts
  (pre-existing/design-mandated, not new type holes), the `getAllPages<T, P>` generic plumbing
  (`extractor: (page: P) => unknown[]`, every element validated via `validateItems` before being
  treated as `T`), the two `page`-itself optional-chain dereference sites, the shared
  `ProblemError`/`firstIssuePath`/`VALIDATION_ERROR_*` reuse, async/await correctness (no floating
  promises, `catch (e)` narrowed via `instanceof ZodError`), and public-export hygiene
  (`internal/devicesEnvelope.ts` still un-barrelled) are all unchanged and still correct.
- No new type holes, unsafe casts, boundary-validation gaps, narrowing/exhaustiveness issues,
  floating promises, or public-export problems found in this round's delta.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|-----------------|
| _(none)_ | | | | | No open or new typescript-cop findings this round; `typescript-cop-r1-f1` was already `Closed` in round 2. | |
