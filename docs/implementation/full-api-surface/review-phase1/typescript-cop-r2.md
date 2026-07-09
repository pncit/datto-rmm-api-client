## typescript-cop — round 2

Reconciled the single round-1 finding against the current diff (`git diff main` on
`feat/full-api-surface`, plus the working-tree delta since the checkpoint: `package.json`,
`vitest.config.ts`, new `tsconfig.test.json`/`tsconfig.tools.json`), then re-swept the full Phase 1
change for new type-safety issues.

**r1-f1 reconciliation.** Verified `tsconfig.tools.json` exists (`extends: ./tsconfig.json`,
`noEmit: true`, `rootDir: "."`, `types: ["node"]`, `files: ["orval.config.ts", "tsup.config.ts",
"vitest.config.ts"]`), is wired as `typecheck:tools` in `package.json`, and is chained into
`typecheck` (`typecheck:src && typecheck:test && typecheck:tools`). Ran
`tsc -p tsconfig.tools.json --noEmit --listFiles` directly: all three root config files are now
listed and compile clean. The gap the finding identified — neither `tsc` nor ESLint ever parsing
these three files — is closed by the `typecheck:tools` pass (ESLint's `src`-only glob is unchanged,
but the recommendation offered either path and the `tsc` route fully closes the hole).

**New-issue sweep.** Reviewed the round-2 delta (`tsconfig.test.json`, `tsconfig.tools.json`,
`package.json` script chaining, `vitest.config.ts` coverage-exclude additions) plus a fresh pass over
the whole Phase 1 diff (test-file conversions, `tsconfig.json`, `eslint.config.js`, `.gitignore`,
`orval.config.ts`, `tsup.config.ts`). No new type holes, unsafe casts, unvalidated boundaries, or
floating promises: the `tsconfig.test.json`/`tsconfig.tools.json` additions are correctly scoped
(`noEmit`, appropriate `rootDir`/`include`/`files`, no loosening of `strict`), the `__dirname` usage
in the three root configs is runtime-safe under `"type": "module"` (jiti/Vite/esbuild all inject it —
confirmed independently by inspecting `node_modules/jiti/lib/jiti-hooks.mjs` and
`node_modules/vitest/node_modules/vite/dist/node/chunks/node.js`'s config bundler, matching the
architect's and engineer's own conclusions), and the test-file `Mock`-typed casts remain the same
non-widening pattern as the prior `jest.Mock` idiom. No new exports, boundaries, or async code exist
in this phase's diff to introduce fresh risk.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| typescript-cop-r1-f1 | Medium | Closed | TypeHole | — | — | ratified: `tsconfig.tools.json` + the `typecheck:tools` script now type-check `orval.config.ts`/`tsup.config.ts`/`vitest.config.ts` on every `npm run typecheck`; verified via direct `tsc -p tsconfig.tools.json --noEmit --listFiles`. |
