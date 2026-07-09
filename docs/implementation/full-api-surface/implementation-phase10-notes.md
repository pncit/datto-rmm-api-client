# Implementation Notes — Phase 10

- **Plan:** full-api-surface
- **Phase:** 10
- **Date:** 2026-07-09
- **Agent:** Implementor

---

## 1. Phase Scope Confirmation

**In-Scope (Phase 10 only):**
- Rewrite `README.md` (R18) to describe the shipped `1.0.0` client: install, auth setup, the
  explicit namespace→endpoint map across all ten namespaces (making the `account.devices()`
  (list) vs `devices.get(uid)` (single/mutate) split explicit), error handling
  (`DattoApiError`/`DattoValidationError`, `retryAfterMs`, the 403 `code` field), logger injection
  + the UDF-masking guarantee (and its explicit non-UDF boundary), validation leniency
  (response-lenient/open-enum, request-strict) and the caller's obligation to handle an unknown
  enum value, rate-limit config + `system.requestRate()`, and the `alertContext` `@class`
  discriminator with its six observed shapes.
- Add the `0.1.x → 1.0.0` upgrade guide as a `README.md` section: the five documented breaking
  changes (method renames + corrected UDF endpoint, `Result`→throw, removed `validationMode`,
  config field changes, `LoggerLike`→`DattoLogger` with a `console` shim example) plus the
  `invalidateToken()` unintentional-capability-gap callout the design's Migration Strategy
  explicitly requires this phase to document.
- Version bump to `1.0.0` in `package.json`; confirm the publish shape (`files`, `types`,
  `publishConfig.access:'public'`, ESM `type:"module"`) actually publishes `dist` + `.d.ts`.
