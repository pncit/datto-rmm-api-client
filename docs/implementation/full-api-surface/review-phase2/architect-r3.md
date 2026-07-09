## architect — round 3

Code Review Mode, exhaustive. In-progress review: re-verified each `Fixed` disposition in
`reviser-r3.md` against the actual working-tree code (not the reviser's digest), then swept the
round-3 revisions (`buildReachabilityMaps` rewrite, `computeRootExclusion`'s new
`matchedRequestOnlyNames`, the `verifyWideningHappened` invariant-2 re-keying, the
`schema-walk.mjs` shared-constant extraction, and the `patch-spec.mjs` re-import) for new issues.
Scope reconfirmed against `git diff main...HEAD` plus the uncommitted revisions.

**Carry-forward of my two still-`Open` round-2 findings — both ratified `Closed`:**

- `architect-r2-f1` (reachability maps considered only `application/json`) — **ratified**.
  `buildReachabilityMaps` (`widen-response-enums.mjs` l.169-212) now iterates
  `Object.values(operation.requestBody?.content ?? {})` and, for every response,
  `Object.values(response?.content ?? {})` — every content type, not just `application/json` —
  matching `patch-spec.mjs`'s own `computeReachableComponentNames`. Both load-bearing consumers
  (`computeRequestOnlyComponentNames` and `verifyNoSharedEnumBearingSchemas`) and the post-condition
  read through this single walker, so the `*/*` blind spot is closed on all three. Regression tests
  cover both the request-only misclassification path (`computeRequestOnlyComponentNames` `*/*` case,
  `widen-enums.test.ts` l.309-319) and the shared-enum guard path (`verifyNoSharedEnumBearingSchemas`
  `*/*` case, l.417-460). The two reachability walkers are now consistent on content-type coverage.
  Sound.
- `architect-r2-f2` (invariant 2 vacuous because `rootExcludedNames` is never empty) — **ratified**.
  `computeRootExclusion` (l.358-381) now builds `declaredNames` from every file's `primaryNames` and
  returns `matchedRequestOnlyNames` = the subset of `requestOnlyComponentNames` that actually resolved
  to a declared type — computed independently of the suffix-root matches. `verifyWideningHappened`
  invariant 2 (l.501-508) is re-keyed from `rootExcludedNames.size === 0` to
  `matchedRequestOnlyNames.size === 0`, so a PascalCasing drift where no request-only name resolves
  now throws even though Orval's ever-present `*Params` types keep `rootExcludedNames` non-empty. The
  computed subset is exactly the request-only portion of `rootExcludedNames`, so the guard and the
  transform's actual exclusion stay consistent. Regression tests reproduce the realistic state
  (`computeRootExclusion` with a `*Params` file present + an unresolved request-only name,
  l.185-228; `verifyWideningHappened` unresolved-vs-resolved cases, l.570-590) — the suggested
  drift would now fail these. The residual "cannot prove *every individual* enum was widened without
  reimplementing Orval's naming" limitation is documented (l.470-474) and is an accepted bound, not a
  gap. Sound.

**Round-3 sweep — no new findings.** The `schema-walk.mjs` shared-constant extraction
(`HTTP_METHODS`, `refName`, `COMPONENTS_SCHEMAS_PREFIX`) keeps `schema-walk.mjs` a dependency-free
leaf imported by both pipeline scripts — no new cross-module cycle, no boundary inversion — and
`patch-spec.mjs`'s `patchRequestResponseSplits` now composes both `$ref` literals off the shared
prefix constant, removing the last duplicated `"#/components/schemas/"` string. The dropped local
`refName`/`HTTP_METHODS` copies are fully superseded by the imports. No ownership drift, no public
API surface change (all extracted symbols live in the tools-only `scripts/lib` module, outside the
package's published surface).

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r2-f1 | Medium | Closed | Architecture | `scripts/widen-response-enums.mjs` `buildReachabilityMaps` (l.169-212) | — | ratified: `buildReachabilityMaps` now iterates every content type of each requestBody and response (mirroring `patch-spec.mjs`'s `computeReachableComponentNames`), closing the `*/*` blind spot for both `computeRequestOnlyComponentNames` and `verifyNoSharedEnumBearingSchemas`; `*/*` regression tests added for both paths. |
| architect-r2-f2 | Medium | Closed | Architecture | `scripts/widen-response-enums.mjs` `computeRootExclusion` (l.358-381) + `verifyWideningHappened` invariant 2 (l.501-508) | — | ratified: `computeRootExclusion` returns `matchedRequestOnlyNames` (request-only names resolved to a declared type, independent of the ever-present suffix roots); invariant 2 re-keyed onto it, so a PascalCasing drift that resolves zero request-only components now fails loud instead of staying vacuously green. Realistic-state regression tests added. |
