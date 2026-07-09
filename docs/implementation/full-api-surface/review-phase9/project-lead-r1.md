## project-lead — round 1

**Scope reviewed:** `git diff 9b00367..HEAD` (commit `ba6d9b1`, "checkpoint(implementation):
pre-revision phase9:stepA round 1") plus the current working tree (the reviser's round-1 fixes,
already applied and uncommitted): `scripts/sanitize-fixtures.mjs`, 10 new fixtures under
`tests/fixtures/`, `tests/integration/fixtures.test.ts`, `tests/unit/scripts/sanitize-fixtures.test.ts`,
and `implementation-phase9-notes.md`. Cross-read the code these tests exercise
(`BaseResource.validateResponse`/`validateArrayResponse`, `parseLenient`/`enumFieldPaths`
(`src/validation/schema-leniency.ts`), `OVERRIDE_ENTITIES`/`Device`/`Alert`
(`src/schema-overrides/types.ts`), `withUdfMasking` (`src/logging/mask.ts`)) to confirm the tests'
assertions bind to real behavior rather than restating their own mocks. No `src/` file is modified
by this phase (verified via `git diff --name-only 9b00367 -- src/`, empty) — purely additive, low
rollout risk, no new dependencies.

Also read both `implementation-auditor` turns and the `reviser` round-1 disposition in this review
directory for context; all four of the auditor's round-1 findings (Low: sanitizer CLI untested,
device/alert-only corpus, `lint` gate scope, notes miscount) are `Closed` as of round 2 — I
independently re-verified the two "Fixed" items (the CLI `describe` block now runs the real script
via `execFileSync` and asserts round-trip shape, trailing newline, non-overwrite of input, and the
`Usage:`/exit-1 branch; the notes now say "Five describe blocks", matching the file) and concur with
the reasoning on the two "Rejected" items (both are the plan's own drawn scope boundaries — Deferred
Validation and the pre-existing `eslint src` gate — not Phase 9 deviations).

### Requirements Coverage

| Requirement | Status | Notes |
|-------------|--------|-------|
| R17 — schemas verified against real captured response fixtures | Fully Met | The pre-existing real captures (`device.json`, `devicesPage{,1,2}.json`) are validated alongside the new synthesized corpus through the exact `BaseResource` → `parseLenient` path; the plan's own Deferred Validation item (a genuine live sweep) is explicitly out of this phase's scope, not silently dropped. |
| R5 — response leniency, open-enum degradation with compile/runtime alignment | Fully Met | Truly-novel literals assigned to every enum field (top-level and nested) of both `OVERRIDE_ENTITIES` entities type-check only with the Phase 6 graft present; paired runtime proof (`rmmnetworkdevice` fixture, inline novel `priority`) that the same values survive `parseLenient`. The recursive `WIDENED_FIELDS` completeness guard binds the hand-maintained constant to the real enum-field walk with a non-vacuity check. |
| R7 — per-item collection drop | Fully Met | Both malformed-item pages (device, alert) drop exactly the one bad item and assert the aggregated `{dropped:1,total:2}` `warn`, matching `validateArrayResponse`'s real contract. |
| R8 — corrected spec defects survive (epoch-ms, full udf range, permissive `@class` alertContext) | Fully Met | `rmmnetworkdevice` fixture exercises the device-class defect + partial `udf` record (schema is a regex-keyed `z.record`, so a partial key set is valid — confirmed against `device-overrides.ts`); all six real `@class` discriminators get a dedicated fixture whose context-specific fields are asserted to survive, not just the `@class` key. |
| R20 — UDF masking | Fully Met | The fixture's `SYNTHETIC-UDF-300` marker is asserted absent from every sink call across all four log levels, via the real `withUdfMasking` wrapper (`src/logging/mask.ts`), both through the validation path and a direct `meta`-carrying log call. |
| R1 (contextual — full API surface) | N/A to this phase | Referenced only as end-to-end context; namespace/operation coverage is Phase 7/8's concern, not re-litigated here. |

### Behavior vs. Intent / Scope

The implementation matches the plan's three named steps (fixture corpus, sanitizer, fixture-validation
suite) with no scope creep — every touched file is on the plan's own file list, and the ambiguities the
notes log (test-wiring style, sanitizer CLI argument shape, one-fixture-per-`@class` convention) are
free implementation choices consistent with existing repo precedent (`base-resource.test.ts`'s
`TestResource` pattern, `patch-spec.mjs`'s read-one/write-a-different-file convention), not deviations.
The sanitizer is correctly scoped to the one design-confirmed secret-bearing key pattern (`udf*`) rather
than speculatively inventing others, and correctly does not attempt content-based secret detection —
both match the design's explicit rejection of that approach.

### Risk & Rollout

No production code path changes; this phase adds tests, fixtures, and a maintainer-invoked script.
No feature flag or rollback mechanism is needed. The one security-relevant new artifact
(`scripts/sanitize-fixtures.mjs`) is a pure, side-effect-free transform plus a thin CLI that never
overwrites its input, now with CLI-path test coverage confirming that non-overwrite guarantee holds.

### Dependencies

None added.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|

No open findings from this review. The phase is a faithful, narrowly-scoped implementation of its
plan section; the prior round's Low findings from `implementation-auditor` are independently
re-verified as resolved (see above) and are not re-raised here.
