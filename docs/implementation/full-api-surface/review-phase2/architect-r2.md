## architect — round 2

Code Review Mode, exhaustive. In-progress review: re-verified each `Fixed` disposition from
`reviser-r2.md` against the actual working-tree code (not the reviser's digest), then swept the
round-2 additions (`patchMissingSuccessResponses`, `pruneOrphanedContextSchemas`,
`computeReachableComponentNames`, `verifyWideningHappened`, `scripts/lib/schema-walk.mjs`, the
`orval.config.ts` `clean:true`, and the split/reproducibility rewiring) for new issues. Scope of the
phase-2 change reconfirmed against `git diff main...HEAD` plus the uncommitted round-2 revisions.

**Carry-forward of round-1 findings — all three ratified `Closed`:**

- `architect-r1-f1` (orphaned `*Context` schemas) — **ratified**. `patchAlertContext` now returns the
  old `oneOf`'s `$ref` names; `pruneOrphanedContextSchemas` expands them transitively through
  `allOf` bases, filters against a genuine spec-reachability BFS (`computeReachableComponentNames`,
  which correctly walks parameters + all content types of requestBody and every response, and is run
  *after* `patchMissingSuccessResponses` so synthesized 200s count toward reachability), and deletes
  only members of the anchored `EXPECTED_ORPHANED_COMPONENTS` set — an undocumented orphan is
  reported as drift, not silently deleted. Scoped to the `alertContext` blast radius, so the
  `ProxySettings` split is untouched. Sound.
- `architect-r1-f2` (no post-condition on the widen codemod) — **ratified on its core (format-drift)
  claim.** `verifyWideningHappened` invariant 1 (`hasResponseEnum && changedCount === 0 → throw`) is
  derived from the patched spec, not the generated text the regexes parse, and fails loud on the exact
  total-no-op scenario the finding demonstrated. (The finding's secondary sub-concerns are now carried
  as the new `architect-r2-f1`/`architect-r2-f2` below rather than reopening f2.)
- `architect-r1-f3` (reproducibility guard coupled into default `npm test`/`prepublishOnly`) —
  **ratified.** The test is excluded from the default `vitest run`, has its own
  `vitest.repro.config.ts` + `test:repro` script, `skipIf(!hasGit())`, and is wired explicitly into
  both CI workflows after the `Test` step; `orval.config.ts` gained `clean:true` on both targets so
  regeneration is genuinely from-scratch. Matches the recommendation exactly.

**New findings (round-2 additions):** two latent soundness gaps in the widen script's reachability
plumbing — the safety guard the whole discrimination rests on. Neither breaks the current build
(verified: the current spec masks both), so both are Medium, but both are silent future-drift holes of
exactly the class the fail-loud design exists to close.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | Medium | Closed | PublicAPI | `scripts/patch-spec.mjs` | — | ratified: `pruneOrphanedContextSchemas` + anchored `EXPECTED_ORPHANED_COMPONENTS` + spec-reachability BFS prune the 28 orphaned schemas; drift on an undocumented orphan fails loud. |
| architect-r1-f2 | Medium | Closed | Architecture | `scripts/widen-response-enums.mjs` | — | ratified on the format-drift core: `verifyWideningHappened` invariant 1 is a spec-derived fail-loud post-condition catching the total silent no-op. Residual sub-concerns carried as r2-f1/r2-f2. |
| architect-r1-f3 | Low | Closed | Architecture | `tests/generated/reproducibility.test.ts`, `vitest.config.ts`, CI | — | ratified: repro guard decoupled from default `test`/`prepublishOnly`, dedicated config + `test:repro`, `skipIf(!hasGit())`, CI-wired; `orval clean:true` added. |
| architect-r2-f1 | Medium | Open | Architecture | `scripts/widen-response-enums.mjs` `buildReachabilityMaps` (l.195-210) — reads only `requestBody.content["application/json"]` and `response.content["application/json"]` | The reachability maps that power **both** load-bearing guards (`verifyNoSharedEnumBearingSchemas` over-widen guard *and* `computeRequestOnlyComponentNames` request/response split) consider only the `application/json` content type. But the real spec genuinely uses `*/*` for response bodies (verified: 7 `*/*` response schemas — `Site`, `AuthUserKey` — in `spec/openapi.json`), and `patch-spec.mjs`'s own `responseSchema`/`computeReachableComponentNames` deliberately read `application/json` **∪** `*/*` for exactly this reason. Today this is masked purely because all 7 `*/*` responses sit on error codes of operations lacking a 200/204, so `patchMissingSuccessResponses` rewrites them into synthesized `application/json` 200s before widen ever runs. A future refresh that ships a genuine 200 (or a requestBody) delivered only via `*/*` would be invisible to `buildReachabilityMaps`: a request∩response shared enum-bearing schema reached via a `*/*` response would slip past the guard and get silently widened (loosening the compile-time request contract, R6), or a response-only component reached only via `*/*` would be misclassified request-only and left un-widened (R5). This is the silent-reship-on-refresh class the rest of the pipeline is engineered to fail loud on, and the two reachability walkers (patch vs widen) are inconsistent on it. | Make `buildReachabilityMaps` iterate **all** content types of each requestBody and response (or at minimum `application/json` ∪ `*/*`, mirroring `patch-spec.mjs`'s `responseSchema`), so the guard's content-type coverage matches both the spec's actual usage and patch-spec's own reachability walker. |
| architect-r2-f2 | Medium | Open | Architecture | `scripts/widen-response-enums.mjs` `verifyWideningHappened` invariant 2 (l.448-455) + `computeRootExclusion` (l.337-354) | Invariant 2 is documented (l.413-416) to catch "a mismatch between `computeRequestOnlyComponentNames`'s PascalCasing and Orval's actual naming (the discrimination graph silently excluding nothing it was supposed to)" — the R6 protection that `engineer-r1-f4` was folded into. But it fires only when `rootExcludedNames.size === 0`, and `rootExcludedNames` is built in `computeRootExclusion` from `isRequestRootName`, which unions **suffix roots** (`*Params`/`*Query`/`*Body`/…) with request-only-component roots. Orval always emits per-operation `*Params` types (verified: 21+ `*Params` files in `src/generated/types`), so `rootExcludedNames.size` is never 0 in a real run — meaning if `computeRequestOnlyComponentNames`'s PascalCasing drifts and matches **zero** named request-only components, every one of those request-body component enums gets silently widened (R6 breach) while invariant 2 stays green. The check is effectively vacuous for the exact failure it claims to catch; the unit tests only pass because they hand-supply `rootExcludedNames = new Set()` (l.414-422), a state `main()` cannot produce whenever any `*Params` type exists. | Track the request-only match separately from the suffix match: have `computeRootExclusion` return the subset of `requestOnlyComponentNames` that actually resolved to a declared type name (or check `requestOnlyComponentNames` directly against the union of `primaryNamesByFile` values), and throw when `requestOnlyComponentNames` is non-empty but that resolved subset is empty — independent of suffix-root count. Update the corresponding unit case to feed a realistic non-empty `rootExcludedNames` containing only suffix roots so the test would actually fail under the drift it guards. |
