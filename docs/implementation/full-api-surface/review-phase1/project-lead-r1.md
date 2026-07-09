## project-lead — round 1

Scope: `git diff origin/main` restricted to Phase 1's actual deliverables — `package.json`,
`package-lock.json`, `tsconfig.json`, `.gitignore`, `eslint.config.js`, `jest.config.js` (deleted),
the four `src/__tests__/*.test.ts` conversions, and the new `orval.config.ts`/`tsup.config.ts`/
`vitest.config.ts`. (The bulk of the repo-wide diff — `design.md`, `plan.md`, `review-plan/**`,
`review-design/**` — is prior-phase planning artifact, not Phase 1 implementation, and is out of
scope for this review.) Also read the phase notes, the two `implementation-auditor` turns, and the
`reviser` disposition already in this review directory — no findings carry forward since this is
project-lead's first turn on this phase.

### Requirements Coverage
| Requirement | Status | Notes |
|-------------|--------|-------|
| R16 — build uses tsup; tests use vitest+nock; ESM-only, Node ≥ 20; publishes `dist`+types (Phase 1's slice: the toolchain swap itself) | Fully Met | `build`→`tsup` (`tsup.config.ts`: single ESM entry, `dts:true`, matches the Non-Goal-driven deviation from `fuze-api`'s two-entry browser build); `test`→`vitest run` (`vitest.config.ts`: globals, node env, `@` alias, coverage excludes matching the plan snippet); `nock@^14` added as a devDependency per plan Step 1 but deliberately unexercised this phase (no HTTP layer exists yet to mock) — correctly deferred, not a gap in *this* phase's slice of R16. `package.json` `main`/`types`/`files` (`dist`, `README.md`, `LICENSE`) already matched the tsup output shape and needed no edit. `engines.node >=20.0.0` unchanged; `@types/node` deliberately pinned `^22` (not `fuze-api`'s `^26`) per the plan's explicit Node-20-floor rationale. |

### Scope & Focus
No old runtime source (`src/client.ts`, `src/config.ts`, `src/auth.ts`, `src/httpClient.ts`,
`src/rateLimiter.ts`, `src/tokenStore.ts`, `src/validation.ts`, `src/schemas.ts`, `src/logger.ts`,
`src/result.ts`, `src/internal/`) was touched — the coexistence rule is honored and no Phase 2+ work
(spec fetch, patch step, codegen output, new `src/errors|logging|http|rate-limit|client` directories)
leaked in. The `eslint.config.js` test-globals swap (`jest`→`vi`) and the ESM `__dirname` fix in two
fixture-loading tests are both direct, minimal consequences of retiring Jest for Vitest, not
opportunistic refactors — correctly scoped as Phase 1 necessities rather than deferred or expanded.

### Risk & Rollout
Dev-toolchain-only change with no runtime/production code path touched (all new dependencies are
`devDependencies`, excluded from the published `files` list); no auth/billing/permissions surface is
in play. Reversion is a plain revert of this phase's commit. No feature flag or staged rollout is
warranted for a build/test tooling swap that ships nothing to consumers yet.

### Dependencies & Licenses
All six new devDependencies (`orval`, `tsup`, `vitest`, `nock`, `@vitest/coverage-v8`, `@types/node`)
are MIT-licensed, version-range-pinned per the plan (verified against the installed tree:
orval 7.21.0, tsup 8.5.1, vitest 4.1.10, nock 14.0.16, @vitest/coverage-v8 4.1.10, @types/node
22.20.1 — all satisfy their `^` ranges), and each is necessary for the stated toolchain convergence
with `fuze-api` (none is trivially internally-implementable; `orval`/`tsup`/`vitest` are exactly the
generation/build/test engines the plan requires). `jest`/`ts-jest`/`@types/jest` are fully removed
(`package.json`, and no residual reference anywhere under `src/` or config files).

### Behavior vs Intent
The four converted test suites (`client.test.ts`, `deviceSchema.test.ts`, `devicesMethod.test.ts`,
`validation.test.ts`) show no assertion or fixture changes — only harness mechanics (`jest.fn`→
`vi.fn`, `jest.spyOn`→`vi.spyOn`, `jest.Mock`→vitest's `Mock` type, explicit `vitest` imports, ESM
`__dirname`). This matches the phase's stated intent exactly: prove the runner swap is behavior-
neutral against the still-`Result<T>`-returning old surface. `tsconfig.json`'s
`moduleResolution: Bundler` + `module: ESNext` pairing (with the pre-existing `ESNext` `module`
value) is the one combination that both satisfies `tsc`'s validity constraint and avoids forcing
`.js` import extensions onto the old relative-import files, which is exactly what the plan calls out
as load-bearing for keeping `typecheck` green through Phase 7.

No further issues found. This is a faithful, narrowly-scoped toolchain migration; the sole prior
finding in this review directory (`implementation-auditor-r1-f1`, a Prettier-formatting nit on the
three new root config files) was independently verified fixed and closed in that reviewer's own
round 2 — nothing to re-open from this angle.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
