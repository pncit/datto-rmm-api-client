## engineer — round 3

Code Review Mode, exhaustive. Scoped via `git diff origin/main...HEAD` over the hand-written
pipeline (`scripts/patch-spec.mjs`, `scripts/widen-response-enums.mjs`,
`scripts/lib/schema-walk.mjs`, `scripts/dedupe-generated-index.mjs`, `orval.config.ts`, the
`tests/generated/*` suites, `tests/generated/strict-fixture-types.ts`, and tsconfig wiring). The
generated tree (`src/generated/**`) and committed `spec/openapi.*.json` remain out of scope as
auto-generated / external artifacts.

In-progress review: my three round-2 findings (`engineer-r2-f1` … `engineer-r2-f3`) were all
dispositioned `Fixed` by reviser-r3. I re-verified each against the current tree — all landed as
claimed and are ratified `Closed` below. I then reviewed the new/rewritten code the round-3 fixes
introduced (the `ENUM_ALIAS_RE` broadening + `matchCount`/`totalMatchCount` threading, the
`matchedRequestOnlyNames` split in `computeRootExclusion`/`verifyWideningHappened`, the
all-content-types rewrite of `buildReachabilityMaps`, `strict-fixture-types.ts`, and the new
regression tests) for new issues. One new finding, non-blocking.

Re-verification notes:
- **engineer-r2-f1** — `verifyWideningHappened`'s first invariant is now keyed on
  `widenedMatchCount` (the `totalMatchCount` returned by `applyWidening`), which counts enum-alias
  declarations matched *in memory* independent of disk writes. `ENUM_ALIAS_RE` was broadened with
  an optional trailing `(?: \| \(string & \{\}\))?` so it matches both the un-widened and
  already-widened alias forms; a second pass over already-widened output therefore still counts
  every alias (`applyWidening` test l.143-164 asserts `totalMatchCount === 1` on the second pass).
  `changedCount` survives only as the disk-write count in `main()`'s log line. The
  idempotent-re-run false failure the finding described can no longer occur. Ratified.
- **engineer-r2-f2** — `HTTP_METHODS`, `refName`, and a new `COMPONENTS_SCHEMAS_PREFIX` constant
  are now exported from `scripts/lib/schema-walk.mjs` and imported by both `patch-spec.mjs`
  (l.47) and `widen-response-enums.mjs` (l.79); the two remaining bare prefix literals in
  `patchRequestResponseSplits` (l.266, l.271) build off `COMPONENTS_SCHEMAS_PREFIX`. No copy
  remains in either script. Ratified.
- **engineer-r2-f3** — `SUBSCHEMA_KEYWORDS` is now a module-local `const` (the `export` keyword is
  gone, l.50); grep confirms no importer. Ratified.

### Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r2-f1 | Medium | Closed | ErrorHandling / Complexity | `scripts/widen-response-enums.mjs` `verifyWideningHappened` / `applyWidening` / `ENUM_ALIAS_RE` | — | ratified: invariant 1 now keys on `widenedMatchCount` (in-memory match count, disk-write-independent); `ENUM_ALIAS_RE` matches both un-widened and already-widened forms so an idempotent re-run keeps `totalMatchCount > 0`; regression test (l.143-164) confirms. The documented "running it twice is a no-op" contract no longer conflicts with the post-condition. |
| engineer-r2-f2 | Low | Closed | DRY | `scripts/lib/schema-walk.mjs`; `scripts/patch-spec.mjs`; `scripts/widen-response-enums.mjs` | — | ratified: `HTTP_METHODS`, `refName`, `COMPONENTS_SCHEMAS_PREFIX` hoisted to the shared lib and imported in both scripts; the bare `"#/components/schemas/"` literals in `patchRequestResponseSplits` now derive from the constant. |
| engineer-r2-f3 | Low | Closed | DeadCode | `scripts/lib/schema-walk.mjs` l.50 | — | ratified: `SUBSCHEMA_KEYWORDS` de-exported (now module-local `const`); no importer exists. |
| engineer-r3-f1 | Low | Open | DRY / Complexity | `scripts/patch-spec.mjs` `walkAllSchemaNodes` l.505-520 (vs. `computeReachableComponentNames` l.305-327 and `widen-response-enums.mjs` `buildReachabilityMaps` l.181-208) | Round 3's `architect-r2-f1` fix rewrote `buildReachabilityMaps` to iterate **every** content type of each `requestBody`/response ("mirroring `patch-spec.mjs`'s own `computeReachableComponentNames`"), and `computeReachableComponentNames` already does the same. But the third operation-level traversal in the same file — `walkAllSchemaNodes`, which drives the `fixMalformedNonStringConstraints` malformed-keyword sweep — was **not** aligned: it still hard-codes `operation.requestBody?.content?.["application/json"]?.schema` (l.512) and `response?.content?.["application/json"]?.schema` (l.516), so an inline (non-`$ref`) schema present only under a `*/*` (or any non-`application/json`) request/response content type is never visited by the malformed-keyword stripper. It is now the lone content-type-narrow traversal among three siblings — exactly the "which content types carry a schema" divergence `architect-r2-f1` closed elsewhere. Two secondary drifts compound it: (a) `walkAllSchemaNodes`'s operation loop (l.506-507) omits the `HTTP_METHODS.includes(method)` guard that all three sibling loops apply, so it treats PathItem-level siblings (`parameters`, `summary`, `servers`, …) as operations — harmless today only because they lack `requestBody`/`responses` keys; (b) the `paths → methods → HTTP_METHODS-filter → requestBody/responses-content` iteration boilerplate is now duplicated across all three call sites. Named component schemas are walked directly (l.501-503) so today's spec is unaffected — a future inline malformed schema under `*/*` would surface as a *loud* `typecheck` failure rather than silent bad output — hence Low, but it is a real, freshly-relevant consistency gap this round's own harmonization skipped. | Make `walkAllSchemaNodes` iterate all content types like its two siblings — replace the `["application/json"]` lookups at l.512/l.516 with `for (const content of Object.values(operation.requestBody?.content ?? {}))` / `for (const content of Object.values(response?.content ?? {}))` (guarding `content?.schema`), and add the `HTTP_METHODS.includes(method)` filter to its operation loop. Better: extract the shared `for (paths) → for (methods, HTTP_METHODS filter) → operation` boilerplate into one `forEachOperation(spec, (opLabel, operation) => …)` helper in `scripts/lib/schema-walk.mjs` and route all three traversals through it, so this class of "one traversal drifted from the others" cannot recur. |
