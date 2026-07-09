## architect — round 1

Code Review Mode, exhaustive. Scoped to the Phase 2 commit (`42f6e86`): `scripts/patch-spec.mjs`,
`scripts/dedupe-generated-index.mjs`, `scripts/widen-response-enums.mjs`, the committed
`spec/openapi{,-prev}.json`, `src/generated/**`, `tests/generated/**`, and the
`eslint.config.js` / `tsconfig.test.json` adjustments. (`orval.config.ts`, `tsup`, `vitest`,
`package.json` test-script changes belong to the Phase 1 commit `9c8dd39` and are out of this
phase's scope.) I did not run tests; I read the scripts, the generated output, and the committed
spec directly and reproduced key claims by inspection.

The pipeline is well-architected. The two-mechanism request/response discrimination
(suffix set ∪ spec-derived request-only components, transitively expanded via the generated import
graph) is sound, and it is load-bearingly protected in the over-widen direction by
`verifyNoSharedEnumBearingSchemas` — the spec `$ref` graph and the generated import graph stay
consistent, so any shared enum-bearing component fails the build rather than silently loosening a
request type. patch-spec's fail-loud anchoring, the pure-core/CLI split, and idempotency
(the enum-alias regex won't re-match an already-widened line) are all correct. Reproducibility
holds independent of `readdirSync` ordering because each file's transform is order-independent.

Three structural findings below. The prior `implementation-auditor-r1-f1` (array-enum sweep
precondition) is a different reviewer's finding already dispositioned Fixed by the reviser and
confirmed present at `patch-spec.mjs:242`; I do not carry it.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | Medium | Open | PublicAPI | `scripts/patch-spec.mjs` `patchAlertContext` (l.130-145); resulting `src/generated/types/*Context*.ts` (71 files) | `patchAlertContext` replaces the `Alert.alertContext` **property**, which was the *only* reference to the 26+ concrete `*Context` component schemas (verified: each `*Context` is `$ref`'d exactly once in `spec/openapi.json`, from the old `oneOf`; `AlertContext` base is referenced only by those now-orphan schemas' `allOf`). The patch leaves all 29 orphaned schemas in `components.schemas`, so Orval faithfully emits **71 committed generated files** for types that are now reachable from no operation and, per the patch's own doc, "do not model the real property sets." `src/generated/types/index.ts` exports all 71, so Phase 8's barrel re-export will publish 71 dead, misleading DTOs into the package's public type surface. The plan's "left in place but no longer referenced" note did not account for Orval emitting *every* component schema regardless of reachability. | In the patch step, after rewiring `alertContext`, delete the now-unreferenced `*Context` schemas (and the `AlertContext` base) from `spec.components.schemas` — ideally as a general "prune components unreachable from any operation after patching" sweep, anchored/fail-loud on the known set — so Orval never generates or exports them. If the intent really is to ship them, that is a scope decision to confirm with project-lead, not a silent by-product of the patch. |
| architect-r1-f2 | Medium | Open | Architecture | `scripts/widen-response-enums.mjs` `main` (l.386-416), `ENUM_ALIAS_RE`/`IMPORT_RE` (l.279-282), `isRequestRootName` (l.309-314) | The widen codemod is entirely coupled to Orval's exact emitted text (`export type X = typeof X[keyof typeof X];` and single-quote, single-line `import type { X } from './x';`) and has **no post-condition** — it logs `changedCount` but never asserts it. This is asymmetric with patch-spec, which the plan deliberately made fail-loud for exactly this "silently reship the defect" class (R8). Two silent-failure modes result, neither caught by any Phase 2 gate: (a) a future Orval version / prettier pass / quote change makes every regex miss, widening 0 files with a success exit — R5's compile-time guarantee is silently dropped, and the reproducibility test still passes because committed == regenerated; (b) `isRequestRootName`'s `endsWith` suffix check would silently leave *closed* any genuine response type whose hoisted name ends in a request suffix (`Body`/`Header`/`Query`/`Parameter`/…) — the shared-enum guard only protects the over-widen direction, not this under-widen one. | Add a fail-loud post-condition to `main()`: derive from the patched spec the set of response-reachable, non-request-only, enum-bearing hoisted type names that *should* be widened, and `throw` if the actually-widened set diverges (at minimum assert `changedCount` equals the count of non-excluded enum-alias files, so a zero-match format drift fails like patch-spec). This closes both the format-drift and suffix-collision gaps with one spec-anchored check. |
| architect-r1-f3 | Low | Open | Architecture | `tests/generated/reproducibility.test.ts` (l.20-32); `package.json` `test`/`prepublishOnly` (l.18, l.22) | The R15 guard shells out to `npm run generate` (full Orval codegen, writing into the tree) + `git diff --exit-code`, and is picked up by the default `vitest run`, so ordinary `npm test` — and therefore `prepublishOnly` (`build && test`) — now depends on a working git repo and a live Orval run every invocation. `skipIf` covers an absent spec but not an absent-git / non-repo environment (e.g. an installed-tarball or sandboxed CI checkout), where the test fails rather than skips, and it re-runs the whole generator as a side effect of any test run. The plan framed this as a *CI* R15 guard. | Isolate the reproducibility check to a dedicated script / vitest project (e.g. a `test:repro` run in CI only), or additionally `skipIf` git/`.git` is unavailable, so the default `test`/`prepublishOnly` path doesn't couple to codegen + git. |
