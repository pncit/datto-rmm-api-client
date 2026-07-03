## architect — round 1

Code Review Mode, exhaustive. Scope: Phase 1 diff vs `origin/main` — the only production change is
`src/validation.ts` (logger-aware `validate()`, new `validateItems()`, `toProblemError()`,
`extractIdentity()`, shared `VALIDATION_ERROR_TYPE`/`VALIDATION_ERROR_STATUS`) plus the new unit test
`src/__tests__/validation.test.ts`. No prior architect turns exist in this review dir, so this is a
fresh review with no carry-forward.

### Architecture assessment

Boundaries are sound. `validation.ts` remains off the `src/index.ts` barrel (barrel exports only
`client/config/result/schemas`), so `validateItems`, `toProblemError`, and the two constants are
genuinely non-public — R4's public-surface constraint holds. Dependency direction is clean:
`validation.ts → result.ts` (pure type module, no imports) and `validation.ts → logger.ts` (pure),
with no cycle. Placing the `ZodError → ProblemError` mapping (`toProblemError`) at the validation
boundary is the correct owner for that DTO-construction responsibility. The `status: 400` literal is
the pre-existing convention carried over from `client.ts` (not introduced here), so it is out of
scope for this phase.

The findings below are the maintainability/reuse seams this phase *establishes* and that Phase 2 will
build on — worth fixing now, before Phase 2 copies the patterns. None block the build.

### Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | Low | Open | Architecture | `src/validation.ts:36` (`validate` warn) and `:100` (`toProblemError`) | The first-issue-path extraction `result.error.issues[0]?.path?.join(".") \|\| "(root)"` is duplicated verbatim in two places, and the plan (Phase 2 Step 3) directs a **third** verbatim copy into `client.ts`'s envelope hard-fail. This is the exact "which field drifted" convention the plan repeatedly insists must be identical across all `validation-error` sites, yet there is no single source of truth for it — each site can drift independently. | Extract one small exported helper in `validation.ts`, e.g. `export function firstIssuePath(error: ZodError): string { return error.issues[0]?.path?.join(".") \|\| "(root)"; }`, and call it from both the `validate` warn branch and `toProblemError` now. Phase 2 then imports it for the envelope path instead of hand-copying, keeping the path convention centralized. |
| architect-r1-f2 | Low | Open | Architecture | `src/validation.ts:110-118` (`extractIdentity`) | The phase notes/plan claim `validateItems`/`toProblemError` are fully generic ("carries no domain-specific copy", reusable for "a future paginated collection endpoint") — but identity extraction hardcodes the `id`/`uid` field conventions. A future collection whose entities are keyed by some other field silently degrades to `index N`, so the "generic reuse" claim is only half-true: the *label* is injectable, the *identity* is not. This is a leaky abstraction relative to the stated reuse goal. | Make the reuse boundary honest: either document on `extractIdentity`/`toProblemError` that identity extraction is best-effort and limited to `id`/`uid` (falling back to index for entities keyed otherwise), or accept an optional identity-field list / extractor so a non-device caller can name its own key. A one-line doc comment stating the `id`/`uid` limitation is the minimum. |
| architect-r1-f3 | Low | Open | PublicAPI | `src/validation.ts:93-108` (`toProblemError` signature) | `toProblemError(entityLabel, error, item, index)` is exported specifically so Phase 2's single-value `getDeviceByUid` can reuse it, but its `(item, index)` shape is array-centric. The single-value caller knows the requested `uid` from its own method argument, yet the builder can only derive identity from the parsed `item` — so a device body that drifts on its `id`/`uid` fields produces the misleading `"... index 0 ..."` detail even though the caller holds the real uid. The reuse contract set in this phase cannot carry a caller-known identity. | Widen the builder so the single-value reuse can inject a known identity, e.g. add an optional `identityOverride?: string` (used verbatim when present, else `extractIdentity(item) ?? \`index ${index}\``). Lets `getDeviceByUid` pass its uid and avoids the meaningless `index 0` for a non-array caller. |
