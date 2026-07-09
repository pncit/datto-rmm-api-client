## engineer — round 2

Code Review Mode, exhaustive. Scoped via `git diff origin/main...HEAD`, focusing on the
hand-written pipeline (`scripts/patch-spec.mjs`, `scripts/widen-response-enums.mjs`,
`scripts/lib/schema-walk.mjs`, `scripts/dedupe-generated-index.mjs`, `orval.config.ts`, the
`tests/generated/*` suites, and the vitest/tsconfig wiring). The generated tree
(`src/generated/**`) and committed `spec/openapi.*.json` remain out of scope as auto-generated /
external artifacts.

In-progress review: all five of my round-1 findings (`engineer-r1-f1` … `engineer-r1-f5`) were
dispositioned `Fixed` by reviser-r2. I re-verified each against the current tree and all fixes
landed as claimed — ratified `Closed` below. I then reviewed the substantial new code the round-1/2
fixes introduced (`walkSchema` lib, `verifyWideningHappened`, `computeRootExclusion`/`applyWidening`
split, `patchMissingSuccessResponses`, `pruneOrphanedContextSchemas`, `computeReachableComponentNames`,
the reproducibility-test rewrite, `orval` `clean:true`) for new issues. Three new findings, none
blocking.

Re-verification notes:
- **f1** — `tests/generated/reproducibility.test.ts` now `rmSync`s `GENERATED_DIR` before
  `npm run generate` and asserts `git status --porcelain -- src/generated` is empty; the root cause
  (Orval never deleting stale output) is fixed at source via `output.clean:true` on both targets in
  `orval.config.ts`. Ratified.
- **f2** — the dead `fileNamesByPrimaryName` map is gone; its replacement `primaryNamesByFile`
  (returned by `computeRootExclusion`) is read by `applyWidening`. Ratified.
- **f3** — each file is now parsed once in `computeRootExclusion`; `applyWidening` reads the cached
  `primaryNamesByFile`. Ratified.
- **f4** — folded into `verifyWideningHappened`; invariant 2 is exactly the suggested check.
  Ratified as landed (but see `engineer-r2-f1` on invariant 1's proxy).
- **f5** — `scripts/lib/schema-walk.mjs` exports `walkSchema`; all four traversals delegate to it.
  Ratified.

### Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | Medium | Closed | Testing / Error Handling | `tests/generated/reproducibility.test.ts`; `orval.config.ts` | — | ratified: test now `rmSync`s the dir and asserts `git status --porcelain`; stale-output root cause fixed via `output.clean:true` on both Orval targets. |
| engineer-r1-f2 | Low | Closed | DeadCode | `scripts/widen-response-enums.mjs` | — | ratified: dead `fileNamesByPrimaryName` removed; `primaryNamesByFile` is now read by `applyWidening`. |
| engineer-r1-f3 | Low | Closed | DRY / Complexity | `scripts/widen-response-enums.mjs` | — | ratified: single parse in `computeRootExclusion`, cache reused by `applyWidening`. |
| engineer-r1-f4 | Low | Closed | Error Handling / Robustness | `scripts/widen-response-enums.mjs` `verifyWideningHappened` | — | ratified: post-condition added; invariant 2 is the exact suggested request-root assertion. |
| engineer-r1-f5 | Low | Closed | DRY | `scripts/lib/schema-walk.mjs` | — | ratified: `walkSchema` + `SUBSCHEMA_KEYWORDS` extracted; all four traversals delegate. |
| engineer-r2-f1 | Medium | Open | ErrorHandling / Complexity | `scripts/widen-response-enums.mjs` `main()` l.478-491 and `verifyWideningHappened` l.440-446; contract stated at module doc l.10-11 | `verifyWideningHappened`'s first invariant uses `changedCount` — the number of files **written to disk** this run — as its proxy for "the widening mechanism engaged". But `changedCount` only counts files whose content *differed*. `widenGeneratedTypes` is deliberately idempotent (the pure transform's second pass is byte-identical — proven by `widen-enums.test.ts` l.98-102), so a second `main()` invocation over already-widened files produces `changedCount === 0` while `hasResponseEnum` is still `true` → `verifyWideningHappened` **throws**. That directly contradicts the module's own documented contract ("The transform is idempotent — running it twice is a no-op — so `npm run generate` stays byte-reproducible R15", l.10-11): running the widen step twice is now *not* a no-op, it errors. The full `npm run generate` pipeline masks this only because `clean:true` regenerates closed enums before every widen pass (so `changedCount>0` there); the invariant is nonetheless keyed on the wrong quantity, and a standalone re-run — or any future refactor that stops Orval from re-emitting closed enums each pass — trips a false failure. | Base invariant 1 on widenings actually applied **in memory**, independent of disk writes: e.g. count files whose `widened` content differs from its *pre-widen* content in the same pass (a value that stays >0 on an idempotent re-run since the enum-alias line was still matched/rewritten to the same widened text), or have `applyWidening`/`widenEnumAliasLine` report a match count and thread that into `verifyWideningHappened` instead of `changedCount`. |
| engineer-r2-f2 | Low | Open | DRY | `scripts/patch-spec.mjs` l.53-62 & l.188-190; `scripts/widen-response-enums.mjs` l.85-94 & l.122-124 | With `scripts/lib/schema-walk.mjs` now established as the shared home for cross-script pipeline helpers (per `engineer-r1-f5`), two more identical fragments remain copy-pasted between the two scripts: the 8-element `HTTP_METHODS` array (verbatim in both) and `function refName(ref)` (`ref.replace("#/components/schemas/", "")`, verbatim in both), plus the bare `"#/components/schemas/"` string literal recurring across both files. A keyword/prefix change in one is easy to miss in the other. | Hoist `HTTP_METHODS`, `refName`, and a `COMPONENTS_SCHEMAS_PREFIX` constant into `scripts/lib/schema-walk.mjs` (or a sibling `scripts/lib/openapi.mjs`) and import them in both scripts, mirroring the `walkSchema` extraction. |
| engineer-r2-f3 | Low | Open | DeadCode | `scripts/lib/schema-walk.mjs` l.44 | `SUBSCHEMA_KEYWORDS` is `export`ed but consumed only inside `walkSchema` in the same module (grep confirms no other importer, including tests) — an unused export introduced by the `engineer-r1-f5` extraction. It reads as intended public API that nothing uses. | Drop the `export` (make it a module-local `const`), or, if it is meant to be reusable, actually reference it from a call site (e.g. `engineer-r2-f2`'s hoist could legitimately expose it) — don't leave it exported-but-unused. |
