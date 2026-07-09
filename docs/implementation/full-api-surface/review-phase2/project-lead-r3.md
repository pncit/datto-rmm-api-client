## project-lead — round 3

No `project-lead` finding was `Open` entering this round (`project-lead-r1-f1` was ratified `Closed` in
round 2; round 2 raised nothing new). Nothing to carry forward.

Did a fresh exhaustive pass over everything the round-3 reviser turn touched (scoped via `git diff
HEAD` against the round-2 checkpoint, matching the disposition table in `reviser-r3.md`):
`scripts/lib/schema-walk.mjs` (new `HTTP_METHODS`/`refName`/`COMPONENTS_SCHEMAS_PREFIX` exports,
`SUBSCHEMA_KEYWORDS` un-exported), `scripts/patch-spec.mjs` (import switch, JSDoc-only annotations),
`scripts/widen-response-enums.mjs` (`buildReachabilityMaps` now iterating every content type,
`matchCount`/`totalMatchCount` replacing `changedCount` as the widening post-condition's signal,
`matchedRequestOnlyNames` replacing `rootExcludedNames`), the new `tests/generated/strict-fixture-types.ts`
and its `satisfies` usages in `patch-spec.test.ts`/`widen-enums.test.ts`, and `pipeline-run.json`.
None of it touches requirements substance (R4/R8/R15 — success-response synthesis, void-write
anchoring, reproducibility — and R5 — the widening codemod's own transform) established Fully Met in
round 2; it is exclusively closing architect/engineer/typescript-cop's mechanical-correctness and
type-safety findings. Cross-checked each disposition's specific claim against the diff rather than
trusting the prose:

- `buildReachabilityMaps`'s content-type widening (architect-r2-f1) is real and mirrors
  `patch-spec.mjs`'s own `computeReachableComponentNames`, which already iterated every response
  content type (not just `application/json`) before this round — so the two reachability
  computations the pipeline depends on (orphan-pruning vs. widen-discrimination) are now
  consistent with each other, closing a latent asymmetry rather than just the immediate finding.
- `matchedRequestOnlyNames` (architect-r2-f2) and `totalMatchCount` (engineer-r2-f1) genuinely
  decouple the two post-conditions in `verifyWideningHappened` from the signals the findings
  showed were vacuous/wrong (`rootExcludedNames`, `changedCount`), and both are exercised by new
  targeted unit tests reproducing the exact scenario each finding described.
- The `HTTP_METHODS`/`refName`/`COMPONENTS_SCHEMAS_PREFIX` hoist (engineer-r2-f2) and
  `SUBSCHEMA_KEYWORDS` un-export (engineer-r2-f3) are behavior-preserving; `patch-spec.mjs`'s own
  `computeReachableComponentNames`/`patchRequestResponseSplits` now consume the shared constants
  rather than a duplicated copy.
- `strict-fixture-types.ts` + the `satisfies` annotations (typescript-cop-r2-f1) are test-only,
  scoped to fixture literals, and don't narrow the production `SchemaNode`/`OpenApiOperation`
  parameter types the real `patchSpec(spec)` call sites depend on staying permissive.
- The Exit Gate's R15 guard is unaffected: `orval.config.ts`, `vitest.repro.config.ts`, and the two
  CI workflows' explicit `test:repro` steps (round 2's fix for architect-r1-f3) are untouched this
  round, and the architect-r2-f1 disposition records a direct `git diff --exit-code src/generated`
  check after regenerating against the real spec.

No new requirements, behavior/intent, scope, risk/rollout, or dependency issue found. This round's
diff is a narrowly-scoped, well-tested tightening of the generation pipeline's own self-checks — not
a candidate for new findings at this review's altitude.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
