## typescript-cop — round 4

Scope: the working tree's unstaged changes since the round-3 checkpoint (`reviser-r4.md`'s single
disposition entry) — `scripts/lib/schema-walk.mjs` (new `forEachOperation` helper + the `SUBSCHEMA_KEYWORDS`
narrowing cast), `scripts/patch-spec.mjs` and `scripts/widen-response-enums.mjs` (routed through
`forEachOperation`; JSDoc `@param`/`@returns` added to every internal helper; several `unknown`/
possible-`undefined` narrowing fixes), `scripts/dedupe-generated-index.mjs` (JSDoc + `error instanceof
Error` narrowing), `tsconfig.test.json` (`checkJs: true`), and `tests/generated/strict-fixture-types.ts`
/ `patch-spec.test.ts` / `widen-enums.test.ts` (new `StrictOpenApiSpecFragment` + `satisfies` on every
hand-written top-level spec fixture).

Verified, not assumed: ran `npx tsc --noEmit -p tsconfig.test.json` and `-p tsconfig.tools.json` (both
clean) and `npm run typecheck` end-to-end (clean), then reproduced each of the three round-3 findings'
own falsification probes directly against the current code (each reverted after):

- `typescript-cop-r3-f1` (missing `checkJs`): re-added `const __probe1 = refName(12345);` right after
  `refName`'s definition in `schema-walk.mjs` — now `TS2345: Argument of type 'number' is not
  assignable to parameter of type 'string'` (previously zero diagnostics). Re-swapped
  `patchTimestamps(spec, missing)` to `patchTimestamps(missing, spec)` in `patchSpec` — now
  `TS2345: Argument of type 'string[]' is not assignable to parameter of type 'OpenApiSpecFragment'`
  (previously zero diagnostics, and this is the exact argument-order bug the finding used to
  demonstrate a real runtime crash going unnoticed by `tsc`). `checkJs: true` is confirmed present in
  `tsconfig.test.json`, and all four `.mjs` files (`schema-walk.mjs`, `patch-spec.mjs`,
  `widen-response-enums.mjs`, `dedupe-generated-index.mjs`) are covered by its `scripts/**/*.mjs`
  include with zero errors.
- `typescript-cop-r2-f1` (missing outer-container `satisfies` guard): re-added the `pahts`-for-`paths`
  typo to `widen-enums.test.ts`'s `specWith(...)` return literal — now `TS2561: Object literal may only
  specify known properties, but 'pahts' does not exist in type 'StrictOpenApiSpecFragment'. Did you
  mean to write 'paths'?` (previously zero diagnostics). `StrictOpenApiSpecFragment` is applied via
  `satisfies` at every site the finding named: `buildValidSpecFragment()` and all of
  `verifyNoSharedEnumBearingSchemas`/`verifyWideningHappened`/`specWith`'s ad-hoc spec literals.
- `engineer-r3-f1` (traversal drift): confirmed `walkAllSchemaNodes` now goes through the same
  `forEachOperation` helper as its three siblings (`computeReachableComponentNames`,
  `patchMissingSuccessResponses` in `patch-spec.mjs`, `buildReachabilityMaps` in
  `widen-response-enums.mjs`), inheriting both the `HTTP_METHODS` filter and every-content-type
  iteration; `HTTP_METHODS` is no longer imported by either pipeline script directly.

Read the rest of the diff line-by-line beyond the three tracked findings (the new JSDoc typedefs and
`@param`/`@returns` annotations across both scripts' internal helpers, the `queue.shift()` non-null
assertions guarded by `while (queue.length > 0)`, the `Map.get()`-after-`.has()`/`?? []` restructuring
in `addReach`/`applyWidening`, the `error instanceof Error` narrowing in `dedupe-generated-index.mjs`,
`getAtPath`'s `unknown`-typed traversal with an explicit cast at the one indexing site) — no further
type holes, unsafe casts, unvalidated boundary input, or async issues found.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| typescript-cop-r2-f1 | High | Closed | TypeHole | — | — | ratified: `StrictOpenApiSpecFragment` added and applied via `satisfies` at every hand-written top-level spec literal named in the finding; the `pahts` typo re-probe now fails `TS2561` where it previously compiled clean. |
| typescript-cop-r3-f1 | High | Closed | TypeHole | — | — | ratified: `checkJs: true` set in `tsconfig.test.json`; both of the finding's own falsification probes (`refName(12345)`, the `patchTimestamps` argument swap) now fail under `tsc` where they previously compiled clean; `npm run typecheck` is clean with all four `.mjs` files' internal helpers JSDoc-typed. |
