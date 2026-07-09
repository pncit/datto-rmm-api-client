## typescript-cop — round 1

Scope: `git diff main` on `feat/full-api-surface` for Phase 1 (tooling migration). Reviewed
`package.json`, `tsconfig.json`, `eslint.config.js`, `.gitignore`, deleted `jest.config.js`, new
`orval.config.ts`/`tsup.config.ts`/`vitest.config.ts`, and the four converted
`src/__tests__/*.test.ts` files. No prior `typescript-cop` turn exists for this phase, so this is a
fresh, exhaustive first pass, not a reconciliation.

This is a low-risk, mechanical toolchain swap: no business logic changed, no new `any`/unsafe casts
introduced (the pre-existing `any`-typed `MockAxios` test double and the `(x as Mock)` cast pattern
are unchanged carry-overs from the prior `(x as jest.Mock)` idiom, not new or expanded holes), no new
boundaries, no new public exports, no new async code. One real gap found: the three new root-level
tooling config files are invisible to both the project's type-checker and its linter.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| typescript-cop-r1-f1 | Medium | Open | TypeHole | `tsconfig.json` (`include: ["src"]`), `eslint.config.js`/`package.json` (`"lint": "eslint src"`) vs. new `orval.config.ts`, `tsup.config.ts`, `vitest.config.ts` | The three new root-level tooling config files are outside `tsconfig.json`'s `include` (`["src"]`) and outside ESLint's `files: ['src/**/*.ts']` glob (and the `lint` script itself only scans `src`), so neither `npm run typecheck` nor `npm run lint` ever parses them — confirmed via `tsc --noEmit --listFiles`, which does not list any of the three. A type error in any of them (e.g. a wrong Orval `override` shape, a bad tsup/vitest option) is silently accepted by both CI gates; it would only surface later as a runtime failure when `orval`/`tsup`/`vitest` actually execute the file, and since their loaders (esbuild-based bundle/transpile, no type-checking) don't verify types either, a mistyped-but-syntactically-valid config could misbehave silently rather than fail fast. This gap will only grow as `orval.config.ts` becomes more load-bearing in Phase 2. | Bring these three files under static verification: either add a second, `noEmit`-only tsconfig (e.g. `tsconfig.tools.json` with `"files": ["orval.config.ts", "tsup.config.ts", "vitest.config.ts"]`, no `rootDir` restriction) and add its `tsc --noEmit -p tsconfig.tools.json` invocation to the `typecheck` script, or extend `eslint.config.js`'s `files` glob (and the `lint` script's target) to also cover `*.config.ts` at the repo root. Either closes the gap without touching `rootDir`/`outDir` semantics for the `src` build. |
