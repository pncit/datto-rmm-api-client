## architect — round 1

Code Review Mode, exhaustive. Scope: the Phase 10 change set — `README.md` (rewritten),
`package.json` (version bump + new `exports` map), and `tests/unit/readme.test.ts` (new). The
`.github/workflows/*` and `.gitignore` hunks in the branch diff belong to earlier phases (R2/R9/R15
comments, not in Phase 10's Files Touched) and are out of this phase's scope.

Prior turns in this review dir are from `implementation-auditor` (a completeness/docs reviewer), not
a prior `architect` turn, so there is no `architect` disposition to reconcile; I treat this as a
fresh round 1. I did re-verify the two auditor findings the reviser marked Fixed to avoid re-raising
settled ground: `implementation-auditor-r1-f1` (`retryAfterMs` documented on 429 **and** 403
`ip-block`) and `-f2` (exported-types pointer now resolves for an npm consumer) are both genuinely
addressed in the current `README.md` — I do not re-open either.

Verification performed against source (not restated from the notes):
- Namespace→endpoint map reconciled row-by-row against `src/client/operation-map.ts`: 57 operations,
  ten namespaces, verbs/paths correct; per-namespace table counts sum to 57. Accurate.
- Documented method signatures spot-checked against the real resource classes
  (`device-resource.ts`, `site-resource.ts`, `account-resource.ts`, `user-resource.ts`,
  `system-resource.ts`) — `move(uid, siteUid)`, `createJob(uid, body)`, `setUdf(uid, udf)`,
  `resetKeys()`, `requestRate()`, etc. all match.
- Rate-limit claims (`read 600 / aggregate-write 600 / window 60`, `device-udf-set` 600 vs common
  100) verified against `src/rate-limit/rate-limits.ts`; retry/token defaults against
  `src/defaults.ts`. Accurate.
- `resetKeys(): Promise<AuthUserKey>` — `AuthUserKey` is exported from `src/public-types.ts`, so the
  return type is nameable; no public-API gap there.

One real, actionable issue tied directly to this phase's `package.json` change is below.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | Medium | Open | PublicAPI | package.json l.7–12 | The new `exports` map declares only the `"."` entry. Introducing an `exports` field flips Node/bundler resolution from "any file in the tarball is reachable by subpath" to "**only** the explicitly-mapped subpaths are reachable" — so as of this phase, `import 'datto-rmm-api-client/package.json'` (and every other subpath) now throws `ERR_PACKAGE_PATH_NOT_EXPORTED`, where before this phase (no `exports` field, only `main`/`types`) it resolved. Deep-resolving a dependency's `package.json` is common in the ecosystem (build tools, test runners, `read-pkg`/`pkg-dir`-style helpers, some ESLint/TS tooling doing `require.resolve('datto-rmm-api-client/package.json')`). This is a silent, narrow regression the `exports` addition introduces at the 1.0.0 release boundary, and the standard mitigation is explicit. | Add `"./package.json": "./package.json"` to the `exports` map (the widely-recommended companion entry whenever an `exports` field is introduced) so tooling that resolves the manifest by subpath keeps working, without re-opening the whole tarball. |
