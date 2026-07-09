## architect — round 4

Code Review Mode, exhaustive. In-progress review: read `reviser-r4.md`, then re-verified each of its
`Fixed` dispositions against the actual working-tree code (not the reviser's digest) and swept the
round-4 revisions for new structural issues. Scope reconfirmed via `git diff main...HEAD` plus the
uncommitted round-4 revisions (`scripts/lib/schema-walk.mjs`, `scripts/patch-spec.mjs`,
`scripts/widen-response-enums.mjs`, `scripts/dedupe-generated-index.mjs`, `tsconfig.test.json`,
`tests/generated/strict-fixture-types.ts`, and the two test files).

**Carry-forward.** Both of my findings (`architect-r2-f1`, `architect-r2-f2`) were already ratified
`Closed` in my round-3 turn; per carry-forward discipline they are settled and not re-listed. Nothing
of mine was `Open` entering this round.

**Round-4 revisions — verified, no new findings.**

- `engineer-r3-f1` (the `walkAllSchemaNodes` traversal was the lone content-type-narrow /
  `HTTP_METHODS`-filter-free copy among four siblings) — the reviser took the stronger option and
  extracted one `forEachOperation(spec, visit)` helper into the dependency-free leaf
  `scripts/lib/schema-walk.mjs`, routing all four operation traversals through it
  (`computeReachableComponentNames`, `patchMissingSuccessResponses`, `walkAllSchemaNodes`,
  `buildReachabilityMaps`). This is the right seam: it removes the duplicated
  `for(paths) -> for(methods, HTTP_METHODS filter) -> operation` boilerplate and makes future
  filter/content-type drift structurally impossible. `walkAllSchemaNodes` now iterates every content
  type of `requestBody`/each response (l.541-549), matching its three siblings. Verified no stranded
  references: `HTTP_METHODS` is no longer imported by either pipeline script (only `schema-walk.mjs`
  consumes it internally), and every prior call site now calls `forEachOperation`. No new cross-module
  cycle or boundary inversion — `schema-walk.mjs` remains a leaf; the two `OpenApiOperation` /
  `OpenApiSpecFragment` typedefs it adds are consumed only by its own callers. Sound.

- `typescript-cop-r3-f1` (`checkJs` was off, so the `.mjs` pipeline scripts were untyped) — the
  reviser enabled `checkJs: true` in `tsconfig.test.json`, which is the project that already
  `include`s `scripts/**/*.mjs` and is run by `npm run typecheck:test` (part of the `typecheck`
  gate). The added JSDoc annotations and the two genuine fail-loud fixes (`schema-walk.mjs`'s
  `SchemaNode[] | undefined` cast at the `allOf/oneOf/anyOf` read site; `applyWidening`'s explicit
  `throw` on a missing `primaryNamesByFile` entry naming the two-map invariant) are correct
  boundary-level hardening — the latter turns a silent `undefined is not iterable` crash into a
  named programming-error throw, which is the right posture for an internal invariant. No behavior
  change to generated output. Sound.

- `typescript-cop-r2-f1` (hand-typed spec fixtures escaped excess-property checks via the production
  typedefs' index signature) — `StrictOpenApiSpecFragment` added to `strict-fixture-types.ts` and
  applied via `satisfies`. The closed mirrors are deliberately parallel to (not shared with) the
  production typedefs and are confined to the test surface; the ownership rationale is documented.
  This is type-fixture territory owned by `typescript-cop`, not an architecture concern. No leakage
  into the published package surface.

None of the round-4 revisions touch module boundaries, dependency direction, the data model, the
package's public/published API surface, hot paths, or input-validation boundaries in a way that
introduces risk. No new findings.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
