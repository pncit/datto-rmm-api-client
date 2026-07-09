## implementation-auditor — round 1

Audited the Phase 2 working tree (`git diff` / staged set) against `plan.md` Phase 2 (Steps 1–6),
cross-checking the phase notes. Scope: spec commit, `patch-spec.mjs`, `dedupe-generated-index.mjs`,
`widen-response-enums.mjs`, generated `src/generated/**`, the four `tests/generated/*` suites, and the
`eslint.config.js` / `tsconfig.test.json` adjustments. I did **not** run tests (assumed passing) and
verified behavior by reading the scripts, the generated output, and the committed spec directly.

Overall this is a faithful, well-evidenced implementation. Every plan step landed; the three named
deviations are documented and each is genuinely load-bearing for this phase's own exit gate. I
independently reproduced the key claims rather than trusting the notes:

- **Widening discrimination is correct on the real output.** 29 enum aliases total; 25 widened, 4 left
  closed — and the 4 closed ones (`getActivitiesEntitiesItem`, `getActivitiesOrder`, `getActivitiesPage`,
  `proxySettingsRequestType`) are all genuinely request-side (query params + the split request clone).
  The nested response enums (`antivirusAntivirusStatus`, `patchManagementPatchStatus`) and the top-level
  `deviceDeviceClass` all carry `| (string & {})`. `proxySettingsType` (response) is widened while its
  `proxySettingsRequestType` (request) twin stays closed — the split works end-to-end.
- **The plan's pure-suffix rule really is insufficient**, so the added spec-derived request-only set +
  transitive import-graph expansion is a necessary, correct improvement, not gold-plating: Orval hoists
  enums into names that drop the `*Params` suffix (`GetActivitiesOrder`, not `GetActivitiesParamsOrder`),
  so a suffix-only pass would have wrongly widened those request enums. Confirmed no component schema
  name PascalCases to a request suffix, so there is no false-exclusion of a response DTO either.
- **The `ProxySettings` split is genuinely required**, not scope creep: without it the shared-enum guard
  throws (`ProxySettings.type` is reached by two write sites and three responses) and `npm run generate`
  fails at the widen step. Handling it in the patch step via the spec's own `*Request` convention is the
  right call.
- **Reproducibility premise holds:** generation reads the frozen committed `spec/openapi.json`; the
  patched spec and widen pass are deterministic and idempotent (the widen regex ends in `];` so an
  already-widened line is not re-matched). `spec/openapi-prev.json` is byte-identical to `openapi.json`.
- Old runtime surface is untouched (coexistence rule honored); `src/generated/endpoints/` is not
  committed; `.gitignore` correctly ignores the patched spec and endpoints while committing types/schemas.

One real finding: the `fixMalformedNonStringConstraints` array-enum sweep is broader than its own
documented safety condition (see f1). Everything else is clean.

### Phase Coverage Checklist
| Step | Status | Notes |
|------|--------|-------|
| 1. Commit spec + prev baseline | ✅ Implemented | `spec/openapi.json` (3.1.0, 53 paths, 113 schemas) + byte-identical `openapi-prev.json`; key order preserved via Python serializer (documented, doesn't affect ongoing reproducibility). |
| 2. `patch-spec.mjs` (timestamps, alertContext, fail-loud) | ✅ Implemented | Both named corrections present and fail-loud on missing anchors; adds ProxySettings split (justified) + malformed-keyword sweeps (justified, but see f1). |
| 3. Port `dedupe-generated-index.mjs` | ✅ Implemented | Near-verbatim port, pure-core/CLI split, path adjusted; real index has 0 dups (fixture tests cover the dup path). |
| 4. `widen-response-enums.mjs` + transitive shared-enum guard | ✅ Implemented | Discrimination verified correct on real output; guard implemented with recursive $ref walk, enum filtering, and self-locating error message. |
| 5. Generate + commit `src/generated/**` | ✅ Implemented | 195 type files + 9 tag-split `.zod.ts` committed; endpoints git-ignored; `.gitignore` note present. |
| 6. Verify reproducibility | ✅ Implemented | `reproducibility.test.ts` shells `npm run generate` + `git diff --exit-code`; skips cleanly if spec absent. |

### Drift Report
**Out-of-scope changes:** None. The `eslint.config.js` `src/generated/**` ignore and the
`tsconfig.test.json` `allowJs` + `scripts/**/*.mjs` include are both minimal, necessary adjacent fixes
to keep this phase's own `lint`/`typecheck`/`test` gates green (generated code lint-noise; importing the
plain-JS scripts from typed tests). No old-surface logic was edited.

**Acceptable Phase 2 necessities:** ProxySettings→ProxySettingsRequest split (guard would otherwise fail
the build); the two malformed-keyword sweeps (Orval-generated zod otherwise fails `typecheck`); the two
config adjustments above.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| implementation-auditor-r1-f1 | Low | Open | BestPractices | `scripts/patch-spec.mjs` `fixMalformedNonStringConstraints` (l.235–238) | The array-enum sweep deletes `node.enum` on **any** `type:"array"` node that carries an `enum`, but its own module doc (l.19–22) and the deviation rationale scope it to "a **redundant** top-level enum on an array-typed schema that **already carries the real enum on `items`**." The implementation never checks that precondition. For the current frozen spec this is inert (the one occurrence — the `entities` param — does have `items.enum`), but this sweep is explicitly framed as forward-looking robustness for future spec refreshes; a future array-typed schema whose only enum constraint sits at the array level (no `items.enum`) would have that constraint silently dropped, changing validation semantics with no fail-loud signal. This is a genuine gap between the documented intent and the code, on exactly the future-refresh path the sweep exists to serve. | Guard the deletion so it fires only when the enum is genuinely redundant: require `Array.isArray(node.items?.enum)` (i.e. the real enum is present on `items`) before `delete node.enum`. Optionally add a `widen-enums`/`patch-spec` unit case asserting an array-level enum with **no** `items.enum` is left untouched. |
