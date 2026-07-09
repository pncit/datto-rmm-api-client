## engineer — round 1

First engineer round on Phase 1 (Orval / tsup / vitest / nock toolchain migration). No prior
`engineer-r*` turn exists in this review dir, so nothing to carry forward; the existing
`implementation-auditor` (r1/r2) and `reviser-r1` turns were read for context — their sole finding
(`implementation-auditor-r1-f1`, prettier drift on the three root configs) is `Closed`/ratified and
is not re-litigated here.

Scope: `git diff main` — `package.json`, `tsconfig.json`, `eslint.config.js`, `.gitignore`,
`jest.config.js` (deleted), the four `src/__tests__/*.test.ts` conversions, and the three new root
configs (`orval.config.ts`, `tsup.config.ts`, `vitest.config.ts`).

This is a clean, faithful, mostly-mechanical migration. Notes on things I checked and am **not**
raising, to spare later rounds:
- **`__dirname` in the three config files is safe** despite the tests being switched off it. The
  test files run under raw Node ESM (no `__dirname`), hence `fileURLToPath`; the configs are loaded
  by jiti (orval → confirmed `jiti` dep), esbuild/bundle-require (tsup), and Vite (vitest), all of
  which inject `__dirname`/`__filename`. Not inconsistent, not a bug.
- **`@/` alias split across tsconfig `paths` + vitest `resolve.alias`** is correct: tsc/esbuild read
  tsconfig `paths`; Vite needs its own alias. No finding.
- **`nock` added but unused** and the **`generate` script chaining not-yet-existing Phase-2 scripts**
  are both plan-directed and documented — plan/project-lead scope, not raised here.

Findings below are the two real (Low) issues I found, both in the vitest coverage wiring.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | Low | Open | DeadCode | `vitest.config.ts` (`test.coverage.include`/`exclude`, lines 10–15) | Coverage is scoped by `include: ["src/**/*.ts"]` with `exclude: ["src/generated/**", "src/index.ts"]`. That glob also matches the test files themselves (`src/__tests__/*.test.ts`), and vitest v4's `coverageConfigDefaults.exclude` is `[]` (verified in `node_modules/vitest/dist/chunks/defaults.*.js` — unlike older vitest, v4 ships **no** default test-file exclusion). With `coverage.all` defaulting on, the `.test.ts` files are therefore reported as ~100%-covered source, inflating coverage numbers and masking genuinely-undertested modules once Phase 3+ code lands. | Explicitly exclude test files (and the `__tests__` tree) from coverage so metrics reflect only shipped source: add `"src/**/*.test.ts"` and `"src/__tests__/**"` to `test.coverage.exclude`. Don't rely on vitest defaults here — v4 provides none. |
| engineer-r1-f2 | Low | Open | DeadCode | `package.json` `scripts` + `vitest.config.ts` `test.coverage` + `@vitest/coverage-v8` dep | The coverage stack is fully wired — `@vitest/coverage-v8` is a devDependency and `vitest.config.ts` carries a complete `coverage` block (provider, reporters, include/exclude) — but no npm script ever invokes it: `test` is `vitest run` (no `--coverage`) and there is no `test:coverage`. The configured-and-installed coverage feature is thus unreachable through the package's documented interface; a developer must know to hand-run `vitest run --coverage`, and the dep/config read as dead until then. | Add a script that exercises the coverage config, e.g. `"test:coverage": "vitest run --coverage"`, so the installed dependency and config block are actually reachable and CI can call it by name. |
