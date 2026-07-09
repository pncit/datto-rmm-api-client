## architect — round 1

Code Review Mode, exhaustive. Scope: Phase 9 — fixtures, `scripts/sanitize-fixtures.mjs`, and the
reconciled-schema fixture-validation suite (`tests/integration/fixtures.test.ts`,
`tests/unit/scripts/sanitize-fixtures.test.ts`). The change set is strictly additive (no `src/`
modification), so there are no layering/dependency-direction regressions in production code and no
public-package-surface changes to classify. My review therefore concentrates on the two structural
axes this phase actually moves: (1) the **security invariants** the sanitizer embodies (R17 at-rest
protection) and how they relate to the sibling controls already in `src/`, and (2) the
**self-consistency of the regression gates** this phase adds.

Prior turns in this directory are from `implementation-auditor` (r1, r2) and `reviser` (r1); there is
no prior `architect` turn, so this is a fresh round — I have read those turns but carry forward no
prior architect findings. I concur with the auditor's assessment that the tests are non-vacuous
(the drop tests bind against genuine non-string `uid`/`alertUid` items; the completeness guard
descends to nested enums via `enumFieldPaths`; the CLI `main()` path is now covered). My findings
below are structural concerns those functional reviews did not weigh.

Analysis notes:

- **Fixture data model is sound.** The six `@class` alert-context fixtures, the `rmmnetworkdevice`
  device, the epoch-ms timestamps, and the malformed-item pages each map to a documented Reality
  finding, and the validation drives the real `validateResponse`/`validateArrayResponse` →
  `parseLenient` path via a `BaseResource` subclass (the established `TestResource` pattern) rather
  than a parallel schema call. No boundary violation there.
- **The completeness guard's direction is adequate.** It proves the type graft's `WIDENED_FIELDS`
  ⊇ {top-level of every enum path}. The reverse (a stale `WIDENED_FIELDS` entry naming a field that
  no longer carries an enum) is harmless — a removed field would fail the `Pick<>` graft at compile
  time, and a surviving non-enum field grafts correctly — so I raise nothing there.
- **Runtime nested-enum widening is not re-proven here, and need not be.** Test block 3 spot-checks
  runtime survival only at top level (`deviceClass`, `priority`); nested runtime widening
  (`antivirusStatus`, `patchStatus`, `actionType`) is guaranteed by `parseLenient`'s field-agnostic
  recursion and covered generically by `schema-leniency.test.ts`. Not a gap worth a finding.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | Medium | Open | Security | scripts/sanitize-fixtures.mjs:43; src/logging/mask.ts:4; src/schema-overrides/device-overrides.ts:17 | The security-relevant invariant "what is a secret-bearing UDF key" (`/^udf\d+$/`) is now defined independently in **three** modules: the new sanitizer's `SECRET_KEY_PATTERNS`, the log-masker's `UDF_KEY`, and `udfSchema`'s regex. This phase added the third copy. The sanitizer (at-rest / R17) and the masker (in-log / R20) are two halves of one guarantee — *no UDF secret ever escapes* — yet each decides what a UDF key is on its own. A future change to the UDF key convention (or a maintainer widening `SECRET_KEY_PATTERNS` to a newly-confirmed secret field) that updates one copy but not the other silently produces the exact split-brain the guarantee forbids: a value masked in logs but committed raw, or redacted at rest but leaked in a log line. Three independent literals with no mechanical link is a single-source-of-truth violation for a security invariant, not a stylistic DRY nit. | Establish one authority for the UDF-key pattern that both security controls reference, and pin the sanitizer/masker agreement mechanically. Concretely: export the pattern (e.g. `UDF_KEY`) from a shared module that both `mask.ts` and the sanitizer can consume, or — given the `.mjs`/TS boundary — at minimum add a test that imports both `SECRET_KEY_PATTERNS` and the masker's `UDF_KEY` and asserts they cover the identical key set, so a future divergence between the at-rest and in-log controls fails the build instead of shipping. Cross-reference the three sites in a comment naming the lockstep requirement. |
| architect-r1-f2 | Low | Open | Security | scripts/sanitize-fixtures.mjs (usage `raw-sweep.json` at repo root); .gitignore | The sanitizer is the sole at-rest control for R17, and its effectiveness rests entirely on a maintainer (a) remembering to run it and (b) never committing the raw input. There is no mechanical guard: `.gitignore` (touched this phase) has no pattern for a raw capture, and the script's own usage example writes/reads `raw-sweep.json` at the repo root — a path nothing prevents from being `git add`-ed. The failure mode (BitLocker keys / credentials, per the design's Reality findings, committed to a public npm-published repo) is catastrophic; a one-line ignore rule is cheap insurance squarely within this phase's "sanitization at rest" scope. The design consciously chose commit-time human review as the guarantee, so this is defense-in-depth rather than a defect in what was asked — hence Low — but it is a concrete, in-scope hardening the reviser can apply now. | Add a `.gitignore` pattern for a documented conventional raw-capture location/name (e.g. `*.raw-sweep.json` or a `tests/fixtures/raw/` dir) and point the sanitizer's usage example at that ignored path, so an unsanitized capture cannot be accidentally staged. If the reviser holds that this belongs with the Phase 10 runbook, record that ruling rather than dropping the guard silently. |
