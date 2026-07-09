## project-lead — round 2

### Scope

`git diff main` (current branch `feat/full-api-surface`, working tree — includes the reviser's r2
fixes already applied on disk) scoped to Phase 10's own Files Touched: `README.md` (rewritten),
`package.json` (`1.0.0` bump + `exports` map), `package-lock.json` (root version resync), and
`tests/unit/readme.test.ts` (new). `src/**` untouched, consistent with the phase notes' declared
scope. (`docs/implementation/full-api-surface/pipeline-run.json` is run-tracking metadata, not
reviewable product.)

### Reconciliation of round-1 findings

All three of my round-1 findings were marked `Fixed` by the reviser (round 2). I independently
re-verified each against the current diff/source rather than trusting the disposition text:

- **project-lead-r1-f1** (unverified-shapes callout missing) — confirmed closed. `README.md`
  l.166-169 (`### client.sites`) and l.233-238 (`### client.audit`) now each carry an explicit
  "Unverified shape(s)" callout naming `updateProxy`/`deleteProxy` and `getPrinter`/`getEsxiHost`
  respectively as spec-derived-only, discharging design.md's Risks & Mitigations commitment.
- **project-lead-r1-f2** (`package-lock.json` still `0.1.14`) — confirmed closed. `package-lock.json`
  l.3 and l.9 both read `"1.0.0"`; `git diff main -- package-lock.json` shows only the two version
  fields changed, no dependency-graph churn.
- **project-lead-r1-f3** (weak per-namespace method check) — confirmed closed.
  `tests/unit/readme.test.ts` now scopes every per-namespace assertion to that namespace's own
  `namespaceSection()` slice (l.27-40, used at l.96 and l.106), and adds a new `it.each(OPERATION_MAP)`
  block (l.103-118) that locates each operation's own table row and asserts both its HTTP verb and a
  placeholder-tolerant path match — a real per-row drift guard, not a whole-document substring
  search.

I also re-verified the other three reviewers' round-1 findings the reviser marked `Fixed`
(`architect-r1-f1`, `engineer-r1-f1`, `typescript-cop-r1-f1`, `implementation-auditor-r1-f1/-f2`) to
confirm none regressed and none masks a live issue in this phase's own scope: `package.json`'s
`exports` map now includes the `"./package.json"` companion entry (l.7-13); the Quick Start example
(README.md l.73-84) replaced both non-null assertions with explicit presence checks that throw; the
`retryAfterMs`/403-`ip-block` and exported-types-pointer doc fixes are present and accurate. These
are not mine to re-litigate (implementation-auditor's own r2 already ratified its two), but nothing
here contradicts that.

### Fresh verification (round 2)

Beyond reconciling prior findings, I independently re-checked the phase's factual surface against
source rather than re-trusting either the notes or the other reviewers' round-1 passes:

- Row-counted every namespace table against a live `OPERATION_MAP` dump: account 8, sites 14,
  devices 7, alerts 10, jobs 5, audit 5, filters 2, users 2, activityLogs 1, system 3 = 57 — matches
  the README exactly, namespace-by-namespace.
- Spot-checked the "(paginated)" annotations against the actual resource implementations
  (`base-resource.ts`'s `paginate` vs `httpGetArray`): every README row so marked calls `paginate`
  (e.g. `account.dnetSiteMappings`, `sites.deviceFilters`), and every row correctly *not* marked
  uses the bare-array `httpGetArray` path (e.g. `devices.getByMacAddress`,
  `audit.getDeviceByMacAddress`, `jobs.getStdOut`/`getStdErr`).
- Cross-checked the "Upgrading from 0.1.x" section's five breaking changes plus the
  `invalidateToken()` callout against design.md's Migration Strategy §Breaking Changes (l.476-504)
  verbatim in substance — all five present, `invalidateToken()` framed as an unintentional capability
  gap as the design explicitly requires this phase to state.
- Confirmed `package.json`'s `engines.node >=20.0.0`, `type:"module"`, `files`,
  `publishConfig.access:"public"` are unchanged/correct, and `LICENSE` reads "MIT License /
  Copyright (c) 2025 PNC IT", matching the README's closing "MIT © PNC IT" line.
- Re-read `scripts/sanitize-fixtures.mjs`'s own header doc and `.gitignore`'s `*raw-sweep.json`
  pattern (l.163) against the README's "Maintainer runbook" section — the CLI invocation,
  key-based-not-content-based rationale, and `.gitignore` convention are stated accurately.

No new issues found. All requirements (R18, R16, R19) remain Fully Met against the design's R-table
wording; no scope creep; no unmitigated risk in this documentation/release-metadata-only phase.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| project-lead-r1-f1 | Medium | Closed | Requirements | README.md l.166-169, l.233-238 | — | ratified: "Unverified shape(s)" callouts added for `sites.updateProxy`/`deleteProxy` and `audit.getPrinter`/`getEsxiHost`, discharging design.md's Risks & Mitigations commitment. |
| project-lead-r1-f2 | Medium | Closed | Rollout | package-lock.json l.3, l.9 | — | ratified: lockfile root `name`/`version` resynced to `1.0.0` via `npm install --package-lock-only`; diff confirmed no dependency-graph churn. |
| project-lead-r1-f3 | Low | Closed | Requirements | tests/unit/readme.test.ts l.27-40, l.92-118 | — | ratified: per-namespace checks now scoped to that namespace's own section slice, plus a new per-operation `it.each(OPERATION_MAP)` block asserting verb+path per row — a real drift guard, not a whole-document substring search. |
