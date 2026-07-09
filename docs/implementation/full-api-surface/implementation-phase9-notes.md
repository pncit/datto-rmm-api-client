# Implementation Notes — Phase 9

- **Plan:** full-api-surface
- **Phase:** 9
- **Date:** 2026-07-09
- **Agent:** Implementor

---

## 1. Phase Scope Confirmation

**In-Scope (Phase 9 only):**
- Synthesized-plus-real fixtures under `tests/fixtures/`, deliberately encoding every leniency
  path the design names: nullability, `udf1…udf300` (with a clearly-synthetic marker), the real
  `deviceClass:'rmmnetworkdevice'` defect, `@class`-tagged alert contexts (all six named
  discriminators), a malformed collection item to drop, and epoch-ms timestamps.
- `scripts/sanitize-fixtures.mjs`: the deterministic, key-based sanitization step a maintainer
  runs before committing a real captured sweep.
- `tests/integration/fixtures.test.ts`: parses every fixture through the reconciled schemas via
  `BaseResource`'s own `validateResponse`/`validateArrayResponse` → `parseLenient` path, proving
  R5/R7/R8/R17/R20/R1 end-to-end against realistic data, plus the recursive `WIDENED_FIELDS`
  completeness guard over the Phase 6 `OVERRIDE_ENTITIES` registry.
- `tests/unit/scripts/sanitize-fixtures.test.ts`: unit coverage of the sanitizer's redaction,
  shape-preservation, and idempotency behavior.

**Explicitly Out-of-Scope:**
- Any change to already-implemented source under `src/` — Phase 9 is purely additive (fixtures,
  one new script, two new test files); nothing in Phases 1–8's own logic needed to change. Verified:
  `git status` after this phase shows only new, untracked files — no tracked file was modified.
- README / maintainer runbook documentation of the sanitizer's usage (Phase 10 — this phase's own
  "Documentation" section is explicitly "None yet" in the plan).
