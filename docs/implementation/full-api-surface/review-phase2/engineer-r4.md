## engineer — round 4

Code Review Mode, exhaustive. Scoped via `git diff origin/main...HEAD` over the hand-written spec
pipeline (`scripts/patch-spec.mjs`, `scripts/widen-response-enums.mjs`, `scripts/lib/schema-walk.mjs`,
`scripts/dedupe-generated-index.mjs`, `orval.config.ts`, `tests/generated/*`, and tsconfig wiring).
The generated tree (`src/generated/**`) and committed `spec/openapi*.json` remain out of scope as
auto-generated / external artifacts.

In-progress review. My only still-Open finding entering this round was `engineer-r3-f1`, which
reviser-r4 dispositioned `Fixed`. I re-verified it against the current working tree, then reviewed
all new/rewritten code the round-4 fixes introduced (the `forEachOperation` extraction in
`schema-walk.mjs` and its four call-sites; the `checkJs: true` JSDoc/type-cast additions across all
three scripts; the fail-loud `applyWidening` throw; the `StrictOpenApiSpecFragment` fixture typing)
for new issues. No new findings.

Re-verification of `engineer-r3-f1` (reviser-r4 `Fixed`):
- The reviser took the finding's "Better" option: extracted the shared
  `for (paths) -> for (methods, HTTP_METHODS filter) -> operation` boilerplate into
  `forEachOperation(spec, visit)` in `scripts/lib/schema-walk.mjs` (l.144-157), which applies the
  `HTTP_METHODS.includes(method)` guard and a non-null-object check, and emits the canonical
  `"METHOD /path"` `opLabel`.
- All four operation-level traversals now route through it: `computeReachableComponentNames`
  (`patch-spec.mjs` l.338), `patchMissingSuccessResponses` (l.485), `walkAllSchemaNodes` (l.541),
  and `buildReachabilityMaps` (`widen-response-enums.mjs` l.214).
- The specific drift the finding named is closed: `walkAllSchemaNodes` (l.541-553) now iterates
  **every** content type of `requestBody`/each response via `Object.values(...content ?? {})`
  (l.545, l.549) instead of the old hard-coded `["application/json"]` lookups, and inherits the
  `HTTP_METHODS` filter automatically. It is no longer the lone content-type-narrow, filter-free
  sibling. `HTTP_METHODS` is no longer imported by either pipeline script directly (only used
  inside `forEachOperation`), so the recognized-method set has a single definition point.
- Reviser reports byte-identical `src/generated` after `npm run generate` + `git diff --exit-code`,
  consistent with the finding's own note that today's spec has no inline schema under a `*/*`-only
  content type (all `*/*` responses are pre-empted by `patchMissingSuccessResponses`). The fix is a
  pure consistency/robustness change with no behavior delta today, exactly as scoped. Ratified.

The residual inner `params/requestBody-content/response-content` iteration still appears in three
of the four call sites, but each body genuinely differs (`followRefs` vs. `walkSchema(node, visit,
visited)` vs. `collectComponentRefs`+`addReach` with asymmetric request-vs-response map routing);
folding it into a further shared helper would require a `kind` discriminator and would obscure more
than it saves. Not a finding — the finding's recommendation (operation-level extraction) is fully
satisfied and this remainder is not a real maintainability defect.

### Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r3-f1 | Low | Closed | DRY / Complexity | `scripts/lib/schema-walk.mjs` `forEachOperation` l.144-157; `scripts/patch-spec.mjs` `walkAllSchemaNodes` l.534-554 (and `computeReachableComponentNames` l.338 / `patchMissingSuccessResponses` l.485); `scripts/widen-response-enums.mjs` `buildReachabilityMaps` l.214 | — | ratified: reviser-r4 extracted the `for (paths) -> for (methods, HTTP_METHODS filter) -> operation` boilerplate into `forEachOperation` and routed all four traversals through it. `walkAllSchemaNodes` now iterates every content type (not just `application/json`) and inherits the `HTTP_METHODS` filter, closing both the content-type-narrow and missing-filter drifts named in the finding in one place; `HTTP_METHODS` has a single definition/import point. Byte-identical generated output confirms no behavior change today. |
