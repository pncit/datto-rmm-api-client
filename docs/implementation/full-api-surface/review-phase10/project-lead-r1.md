## project-lead — round 1

### Scope

Diff scoped via `git diff 6c1bfb7..HEAD` (phase-9 boundary → current `phase10:stepA` head) plus the
uncommitted working-tree edit to `README.md` (the reviser's r1 fix, already applied on disk): net
changes are `README.md` (rewrite), `package.json` (version bump + `exports` map), and
`tests/unit/readme.test.ts` (new). No `src/**` behavior changed, consistent with the phase notes'
declared scope.

### Requirements Coverage (plan's declared R18, R16, R19)

| R-ID | Requirement (design.md) | Status | Notes |
|------|--------------------------|--------|-------|
| R18 | Comprehensive README: install, auth, namespace→endpoint map, error handling, logger injection, validation leniency, rate-limit config | Partially met | All named topics present and verified accurate against source (operation map, error classes, defaults, rate-limit table, mask.ts). One design-mandated risk-mitigation item is missing from the README text — see f1. |
| R16 | tsup build, vitest+nock tests, ESM-only, Node ≥20, publishes `dist`+types | Fully met | `package.json`/`tsup.config.ts` confirmed; `exports` map is a reasonable in-scope hardening per the phase notes' own decision log. |
| R19 | Breaking `1.0.0`, no back-compat aliases | Fully met for `src/**` (verified in Phase 8) and for the version field itself, but the release-prep artifact set is incomplete — see f2 (`package-lock.json` still declares `0.1.14`). |

### Verification performed

Cross-checked, line-by-line, every factual claim in the rewritten README against the actual
implementation rather than the plan's prose: `src/client/operation-map.ts` (all 57 operations / 53
paths / 10 namespaces — table rows match exactly), `src/errors/datto-api-error.ts` and
`datto-validation-error.ts` (field surfaces, and the 403-`ip-block`/429 `retryAfterMs` fix already
applied by the reviser), `src/http/http-client.ts` (retry/backoff math, `Retry-After` handling,
403 no-retry), `src/defaults.ts` and `src/rate-limit/rate-limits.ts` (config defaults and rate-limit
table numbers), `src/logging/mask.ts` (masking guarantee and its two documented boundaries),
`src/public-types.ts`/`src/index.ts` (exported-type list, curated re-export claim), `.gitignore`
(`*raw-sweep.json` pattern) and `scripts/sanitize-fixtures.mjs` (CLI usage). All of these check out.

### Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| project-lead-r1-f1 | Medium | Open | Requirements Coverage (R18) | README.md — `## Namespaces & endpoint map` / `### client.audit`, `### client.sites` proxy rows | design.md's Risks & Mitigations table commits, for the "Printer/ESXi audit and proxy-settings shapes are unverified" risk, that "README notes them as unverified" — this is the one place that risk's mitigation is discharged. The rewritten README documents `audit.getPrinter`/`audit.getEsxiHost`/`sites.updateProxy`/`sites.deleteProxy` exactly like every other fully-verified endpoint, with no note that these particular shapes are spec-derived-only (absent from the sampled account used to validate every other reconciled schema). A consumer has no way to know these four operations carry less real-world validation confidence than the rest of the surface. | Add a one- or two-line callout (in `### client.audit` and/or the proxy rows of `### client.sites`) noting that printer/ESXi audit responses and site proxy-settings shapes are derived from the spec only and have not been validated against real captured data (per the design's own risk table), so a consumer hitting an unexpected shape there knows why. |
| project-lead-r1-f2 | Medium | Open | Risk/Rollout | `package-lock.json` (untouched by this phase) vs. `package.json` l.3 | Phase 10's own goal is "bump the version and verify the publish shape," but `package-lock.json`'s root `packages[""].version` (and top-level `version`) still reads `"0.1.14"` — it was never regenerated after the `package.json` version bump to `1.0.0`. Both CI workflows (`validate.yml`, `npm-publish.yml`) run `npm ci` immediately after checkout; while an `npm ci` with an unchanged dependency graph does not hard-fail on a root-version-only mismatch (verified empirically), shipping a tagged `1.0.0` release whose committed lockfile still identifies the package as `0.1.14` is a real, visible inconsistency for any tooling or auditor that reads the lockfile (dependency-graph scanners, Renovate/Dependabot, `npm ls`), and it means the very next unrelated dependency-bump PR will show a large, unrelated-looking lockfile diff (the version fields finally catching up) instead of a clean, isolated dependency change. | Run `npm install` (no dependency changes needed, just to resync the lockfile's root `name`/`version` metadata) and commit the regenerated `package-lock.json` alongside the `1.0.0` bump, as part of this phase's release-prep step. |
| project-lead-r1-f3 | Low | Open | Test Quality | tests/unit/readme.test.ts l.646-661 (`documents at least one method for client.%s`) | The per-namespace method-presence assertion checks only whether **some** method name from that namespace appears anywhere in the whole README as `` `methodName( ``, not that it appears under that namespace's own section. Several method names are shared across namespaces (e.g. `get(` is used by `account`, `sites`, `devices`, `jobs`, `alerts`). If a namespace's table row for its own distinctly-named method were accidentally deleted while another namespace's identically-named method row survived, this test would still pass — the doc-drift guard the plan asks for ("guards the namespace→endpoint map against drift") is weaker than it looks for any namespace whose only checked method name collides with another namespace's. | Scope the per-namespace method check to the text following that namespace's own `` `client.<ns>` `` heading (e.g. slice the README between this namespace's heading and the next `###`/`##` before searching for the method name), so a row deleted from the wrong section can't be masked by an identically-named method documented elsewhere. |
