## implementation-auditor — round 1

Scope reviewed via `git diff HEAD` on branch `feat/full-api-surface`: `package.json`,
`package-lock.json`, `tsconfig.json`, `.gitignore`, `eslint.config.js`, `jest.config.js` (deleted),
the four `src/__tests__/*.test.ts` files, plus new untracked `orval.config.ts`, `tsup.config.ts`,
`vitest.config.ts`. (`docs/.../pipeline-run.json` is orchestrator telemetry, not implementation —
ignored.)

I independently ran the non-test gate commands (allowed for a reviewer; I did **not** run
`vitest`/`npm test`):
- `npm run typecheck` → exit 0.
- `npm run lint` → exit 0, 11 pre-existing `no-explicit-any` warnings, all in untouched old files
  (`src/auth.ts`, `src/client.ts`, `src/httpClient.ts`, `src/logger.ts`). No new warnings.
- `npm run build` → exit 0, emits ESM `dist/index.js` + `dist/index.d.ts`.
- Verified `node_modules/.bin` has `orval`, `tsup`, `vitest`; `@types/jest` is gone, `@types/node`
  present; no residual `jest` reference anywhere under `src/`.

This is a clean, faithful toolchain migration. Old runtime surface is untouched (diff shows only
test files + configs). Config files are faithful ports of `fuze-api` with the plan-directed
deviations (single tsup entry / no browser build; no Orval `mutator`; no `tests/setup.ts`).

### Phase Coverage Checklist
| Step | Status | Notes |
|------|--------|-------|
| 1. Swap deps (remove jest/ts-jest/@types/jest; add orval@^7/tsup@^8/vitest@^4/nock@^14/@vitest/coverage-v8@^4/@types/node@^22) | ✅ Implemented | All versions match plan; `@types/node` pinned `^22` (Node-20 floor), not fuze's `^26`. `zod`/`axios`/eslint stack kept. |
| 2. Rewrite scripts (build/test/test:watch/typecheck/generate/generate:raw/clean/prepublishOnly, files) | ✅ Implemented | Scripts match plan verbatim, incl. deferred `generate` chain. `files` already had `dist`/`README.md`/`LICENSE` — no change needed. |
| 3. Add tsup/vitest/orval configs | ✅ Implemented | tsup single-entry ESM `dts:true`; vitest globals/node/`@`-alias/coverage-excludes; orval two-target, patched-spec input, no mutator, strict/coerce block matches plan snippet. |
| 4. `@/` alias + `moduleResolution: Bundler` (+ `module: ESNext`) | ✅ Implemented | `baseUrl`/`paths` added; `moduleResolution Node→Bundler`; `module` already `ESNext`. typecheck green confirms old relative-import files still compile. |
| 5. Convert jest tests → vitest; delete `jest.config.js` | ✅ Implemented | `jest.config.js` deleted; all 4 test files import from `vitest`; `jest.fn/spyOn/Mock` → `vi.fn/vi.spyOn/Mock`; ESM `__dirname` fix in the two fixture-loading files. No assertion/logic changes. |
| 6. `.gitignore`: patched spec, endpoints dir, coverage/, committed-generated note | ✅ Implemented | `spec/openapi.patched.json` + `src/generated/endpoints/` + explanatory note added. `coverage` already ignored (pre-existing line 22) so intent satisfied. |

### Drift Report
**Out-of-scope changes:** None. No old runtime source (`src/client.ts`, `src/auth.ts`, etc.) was
edited; only test harness + build/tooling config changed.
**Acceptable Phase 1 necessities:** `eslint.config.js` test-globals block `jest`→`vi` (direct
consequence of retiring jest; without it a stray `jest.fn()` typo would lint clean); ESM
`__dirname` via `fileURLToPath(import.meta.url)` in the fixture-loading tests (bare `__dirname` is
`undefined` under `"type":"module"` + vitest's Vite transform, which — unlike the old ts-jest ESM
preset — provides no shim). Both are minimal and justified.

### Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| implementation-auditor-r1-f1 | Low | Open | BestPractices | `orval.config.ts`, `tsup.config.ts`, `vitest.config.ts` | The three new root config files are not Prettier-clean under the config Prettier actually loads: `npx prettier --check orval.config.ts tsup.config.ts vitest.config.ts` reports all three as `[warn]` (they use single quotes, ported from `fuze-api`). The repo's `prettierrc` declares `singleQuote: true`, but the file is misnamed (missing the leading dot), so Prettier silently falls back to defaults (double quotes) — under which every existing formatted file passes and these three fail. `npm run format` (`prettier --write .`) would therefore rewrite all three, producing avoidable churn on freshly-committed files, and they are inconsistent with the rest of the committed tree. Neither `eslint src` nor the exit gate covers these root files, so this does not break the gate. | Make the new config files format-stable against the config Prettier effectively uses — run `npx prettier --write orval.config.ts tsup.config.ts vitest.config.ts` so committed files match what `npm run format` would produce. (Root cause is the pre-existing misnamed `prettierrc` → `.prettierrc`; renaming it would take the declared single-quote style repo-wide but reformats all existing double-quoted `src/**` files — out of Phase 1 scope, so do not do it here.) |
