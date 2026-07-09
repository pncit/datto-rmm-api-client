## project-lead — round 1

Scope: `git diff 9b53c42` (the Phase 6 checkpoint) through the current working tree — the five
`*Resource` classes (`account`/`site`/`device`/`alert`/`job`), their shared helpers (`narrow.ts`,
`void-response.ts`, `variable-schema.ts`), the `DattoRmmClient` scaffold, the doc-only
`datto-client-config.ts` edit, the `schema-leniency.ts` bug fix, the `rate-limits.ts`/
`write-bodies.ts`/`schema-overrides/index.ts` extensions the reviser applied for
`implementation-auditor-r1-f4`, and all associated new tests (including the untracked
`tests/generated/schema-mirror-pin.ts`). Cross-checked every implemented operation against
`spec/openapi.json`'s `-v2-account`/`-v2-site`/`-v2-device`/`-v2-alert`/`-v2-job` tags (41
operations total) to verify R1/R2 coverage, and read the implementation-auditor↔reviser exchange
already in this directory before reviewing independently.

### Requirements Coverage
| Requirement | Status | Notes |
|-------------|--------|-------|
| R1 (full v2 surface — this phase's five namespaces) | Fully Met | All 41 operations tagged `-v2-account`, `-v2-alert`, `-v2-device`, `-v2-job`, and `-v2-site` are implemented except `getUsers` (`GET /api/v2/account/users`), which is explicitly and reasonably deferred to Phase 8's `UserResource` and documented in both the class doc and the implementation notes — Phase 8's coverage-map test (plan Phase 8 Step 8) is the named mechanical backstop if it's missed. `POST /api/v2/site/{siteUid}` (site update), flagged incomplete by implementation-auditor-r1-f4, is now implemented (`SiteResource.update()` + `'site-update'` `WriteOpKey`) and verified by this review. |
| R2 (resource-namespace organization, `client.<resource>.<operation>()`) | Fully Met | Five `*Resource` classes over `BaseResource`; namespace placement for cross-tag operations (alerts, `sites.list()`) matches the design's own `openForSite` precedent and is documented at each rehoming decision. |
| Design Decision 5 (pinned replacement shapes) | Fully Met | `client.devices.get(uid)`, `client.account.devices()`, and `client.devices.setUdf(uid, udf)` (realigned to `POST /api/v2/device/{uid}/udf`) all present and tested exactly as pinned. |
| Coexistence rule (old surface untouched, `src/index.ts` untouched) | Fully Met | Verified via diff: no old-surface file (`src/client.ts`, `src/config.ts`, etc.) or `src/index.ts` appears in the Phase 7 diff. |

### Scope discipline
The diff is tightly bounded to Phase 7's declared deliverables. The two exceptions beyond the five
resource files + scaffold — `datto-client-config.ts` (doc-only) and `schema-leniency.ts` (a
targeted, tested bug fix `AlertResource` needs to actually deliver R8's `alertContext` guarantee at
runtime) — are both necessary, minimal, and fully documented, consistent with the plan's "port,
don't reinvent" / phase-necessity carve-out. The reviser's subsequent edits to
`rate-limits.ts`/`write-bodies.ts`/`schema-overrides/index.ts` (adding `'site-update'` and its body
schema) are the correct resolution of a genuine Phase 7 completeness gap (implementation-auditor-r1-f4)
rather than scope creep — they close a real, documented hole in this phase's own R1 obligation, are
narrowly scoped (one table entry, one re-export), and are fully tested. No dependency changes in
this phase.

### Risk & rollout
Low rollout risk as delivered: `DattoRmmClient` is not yet exported from `src/index.ts` (still
Phase 8), so none of this phase's new write surface (site create/update, device move/udf/warranty,
alert resolve/mute/unmute, variable CRUD, proxy set/delete) is reachable by a consumer yet — the
phased rollout itself is the safeguard, and it's honored correctly. R20 (UDF masking) is verified
end-to-end for the one write that carries UDF values (`setUdf`), not just at the Phase 3 decorator
unit level. Every write is tagged with a `WriteOpKey` from the closed Phase 5 union, so a
mistyped/unlisted key is a compile error rather than a silent mis-throttle.

## Findings

No findings. The implementation fully satisfies R1/R2 for this phase's five namespaces (with the
`getUsers` deferral being a reasonable, documented scope decision correctly left to Phase 8's own
gate), matches Decision 5's pinned method shapes exactly, stays inside the phase's scope boundaries,
and introduces no new rollout or dependency risk. The one genuine completeness gap raised by
`implementation-auditor-r1-f4` (unimplemented site update) was fixed and is verified correct and
tested.

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
