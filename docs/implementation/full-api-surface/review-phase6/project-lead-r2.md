## project-lead — round 2

Scope: re-review against `reviser-r3.md`'s disposition of all four Step B first-round reviewer
turns (`architect-r1`, `engineer-r1`, `project-lead-r1`, `typescript-cop-r1`) — this is the first
reviser round to answer Step B. Re-verified both my own round-1 findings and, independently,
re-read the shipped diff (`base-resource.ts`, all six `schema-overrides/*.ts`, all their tests, and
`implementation-phase6-notes.md`) against `plan.md`'s Phase 6 section and `design.md`'s R-table
rather than trusting the reviser's summary. `architect-r1`/`engineer-r1`/`typescript-cop-r1`'s own
findings (the `httpGetArray` gap, the SSRF/cycle/cap guards, the `Lenient<T>` propagation, the
pre-coerced `deviceSchema`/`alertSchema` exports, the write-body DRY/naming cleanups) are those
agents' findings, not mine to re-litigate — I checked their fixes only insofar as they touch the
requirements/behavior/scope/risk ground this role owns, and found nothing to add there.

### Requirements Coverage (R3, R6, R8) — re-checked post-round-3

Unchanged from round 1: still **Fully met** for all three. The round-3 additions (SSRF/cycle/cap
guards on `paginate`, `httpGetArray`, honest `Lenient<T>` return types, pre-coerced entity schemas)
strengthen R3/R5/R7 delivery further without touching R6/R8's already-complete coverage.

### Re-verification of round-1 findings

- **project-lead-r1-f1** (phase-6 notes stale re: write-body scope/test counts) → **Closed,
  ratified**, with one caveat carried into a new finding below: the specific stale claims this
  finding named (§6 Decision 4's "`device-udf-set` only" framing, §7's "(3 tests)", §3's
  single-worked-example framing, §11's `warrantyDate` open-item) are all now corrected — verified
  directly against the current `write-bodies.ts`/`write-bodies.test.ts`. However, the same
  notes file introduces a *new* stale count while doing so — see `project-lead-r2-f1`.
- **project-lead-r1-f2** (8 of 9 write-body schemas untested for unknown-key rejection) → **Closed,
  ratified**. `tests/unit/schema-overrides/write-bodies.test.ts` now has a "rejects an unknown key"
  case for every one of the 9 schemas (`udfWriteBodySchema`, `siteCreateBodySchema`,
  `deviceJobCreateBodySchema`, `warrantyWriteBodySchema`, both variable-create schemas, both
  variable-update schemas, `updateProxyWriteBodySchema`), CI-gated rather than spot-checked —
  confirmed by direct read of the file (22 `it(...)` blocks, one unknown-key case per schema).

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| project-lead-r1-f1 | Medium | Closed | Documentation | `docs/implementation/full-api-surface/implementation-phase6-notes.md` | Ratified fixed — see re-verification note above. | — |
| project-lead-r1-f2 | Medium | Closed | Tests | `tests/unit/schema-overrides/write-bodies.test.ts` | Ratified fixed — see re-verification note above. | — |
| project-lead-r2-f1 | Low | Open | Documentation | `docs/implementation/full-api-surface/implementation-phase6-notes.md` (§3 Files Touched, §7 Tests) | The notes file rewritten this round (to fix `project-lead-r1-f1`) states `tests/unit/client/base-resource.test.ts` has "22 tests" in both §3 ("including `httpGetArray` (22 tests, nock)") and §7 ("(22 tests, nock)"). The committed file has **25** distinct `it(...)` blocks (verified by direct enumeration: 9 pre-existing describe blocks plus the new `httpGetArray` describe block contribute 25 named cases total, not 22) — a 3-test undercount introduced by this same round's notes rewrite, of the same kind (and in the same two sections) `project-lead-r1-f1` already flagged and this round's fix otherwise corrected. Every other per-file test count in §3/§7 (`paginate.test.ts` 12, `write-bodies.test.ts` 22, `device-overrides.test.ts` 10, `alert-overrides.test.ts` 5, `pagination.test.ts` 6) checks out exactly against the committed files. | Update §3 and §7 to say `base-resource.test.ts` has 25 tests (not 22), and re-total any aggregate figure elsewhere in the file that was derived from the incorrect per-file count. |