- An automated secret-content scanner over `spec/`/fixtures — the plan explicitly does not want
  one (Step 2's own note); the at-rest guarantee is the key-based sanitizer plus commit-time human
  review, not a detector.
- Live/real captured-sweep validation against a production Datto account (Deferred Validation) —
  this phase's fixtures are synthesized specifically because "real captured sweep data is not
  available to an Implementor agent" (plan's own Assumptions).

---

## 2. Phase Intent (Interpreted)

Prove — mechanically, not by assertion — that the schemas Phases 2–6 generated and reconciled
actually validate the shapes production Datto RMM traffic is known to return, and give a future
maintainer a safe, deterministic way to grow that fixture corpus from a real account without ever
committing a secret. Two halves: (1) a fixture corpus deliberately engineered to hit every
leniency path the design's "Reality findings" section documents, validated through the exact
production code path (`BaseResource` → `parseLenient`), including the one guard that turns "the
compile-time enum graft and the runtime enum widener cover the same field set" from a documented
claim into a build-breaking regression test; and (2) the at-rest sanitizer that makes future real
captures commit-safe by construction.

---

## 3. Files Touched

| File | Change Type | Rationale |
|------|------------|-----------|
| `scripts/sanitize-fixtures.mjs` | Created | Deterministic, key-based redaction of `udf*` (and any future documented secret-bearing key) to `null`, preserving shape — the at-rest guard for a real captured sweep (plan Step 2) |
| `tests/unit/scripts/sanitize-fixtures.test.ts` | Created | Unit coverage: redaction, full-key-set/shape preservation, idempotency, pattern scope (plan's own named test) |
| `tests/fixtures/device-rmmnetworkdevice.json` | Created | Synthesized device: `deviceClass:'rmmnetworkdevice'`, many nulls, `udf300:'SYNTHETIC-UDF-300'` (plan Step 1) |
| `tests/fixtures/devices-page-with-malformed-item.json` | Created | Paginated devices envelope with one item carrying a non-string `uid` — drives the R7 per-item-drop assertion |
| `tests/fixtures/alerts-page-with-malformed-item.json` | Created | Paginated alerts envelope with one item carrying a non-string `alertUid` — same R7 assertion for `Alert` |
| `tests/fixtures/alert-context-comp-script.json` | Created | Alert with `alertContext['@class'] === 'comp_script_ctx'` |
| `tests/fixtures/alert-context-eventlog.json` | Created | `'eventlog_ctx'` |
| `tests/fixtures/alert-context-patch.json` | Created | `'patch_ctx'` |
| `tests/fixtures/alert-context-antivirus.json` | Created | `'antivirus_ctx'` |
| `tests/fixtures/alert-context-online-offline-status.json` | Created | `'online_offline_status_ctx'` |
| `tests/fixtures/alert-context-perf-resource-usage.json` | Created | `'perf_resource_usage_ctx'` |
| `tests/integration/fixtures.test.ts` | Created | Fixture-validation suite: leniency coverage, per-item drop, build/runtime enum-widening alignment, `WIDENED_FIELDS` completeness guard, UDF-masking-against-real-fixture-data |

`tests/fixtures/device.json`, `devicesPage.json`, `devicesPage1.json`, `devicesPage2.json` (the
real captures moved here in Phase 8) are **read, not modified** — kept as-is and folded into this
phase's "every fixture validates" assertions per the plan's own instruction to "keep/extend" them.

---

## 4. Implementation Summary

**Fixture corpus.** Six new single-entity/envelope fixtures plus six per-`@class` alert-context
fixtures were added under `tests/fixtures/`, each engineered to exercise one specific defect
pattern from the design's "Reality findings": the `rmmnetworkdevice` device class the old
hand-written schema silently rejected; a `udf1…udf300`-range synthetic marker
(`SYNTHETIC-UDF-300`) rather than a plausible-looking value, so a fixture reader can tell at a
glance it is fabricated, never captured; a malformed item in an otherwise-valid paginated
collection (both `devices` and `alerts`); and the six real Jackson `@class` discriminators the
design names verbatim (`comp_script_ctx`, `eventlog_ctx`, `patch_ctx`, `antivirus_ctx`,
`online_offline_status_ctx`, `perf_resource_usage_ctx`), each with plausible context-specific
fields the permissive `alertContextSchema` catchall must preserve, not just tolerate the `@class`
key alone. Every device fixture uses epoch-ms integer timestamps (matching the Phase 2 patch
step's correction), consistent with the pre-existing real captures.

**`scripts/sanitize-fixtures.mjs`.** A pure `sanitizeValue(value)` walking any JSON-shaped value
(the raw sweep can be a single entity, a page envelope, or a whole multi-entity file, so the walk
is schema-independent, not driven off a Zod schema) plus a thin CLI wrapper — the same
pure-core/thin-CLI split every other `scripts/*.mjs` in this repo follows
(`patch-spec.mjs`/`dedupe-generated-index.mjs`). `SECRET_KEY_PATTERNS` is a documented, currently
one-entry (`/^udf\d+$/`) array — UDFs are the only field confirmed to carry secrets in real Datto
data per the design's Reality findings and Risk table, and the array shape gives a future
confirmed secret-bearing field one place to add to without restructuring the walk. Redaction is
key-based (matches by field name at any depth, replacing the value with `null`) rather than
content-based, mirroring the design's explicit rejection of a content-scanning heuristic (false
positives on the committed OpenAPI document's own prose, false negatives on a novel secret shape).

**`tests/integration/fixtures.test.ts`.** A `FixtureValidator` (a minimal `BaseResource` subclass
exposing `validateResponse`/`validateArrayResponse` publicly, with no HTTP/nock involved since
these take already-parsed data) drives every fixture through the *exact* validation path every
`*Resource` method (Phase 7/8) uses — `validateResponse`/`validateArrayResponse` →
`parseLenient` — rather than a parallel, hand-rolled schema call. Six describe blocks cover the
plan's named assertions:
1. **Every fixture validates leniently** (R5/R8/R17) — every single-entity and page-envelope
   fixture parses without throwing and without an unexpected drop.
2. **Per-item drop (R7)** — the malformed-item device/alert pages each drop exactly the one bad
   item, keep the rest, and emit exactly one aggregated `warn` (`dropped:1, total:2`), consistent
   with `validateArrayResponse`'s own aggregation contract (Phase 6).
3. **Build-time/runtime enum-widening alignment (R5)** — truly novel literal values
   (`'quantumdevice'`, `'QuantumAV'`, `'QuantumPatch'`, `'QuantumPriority'`, `'QUANTUM_ACTION'`)
   are assigned to every enum field of every `OVERRIDE_ENTITIES` entity — top-level
   (`Device['deviceClass']`, `Alert['priority']`) and nested (`Device['antivirus']
   ['antivirusStatus']`, `Device['patchManagement']['patchStatus']`,
   `Alert['responseActions'][number]['actionType']`) — which only type-checks if the Phase 6 graft
   is present at that exact depth; paired with runtime proof (the `rmmnetworkdevice` fixture, and
   an inline novel-`priority` Alert) that the same value survives `parseLenient` rather than being
   dropped.
4. **`WIDENED_FIELDS` completeness guard** — iterates the Phase 6 `OVERRIDE_ENTITIES` registry,
   calling the Phase 4 `enumFieldPaths(schema)` helper (the one place `_zod.def` introspection is
   isolated) against each entity's own override schema, and asserts every discovered enum field's
   containing top-level property is listed in that entity's `WIDENED_FIELDS` constant — turning
   the "the graft and the runtime widener cover the same field set" claim from Phase 6's doc
   comments into an enforced, build-breaking regression gate.
5. **UDF masking against real fixture data (R20)** — the `rmmnetworkdevice` fixture's own `udf`
   payload is both validated through the masked-logger-wired path and logged directly through the
   same `withUdfMasking` boundary; no sink call, across all four log levels, ever serializes the
   raw `SYNTHETIC-UDF-300` marker.

---

## 5. Deviations From Plan (If Any)

No deviations. All three named steps (fixtures, sanitizer, fixture-validation tests) were
implemented as specified; every naming/shape choice not pinned by the plan (fixture file names,
the specific per-`@class` context field values, the sanitizer's CLI argument shape) was a free
implementation decision, documented below rather than treated as a deviation.

---

## 6. Ambiguities & Decisions

- **"Via the resource/parseLenient path" (fixture-validation test wiring).** The plan's Tests
  section says fixtures are parsed "through its reconciled schema via the resource/`parseLenient`
  path" without pinning whether that means driving actual `nock`-mocked HTTP calls through a real
  `*Resource` instance (as Phase 7/8's resource tests do) or calling `BaseResource`'s own
  protected validation primitives directly against fixture data. Chose the latter: a minimal
  `FixtureValidator` subclass of `BaseResource` that exposes `validateResponse`/
  `validateArrayResponse` publicly, constructed with a bare (never-dispatched) axios instance.
  This exercises the identical `validateResponse`/`validateArrayResponse` → `parseLenient` code
  path every resource method funnels through — the literal "resource ... path" — without
  re-testing HTTP routing/verb/opKey-tagging, which Phase 7/8's own per-resource `nock` suites
  already cover exhaustively and which this phase's own scope (schema validation against
  realistic *data*, not endpoint routing) does not ask it to re-prove. This is the same harness
  pattern `tests/unit/client/base-resource.test.ts`'s own `TestResource` already establishes in
  this codebase, applied here rather than reinvented.
- **Sanitizer's other secret-bearing keys.** The plan's Step 2 says the sanitizer redacts `udf*`
  "and any other value under a fixed, documented set of secret-bearing keys." No such second key
  is named anywhere in the plan or design (the design's own Non-Goals explicitly scope masking to
  UDFs only: "masking of non-UDF secret fields" is out of scope). `SECRET_KEY_PATTERNS` therefore
  ships with exactly the one documented, verified pattern (`/^udf\d+$/`) today, structured as an
  array specifically so a future confirmed secret-bearing field has one place to add to — not
  invented speculatively now.
- **Sanitizer CLI shape.** The plan names the script but not its argument contract. Chose
  `node scripts/sanitize-fixtures.mjs <raw-sweep-file.json> <sanitized-output.json>` (explicit
  input/output paths, never overwriting the raw capture in place) — mirroring `patch-spec.mjs`'s
  own read-one/write-a-different-file convention, and safer than an implicit in-place rewrite
  given the raw input is exactly the file that must never be committed.
- **One `@class`-context fixture per discriminator, not one fixture with six alerts.** Chose six
  separate, individually named files (`alert-context-<discriminator>.json`) over one combined
  array — each is independently loadable/readable by name in a test failure message, and matches
  this repo's existing one-fixture-per-shape convention (`device.json`, `devicesPage1.json`,
  `devicesPage2.json` are each their own file rather than combined).
- **`SINGLE_DEVICE_FIXTURES`/`DEVICE_PAGE_FIXTURES`/`ALERT_CONTEXT_FIXTURES` as explicit,
  hand-listed arrays rather than a directory scan.** A `readdirSync`-based auto-discovery would
  need per-file shape inference (single value vs. page envelope vs. malformed-on-purpose) to know
  which assertion to run against each fixture — indistinguishable from the file's *name* alone
  without a naming convention rigid enough to encode "this one is deliberately malformed." Explicit
  lists are self-documenting at the point of use and match the plan's own small, fixed fixture set
  (naming each intended fixture in Step 1's own prose) rather than treating the directory as an
  open-ended, auto-discovered corpus.

---

## 7. Tests

- **`tests/unit/scripts/sanitize-fixtures.test.ts`** (7 tests): top-level and nested `udf*`
  redaction; full key-set/shape preservation across a realistic page-envelope-shaped sample;
  already-`null` values stay `null`; idempotency (sanitizing twice is a no-op after the first
  pass); a key merely *containing* `udf` as a substring (`udfDescription`) is not redacted;
  `SECRET_KEY_PATTERNS` matches `udf1`/`udf300` and not `uid`/`apiSecretKey`.
- **`tests/integration/fixtures.test.ts`** (21 tests): every real-capture and synthesized fixture
  validates leniently with nothing unexpectedly dropped; the `rmmnetworkdevice` fixture's synthetic
  `udf300` marker and `deviceClass` survive untouched, and its many nulls are tolerated; each of
  the six `@class` fixtures' own context-specific fields survive the `alertContextSchema` catchall;
  both malformed-item pages drop exactly one item and emit exactly one aggregated `warn`
  (`dropped:1, total:2`); every enum field of every `OVERRIDE_ENTITIES` entity — top-level and
  nested — type-checks against a truly novel literal and, for `Device`/`Alert`, survives
  `parseLenient` at runtime without being dropped; the recursive `WIDENED_FIELDS` completeness
  guard passes over the real `OVERRIDE_ENTITIES` registry (with a non-vacuity sanity check); UDF
  masking never leaks the fixture's raw synthetic marker across any of the four log levels.

---

## 8. Security & Best-Practices Review

- **No new dependencies.**
- **No secrets committed.** Every synthesized fixture's only "sensitive-shaped" value is the UDF
  field, and it deliberately uses the `SYNTHETIC-UDF-<n>` marker precisely so it is legible as
  fabricated test data, never mistakable for a real captured secret. The real captures this phase
  reuses (`device.json`, `devicesPage*.json`) were not modified.
- **The sanitizer is the one new piece of security-relevant tooling this phase adds**, and it is a
  pure, side-effect-free transform (`sanitizeValue`) plus a thin CLI wrapper that never overwrites
  its input — reviewed directly against the design's own risk-mitigation text (key-based, not
  content-based; no automated secret detector) rather than assumed compliant.
- **No `any` introduced.** `sanitize-fixtures.mjs` is checked under `tsconfig.test.json`'s
  `checkJs` (which already covers every other `scripts/**/*.mjs`); `npm run typecheck` is clean.
  `FixtureValidator` in the test file uses the same generic `<T>`/`z.ZodType<T>` typing
  `TestResource` already establishes in `base-resource.test.ts` — no `unknown`-widening cast
  beyond the documented `as Device`/`as Alert` narrowing every other resource test in this repo
  already performs at its own assertion sites.

---

## 9. Self-Review Scoring

| Element | Before | After | Comments |
|---------|--------|-------|----------|
| Extensibility | 9.0 | 9.6 | `SECRET_KEY_PATTERNS` and the fixture-inventory arrays each give a future maintainer one obvious place to add a new secret-bearing key or fixture, matching this repo's established single-source-of-truth pattern (`TIMESTAMP_FIELDS`, `WriteOpKey`). |
| Understandability | 9.2 | 9.6 | Every fixture's filename states exactly what defect it encodes; the test file's own doc explains the real-vs-synthesized split and why `FixtureValidator` reaches into `BaseResource` rather than mocking HTTP. |
| Best Practices | 9.0 | 9.6 | Reused `enumFieldPaths`/`OVERRIDE_ENTITIES`/`BaseResource` rather than re-deriving parallel logic; matched the repo's established pure-core/thin-CLI script convention; zero lint/typecheck findings; prettier-clean. |
| Plan Adherence | 9.0 | 9.7 | All three named steps implemented exactly, with the one genuinely open call (test wiring style) resolved against a documented, precedent-matching rationale rather than guessed silently. |
| Test Quality | 9.0 | 9.7 | Every plan-named assertion has a corresponding test (leniency, drop, compile+runtime enum alignment, the completeness guard, UDF masking against real fixture data, sanitizer shape/idempotency); the completeness guard includes a non-vacuity sanity check so a broken import can't silently pass. |

---

## 10. Iterative Improvements Made

1. Discovered a literal `*/` inside `sanitize-fixtures.mjs`'s own JSDoc prose ("secret
   *detector*/scanner") that prematurely closed the block comment and broke Vitest's source
   parser for every test importing from it; reworded to drop the asterisk-emphasis rather than
   escape it, preserving the sentence's meaning.
2. Ran `npx prettier --write` over every new file after the first green test/typecheck/lint pass
   (two test files needed line-wrap reformatting); re-ran `lint`/`typecheck`/`test` afterward to
   confirm no behavioral change.
3. Added the `enumFieldsChecked > 0` non-vacuity sanity check to the `WIDENED_FIELDS` completeness
   guard test after noticing a broken `OVERRIDE_ENTITIES`/`enumFieldPaths` import would otherwise
   let the guard's `for` loop silently iterate zero times and report a false pass.
4. Added the inline novel-`priority` Alert runtime check (not sourced from a committed fixture)
   alongside the `rmmnetworkdevice` fixture's runtime check, so the "build-time and runtime cover
   the same field set" proof has a concrete runtime example for **both** override-touched
   entities, not just `Device`.

---

## 11. Remaining Risks or Follow-Ups

- **Deferred Validation is still deferred, by design.** This phase's corpus is synthesized (per
  the plan's own Assumptions: "real captured sweep data is not available to an Implementor
  agent"); validating the reconciled schemas against a genuine live sweep remains the plan's
  Deferred Validation item and needs a live account and human execution.
- **`sanitize-fixtures.mjs` has no automated test proving it against a genuine multi-entity sweep
  shape** (only hand-built inline samples) — acceptable per the plan (no live data available to
  this agent), but worth a maintainer smoke-test the first time it is actually run against a real
  export.
- **README/runbook documentation of the sanitizer's "run before committing" step is Phase 10's
  responsibility**, not added here (this phase's plan section explicitly marks Documentation "None
  yet").

---

## 12. Commands Run / To Run

- `npm run lint` — 0 errors, 0 warnings.
- `npm run typecheck` (`typecheck:src` + `typecheck:test` + `typecheck:tools`) — clean.
- `npm test` — 445 tests passing across 36 files (up from 417/34 in Phase 8; +28 new tests: 21 in
  `fixtures.test.ts`, 7 in `sanitize-fixtures.test.ts`).
- `npx vitest run --coverage` — 96.31% statements / 90.8% branches / 98.17% functions overall (up
  from Phase 8's 95.88%/90.51%/98.17% — this phase's tests exercise several previously-uncovered
  `schema-leniency.ts` branches via `enumFieldPaths`/real fixture data).
- `npm run build` — `tsup` succeeds, unaffected by this phase (no `src/` change).
- `npx prettier --check` — clean after one `--write` pass over the new files.
- `git status` — only new, untracked files after this phase; no tracked file modified.

---

## 13. Final Assertion

I assert that:
- Only Phase 9 has been implemented: the fixture corpus, the sanitization script, and the
  fixture-validation test suite (including the `WIDENED_FIELDS` completeness guard) — no source
  file under `src/` was touched.
- No unnecessary scope expansion occurred: README/runbook documentation (Phase 10) and live/real
  sweep validation (Deferred Validation) are untouched and out of scope.
- All quality scores are ≥ 9.5.
