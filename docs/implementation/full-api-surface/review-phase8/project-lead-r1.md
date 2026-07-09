## project-lead — round 1

Scoped the diff to Phase 8's own window (`71f93e8..HEAD`, i.e. since Phase 7 landed) plus the
working tree, read `plan.md`/`design.md` (Phase 8's declared requirements R1, R2, R19, and the
"Public surface"/"Breaking Changes" sections they key off), the phase notes, and every file the
five new resources, `DattoRmmClient`, `src/index.ts`, `src/public-types.ts`,
`src/client/operation-map.ts`, and their tests touch. Cross-checked `OPERATION_MAP`'s 57 rows
against a programmatic count of the committed `spec/openapi.json` (53 paths / 57 operations,
matches), re-ran the four static Phase 8 exit-gate greps and the old-surface-absence checks by
hand (all pass on this tree), and read the prior `implementation-auditor`/`mediator`/`reviser`
turns already in this directory for context (their three rounds resolved via human ruling; nothing
there overlaps my findings below).

### Requirements Coverage
| Requirement | Status | Notes |
|-------------|--------|-------|
| R1 — every documented v2 operation reachable via `client.<resource>.<operation>()` | Fully Met | `OPERATION_MAP` (57 rows) is duplicate-free and set-equal to the committed spec's own `(method, path)` inventory, and `coverage-map.test.ts` additionally drives every mapped call through a nock intercept scoped to its real verb+path — a genuine mechanical guard, not a hand count. |
| R2 — resource-namespace organization (`client.<resource>.<operation>()`) | Fully Met | All ten namespaces (`account`, `sites`, `devices`, `alerts`, `jobs`, `audit`, `filters`, `users`, `activityLogs`, `system`) are mounted on `DattoRmmClient`; `surface.test.ts` and `datto-rmm-client.test.ts` both assert all ten. |
| R19 — breaking `1.0.0` with no back-compat aliases for retired 0.1.x methods | Fully Met (see project-lead-r1-f1) | `Result`/`ProblemError`/the entire old flat surface are deleted in this commit with no alias, verified by `surface.test.ts` + `tests/generated/surface-pin.ts` + the static exit-gate greps (re-run by hand above, all pass). The version bump itself is correctly deferred to Phase 10 per the plan. The one gap is that the phase's own requirements record undercounts *which* retired methods this covers (below). |

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| project-lead-r1-f1 | Medium | Open | BehaviorIntent | `docs/implementation/full-api-surface/plan.md:531`; `docs/implementation/full-api-surface/design.md` (Migration Strategy → Breaking Changes); `src/index.ts`; `tests/unit/client/surface.test.ts` | The retired 0.1.x flat client (`src/client.ts`, deleted this phase) exposed **four** public methods — `getAccountDevices`, `getDeviceByUid`, `updateDeviceUdfs`, and `invalidateToken` — and this phase's own `surface.test.ts` correctly asserts all four are absent from the new client. But `plan.md:531`'s Phase 8 goal text says the package "no longer exports … the **three** 0.1.x methods," and `design.md`'s "Breaking Changes" enumeration (the record Phase 10's README migration guide, R18, is meant to be written from) names only the first three and never mentions `invalidateToken` at all. `AuthManager.invalidate()` still exists internally, but is wired only to the automatic 401 `onUnauthorized` hook (Phase 5) — there is no public method a caller can invoke to proactively force a fresh token (e.g., after rotating `apiSecret` while the process keeps running), and this capability change was never captured as a deliberate decision anywhere in the requirements record. | Correct `plan.md:531` to say "four" (or name all four retired methods), and add `invalidateToken` to `design.md`'s Breaking Changes list with an explicit note on whether dropping it with no public replacement is intentional (i.e., proactive invalidation is superseded by the automatic 401 handling) — so Phase 10's README migration guide has a complete, accurate list to write upgrade guidance from instead of discovering the fourth retired method while drafting docs. |
| project-lead-r1-f2 | Low | Open | Requirements | `docs/implementation/full-api-surface/implementation-phase8-notes.md` §3 "Files Touched" | The phase's own implementation-notes record is stale against the delivered diff: `src/rate-limit/rate-limits.ts`, `src/client/resources/base-resource.ts`, and `tests/unit/client/base-resource.test.ts` were all modified within this phase's commit range (dropping the dead `filter-create`/`filter-delete` `WriteOpKey` entries and their stale `httpDelete` doc example/test, per this directory's own `implementation-auditor-r1-f3` fix), but none of the three appears in §3's file-touched table — the notes no longer describe what was actually changed in this phase. | Add the three files to §3 with the same rationale already recorded in this directory's round-2/3 history (dead-opKey removal after `implementation-auditor-r1-f3`), so the phase record matches the diff. |
