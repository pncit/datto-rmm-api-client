## architect — round 1

Round 1 (my first architect turn on this phase; prior turns are `implementation-auditor` r1/r2
and `reviser` r1, which I read but do not carry as my own IDs). Scope established via
`git diff main`: `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`,
`eslint.config.js`, deleted `jest.config.js`, the four `src/__tests__/*.test.ts` conversions, and
the three new root configs `orval.config.ts` / `tsup.config.ts` / `vitest.config.ts`.

This is a small, faithful toolchain migration and the old runtime surface is untouched (coexistence
rule honored). I assessed it against the architect axes: ownership/boundaries, dependency direction,
public-API/package-quality (published `dist`/`.d.ts`), and the verification seams this phase
*establishes* for every later phase. The auditor's r1-f1 (prettier) is already `Closed` by the
reviser and I do not re-raise it. Two structural gaps in the verification/build toolchain that
Phase 1 is responsible for setting up, and one latent published-types risk, follow. Notably, the
whole point of this phase per the notes is that the toolchain "every later phase builds on" is
correct now — so seams that only *bite* in Phase 3/6/9 are in-scope to raise here, because here is
where the contract is fixed.

### Analysis notes (non-findings)
- `moduleResolution: Bundler` + `module: ESNext` pairing is correct and required; old relative-import
  files still typecheck (auditor-verified). No issue.
- Root config files use `__dirname` under a `"type": "module"` package, but each is loaded by its
  own tool's config loader (Vite / tsup bundle-require / orval), all of which inject `__dirname`;
  this is *not* the same hazard the notes fixed in the test files (which run under Vitest's
  transform), so it is fine.
- `.gitignore` `coverage/` intent is satisfied by the pre-existing `coverage` line; the endpoints
  and patched-spec ignores are correct. No issue.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | High | Open | Architecture | `tsconfig.json` (`include:["src"]`, `exclude:[…,"src/__tests__"]`), `vitest.config.ts`, `package.json` `typecheck` script | The migration silently **removes type-checking of test code** and leaves the plan's core verification mechanism unenforced. Old `ts-jest` (no `isolatedModules` set in the deleted `jest.config.js`) type-checked every test file on `npm test`. Vitest transforms via esbuild and does **not** type-check by default, and `npm run typecheck` = `tsc --noEmit` over `include:["src"]` minus the explicit `exclude:["src/__tests__"]`, so **no** command in the toolchain now typechecks any test file. This is not cosmetic: the plan repeatedly relies on **compile-time type assertions living inside test files** as the R5 safety gate (plan l.437, l.567, l.609/617 — "only type-checks if the reconciled type carries the widening", the coverage-map's typed op table, the truly-novel-enum assertions). Under this toolchain those assertions compile away and pass unconditionally, so a wrong generated/reconciled type would ship green. Phase 1 owns the test-toolchain contract, so the gap must be closed here, before those tests exist. | Establish a type-checking path for tests as part of this phase: add a `tsconfig.test.json` (extends the base, `noEmit`, `include` the `src/**/*.test.ts` + future `tests/**` trees, `types:["vitest/globals","node"]`) wired to a `"test:types": "tsc -p tsconfig.test.json --noEmit"` script and included in the phase/CI gate; **and/or** enable Vitest `test.typecheck` and require `expectTypeOf`/`assertType` for the plan's compile-time assertions. Do not leave the plan's R5 compile-time assertions with no enforcing gate. |
| architect-r1-f2 | Medium | Open | PublicAPI | `tsup.config.ts` vs. `tsconfig.json` `paths` + `vitest.config.ts` `resolve.alias` | The `@/*` alias is now declared in **two** places (`tsconfig.compilerOptions.paths` and `vitest.config.ts` `resolve.alias`) but is **absent from `tsup.config.ts`**, which is the tool that produces the *published* artifacts. tsup's bundle of `dist/index.js` will inline the alias, but `dts:true` rolls declarations via a separate path and does not reliably rewrite `tsconfig` `paths` in emitted `.d.ts`. Once Phase 3+ source in the `src/index.ts` entry graph imports via `@/`, an unresolved `@/...` specifier can leak into the published `dist/index.d.ts` — an internal build alias becoming part of the package's public type surface, breaking every downstream `tsc` consumer. This alias is introduced *now*, so the boundary should be enforced now rather than discovered when the first `@/` import lands. | Make alias resolution a single, enforced source across all three tools: confirm (and, if tsup does not honor `tsconfig.paths` in dts, wire) `@/*` resolution in `tsup.config.ts` (e.g. `esbuildOptions`/an alias plugin, or a dts resolver), and add a Phase-boundary assertion that `dist/index.d.ts` contains no unresolved `@/` specifier — mirroring the plan's existing `dist/index.d.ts` grep gate for `declare module 'axios'` (plan l.362). |
| architect-r1-f3 | Low | Open | Architecture | `vitest.config.ts` `coverage.include:["src/**/*.ts"]` / `exclude:["src/generated/**","src/index.ts"]` | Coverage is scoped over the entire coexisting **old** runtime surface (`src/client.ts`, `src/httpClient.ts`, `src/auth.ts`, … all deleted in Phase 8) with no thresholds. Through Phases 1–7 the reported coverage number is therefore dominated by soon-to-be-deleted code and is neither actionable nor gate-able, and there is no `thresholds` block to make coverage enforce anything. Because Phase 1 sets the coverage contract the later phases inherit, the scoping should be intentional now rather than drifting. | Decide the coverage contract explicitly in this config: either add a `coverage.thresholds` block (even if aspirational) so coverage becomes a real gate, or narrow/annotate `include` so pre-Phase-8 legacy files don't mask new-code coverage — and state which, so later phases don't inherit an accidental default. |