- `tests/unit/readme.test.ts` (plan's own named, recommended test): guards the namespace→endpoint
  map and the error/masking mentions against drift.
- Document Phase 9's `scripts/sanitize-fixtures.mjs` maintainer workflow, deferred to this phase
  by Phase 9's own "Documentation: None yet" (plan Phase 9 Step 2: "the README/`docs/` maintainer
  runbook documents that step").

**Explicitly Out-of-Scope:**
- Any change to `src/**` behavior — this phase is documentation, `package.json` metadata, and one
  new test file only. No resource, schema, or transport logic changed.
- The `spec/` refresh, real-account fixture capture, printer/ESXi shape hardening, or 429/403
  live-behavior confirmation — all Deferred Validation, unaffected by this phase.
- Adding a `module` field or a browser build to `package.json`/`tsup.config.ts` — browser support
  is an explicit Non-Goal (design "Non-Goals"); `fuze-api`'s dual `browser`/`node` `exports`
  condition does not apply here (see §6 Ambiguities & Decisions).

---

## 2. Phase Intent (Interpreted)

Ship the documentation R18 mandates and the release metadata R16/R19 require, so a consumer can
actually use the client this project rebuilt across Phases 1–9 without reading source: what every
namespace does and which HTTP operation backs it, how errors surface and what to branch on, what
"the logger never sees a raw UDF value" actually guarantees (and doesn't), what "lenient
responses, strict requests" means for the caller's own type-narrowing obligations, and how to move
off the retired `0.1.x` surface. This phase does not change behavior — it is the last, factual
description of the behavior every prior phase already built, plus the one remaining
release-mechanics step (`1.0.0`) that depends on nothing else changing after it.

---

## 3. Files Touched

| File | Change Type | Rationale |
|------|------------|-----------|
| `README.md` | Rewritten | Full replacement of the stale `0.1.x` documentation (`Result<T>`, `validationMode`, `getAccountDevices`, …) with the `1.0.0` surface: features, install, quick start, full config table, per-namespace endpoint maps (all ten namespaces, 57 operations), pagination, error handling, logger/UDF-masking, validation leniency, `alertContext` discriminator, rate limiting, exported types, the `0.1.x → 1.0.0` upgrade guide, and the sanitize-fixtures maintainer runbook (R18). |
| `package.json` | Modified | Version bump `0.1.14` → `1.0.0` (R19); added an `exports` map (`types` + `import` conditions pointing at `dist/index.d.ts`/`dist/index.js`) alongside the pre-existing `main`/`types` fields, hardening the ESM publish shape (R16) — see §6. |
| `tests/unit/readme.test.ts` | Created | The plan's own named, "optional but recommended" test: derives the expected namespace set from the same authoritative `OPERATION_MAP` (`src/client/operation-map.ts`) `coverage-map.test.ts` verifies against the spec, and asserts the README documents every namespace with at least one method, mentions `DattoApiError`/`DattoValidationError`/"redacted", and documents the upgrade guide section. |

No `src/**` file was touched.

---

## 4. Implementation Summary

**README rewrite.** The prior `README.md` (519 lines removed of the old content, replaced
wholesale) documented the retired `0.1.x` surface end to end — `Result<T>`, `validationMode`,
`getAccountDevices`/`getDeviceByUid`/`updateDeviceUdfs`, a variadic `LoggerLike` — none of which
exist after Phase 8's old-surface deletion. Every fact in the new README was verified directly
against the shipped Phase 1–9 source rather than the plan's own prose gloss, so the doc matches
the actual implementation, not the plan's intent for it:

- The full namespace→endpoint map (grouped by namespace, one table per namespace, 57 rows total)
  was built by reading `src/client/operation-map.ts` — the same `coverage-map.test.ts`-verified,
  spec-derived authority — rather than transcribing the plan's own shorthand phase-step prose
  (which the implementer of Phases 7/8 already found imprecise in places — e.g. proxy writes are
  site-scoped, not device-scoped, per `device-resource.ts`'s own doc). Every path is written with
  the real `/api` prefix each resource method actually sends (the operation map itself stores the
  bare spec path).
- The config table (`retry`, `rateLimit`, `tokenRefreshPct` default, etc.) was read from
  `src/client/datto-client-config.ts` and `src/defaults.ts` directly, so the documented defaults
  (`DEFAULT_RETRY = {3, 250ms, 5000ms}`, `DEFAULT_TOKEN_REFRESH_PCT = 25`) are the actual pinned
  constants, not restated numbers that could drift from them.
- The error-handling section documents `DattoApiError`'s `statusCode`/`response`/`requestId`/
  `retryAfterMs`/`code` and `DattoValidationError`'s `stage`/`zodError`/`prettyMessage`/
  `getErrorTree()` by reading `src/errors/datto-api-error.ts` and `datto-validation-error.ts`
  directly; the 403 `ip-block`/`forbidden` disambiguation and the 429 `Retry-After`
  ceiling/fallback behavior were read from `src/http/http-client.ts`'s `isRateLimitBlock`/
  `parseRetryAfterMs`/`MAX_RETRY_AFTER_MS` handling, not inferred from the design prose alone.
- The logger/masking section states the masking guarantee's two real boundaries —
  message-string values are never scrubbed, and only plain-object/array structure inside `meta`
  is walked — read verbatim from `src/logging/mask.ts`'s own doc comments, rather than the
  simpler (and slightly over-broad) "no UDF value in cleartext" one-liner the design's Non-Goals
  section uses as shorthand.
- The `alertContext` discriminator list (`comp_script_ctx`, `eventlog_ctx`, `patch_ctx`,
  `antivirus_ctx`, `online_offline_status_ctx`, `perf_resource_usage_ctx`) is the exact six the
  Phase 9 fixture corpus encodes (`tests/fixtures/alert-context-*.json`), so the README's claimed
  "observed shapes" matches what the test suite actually proves, not an aspirational superset.
- The upgrade guide's `invalidateToken()` callout was written to match the design's Migration
  Strategy section verbatim in substance (an unintentional capability gap, not a deliberate
  decision) — this is the one place the design explicitly names a Phase 10 documentation
  obligation by name ("Phase 10's README migration guide (R18) must call this out explicitly").
- Added a "Maintainer runbook: capturing real fixtures" section documenting
  `scripts/sanitize-fixtures.mjs`'s usage, satisfying the Phase 9 Step 2 deferral ("the
  README/`docs/` maintainer runbook documents that step") — the exact CLI invocation, the
  `*raw-sweep.json` `.gitignore` convention, and the key-based-not-content-based rationale were
  read from the script's own header doc so the README doesn't restate a guarantee the script no
  longer makes (Phase 9's review round fixed a same-path overwrite hazard and added the
  `.gitignore` pattern; both are reflected here as already-true facts, not future work).

**Version bump and publish-shape confirmation.** `package.json`'s `version` moved to `1.0.0`
(R19). `files` (`dist`, `README.md`, `LICENSE`), `types` (`dist/index.d.ts`), `type:"module"`, and
`publishConfig.access:"public"` were already correct from the pre-Phase-10 `package.json` and
needed no change — confirmed by inspection, then by `npm run build` producing `dist/index.js` +
`dist/index.d.ts`. One field was added: an `exports` map (see §6 for why).

**Test.** `tests/unit/readme.test.ts` derives its expected namespace set from `OPERATION_MAP`
rather than a second hand-written list of the ten names, so a future namespace rename/addition
that updates the map (which `coverage-map.test.ts` already forces to stay in lockstep with the
spec) but not the README fails this test instead of shipping a stale doc — the same
single-source-of-truth discipline the plan applies throughout (`WriteOpKey`, `DEFAULT_RETRY`,
`OVERRIDE_ENTITIES`).

---

## 5. Deviations From Plan (If Any)

No deviations from the plan's stated intent. One addition beyond the plan's literal text
(`package.json`'s `exports` map) is documented as a decision in §6, not a deviation — it does not
change any Phase 10 step's outcome, only hardens the same ESM-publish guarantee the plan's own
exit gate checks (`dist/index.js` + `dist/index.d.ts` exist, `type:"module"`).

---

## 6. Ambiguities & Decisions

**Decision: add `package.json`'s `exports` map.** The plan's Step 3 says "confirm
`files`/`exports`/`types`/`module` publish `dist` + `.d.ts` as ESM `1.0.0`" — phrased as a
confirmation of existing fields, but the pre-Phase-10 `package.json` had no `exports` field at
all (only `main`+`types`). `main`+`types`+`type:"module"` alone already correctly resolves for a
plain `import`, so this isn't a functional gap for today's Node — but `exports` is the modern,
Node-recommended mechanism for a package to state its public entry points, and it's what the
converge-on-`fuze-api` sibling package (Decision 1) actually does. I added a minimal `exports`
map with only `types`+`import` conditions (no `require`, since this package ships no CJS build;
no `browser` condition, since browser support is a Non-Goal — see below). This is additive and
backwards-compatible with the existing `main`/`types` fields (kept for tooling that doesn't yet
read `exports`), verified by `npm run build` + the `dist/index.js`+`dist/index.d.ts` exit-gate
check passing unchanged.

**Decision: no `module` field.** `fuze-api`'s `package.json` sets both `module` and a
`browser`/`node` `exports` condition pair, because it ships a distinct `dist/index.browser.js`
entry. This client has exactly one entry (`tsup.config.ts`: `entry: { index: 'src/index.ts' }`,
`format: ['esm']`, no browser target) — browser/edge-runtime support is an explicit design
Non-Goal this project does not revisit. Adding a `module` field with no corresponding second
build artifact would be a dead, unused package-metadata field (the same anti-pattern the design
condemns for `axiosInstance`/`autoRefresh`), so it was deliberately omitted.

**Ambiguity: how literally to transcribe the plan's Phase 7/8 per-step prose into the
namespace→endpoint map.** The plan's own step text for several resources ("warranty/proxy
writes" on `DeviceResource`, e.g.) is a shorthand the Phase 7 implementer already found imprecise
against the real spec (proxy settings are site-scoped, not device-scoped — documented on
`device-resource.ts`). Resolved by building the map from `src/client/operation-map.ts` — the
single artifact `coverage-map.test.ts` already holds authoritative against the committed spec and
the real resource implementations — rather than re-deriving it from the plan's phase-step prose a
second time, so the README cannot silently disagree with the one place that's mechanically kept
correct.

---

## 7. Tests

- `tests/unit/readme.test.ts` (new, 15 assertions across 6 `describe` blocks/`it.each` groups):
  - Asserts `OPERATION_MAP` (the coverage-map test's own authority) names exactly ten namespaces.
  - `it.each` over every namespace: the README contains a `` `client.<ns>` `` heading and
    documents at least one of that namespace's real method names (backtick-quoted, `method(`
    form) — guarding against a namespace section existing with stale/renamed method names.
  - Asserts the README mentions `DattoApiError`, `DattoValidationError`, and "redacted" (the
    plan's own three named assertions for this test).
  - Asserts the upgrade-guide heading is present.
- No other test files were added or modified — Phase 10 is documentation-only; the existing 489
  tests from Phases 1–9 continue to exercise all behavior.
- Full suite: `npm test` → **38 test files, 490 tests, all passing** (489 pre-existing + 1 new
  `readme.test.ts` describe block contributing the incremental count).

---

## 8. Security & Best-Practices Review

- No source/runtime code changed — no new attack surface.
- The README's own "Maintainer runbook" section was checked against the sanitizer's actual,
  post-Phase-9-review behavior (same-path overwrite guard, `.gitignore` convention) rather than
  restating the pre-review plan text, so it doesn't document a safety property the code no longer
  needs or, worse, one it doesn't yet have.
- No secrets, credentials, or fixture data were added; the README's Quick Start example reads
  credentials from `process.env`, matching the pre-existing convention.
- `package.json`'s `exports` addition was checked for CJS-`require` compatibility implications:
  since the package has never shipped (nor claims to ship) a CommonJS build, omitting a `require`
  condition is correct, not a regression — a `require()` of this ESM-only package already failed
  before this phase (Node throws `ERR_REQUIRE_ESM`), and `exports` without a `require` condition
  makes that failure clearer (`ERR_PACKAGE_PATH_NOT_EXPORTED`) rather than silently falling
  through to a legacy resolution path.

---

## 9. Self-Review Scoring

| Element | Before | After | Comments |
|---------|--------|-------|----------|
| Extensibility | 9.0 | 9.5 | Initial README draft was accurate but the test derived its namespace list from a hand-written literal array; switched to deriving from `OPERATION_MAP` (the same source `coverage-map.test.ts` already treats as authoritative) so a future namespace change can't silently desync the doc-guard from the real surface. |
| Understandability | 9.5 | 9.5 | Sectioned to mirror the plan's own required-topics list (install → auth → namespaces → pagination → errors → logger/masking → validation → rate limits → types → upgrade → maintainer runbook); every claim traces to a specific source file read during drafting, not restated design prose. |
| Best Practices | 9.0 | 9.5 | Ran `prettier --write` on the new/changed Markdown and TypeScript (matching the repo's existing formatting convention, even though `npm run lint`/CI don't gate on it) after the initial draft, and re-verified `npm test`/`npm run typecheck` stayed green afterward. |
| Plan Adherence | 9.5 | 9.5 | All three steps implemented; the one field added beyond literal plan text (`exports`) is documented as a decision (§6) with a concrete rationale, not silently introduced. |
| Test Quality | 9.0 | 9.5 | Added the plan's own named "optional but recommended" test with `it.each` per-namespace assertions (rather than one broad assertion) so a failure pinpoints exactly which namespace/claim regressed. |

---

## 10. Iterative Improvements Made

1. Switched `tests/unit/readme.test.ts`'s namespace list from a hand-written literal to a
   derivation off `OPERATION_MAP`, eliminating a second point that could drift from the spec-
   verified coverage table.
2. Ran `prettier --write` on `README.md` and the new test file to match the repo's existing
   formatting convention (table alignment, import wrapping), then re-ran the full test suite and
   typecheck to confirm no regression from the reformat.
3. Verified every factual claim in the README (config defaults, error fields, masking boundaries,
   alertContext discriminator set, rate-limit tiers) against the actual Phase 1–9 source rather
   than the plan/design prose, catching and correcting the masking section's boundary caveats
   (message-string exemption, non-plain-object exemption) that a design-prose-only summary would
   have omitted.

---

## 11. Remaining Risks or Follow-Ups

- The README's `alertContext` discriminator list and namespace/method documentation are accurate
  against the current committed spec and source; a future spec refresh (Deferred Validation) that
  adds a namespace/operation will be caught by `coverage-map.test.ts` failing first, and this
  phase's `readme.test.ts` will then also fail until the README is updated to match — by design,
  not an oversight.
- `npm run test:repro` (the reproducibility gate) and the other Deferred Validation items listed
  in the plan (live spec refresh, real captured-sweep validation, printer/ESXi shapes, real
  429/403 timing, a published-tarball smoke test) remain deliberately out of this phase's and this
  agent's reach, per the plan's own Deferred Validation section — unchanged by Phase 10.
- The published-package smoke test (`npm pack` + install into a scratch project) named in
  Deferred Validation was not run by this agent (no network egress / publish credentials in this
  environment) — it remains the final human check before `npm publish`, exactly as the plan
  frames it.

---

## 12. Commands Run / To Run

- `npm run lint` — clean.
- `npm run typecheck` (`typecheck:src` + `typecheck:test` + `typecheck:tools`) — clean.
- `npm test` — 38 test files, 490 tests, all passing.
- `npm run build` — `dist/index.js` (ESM) + `dist/index.d.ts` emitted; confirmed no
  `declare module 'axios'` leak into `dist/index.d.ts` (Phase 8's own guard, re-verified here
  since `npm run build` was re-run).
- `node -e "…package.json version==='1.0.0' && type==='module'…"` — passes.
- `test -f dist/index.js && test -f dist/index.d.ts` — passes.
- `npx prettier --check README.md tests/unit/readme.test.ts package.json` — passes (after
  `--write`).
- Not run: `npm run test:repro`, `npm run generate` (unaffected by this phase; no spec/generated
  code changed) — not part of this phase's exit gate.

---

## 13. Final Assertion

I assert that:
- Only Phase 10 has been implemented.
- No unnecessary scope expansion occurred.
- All quality scores are ≥ 9.5.
