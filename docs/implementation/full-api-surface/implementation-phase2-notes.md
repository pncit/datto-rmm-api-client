# Implementation Notes — Phase 2

- **Plan:** full-api-surface
- **Phase:** 2
- **Date:** 2026-07-08
- **Agent:** Implementor

---

## 1. Phase Scope Confirmation

**In-Scope (Phase 2 only):**
- Fetch and commit Datto's OpenAPI spec (`spec/openapi.json`, `spec/openapi-prev.json`).
- `scripts/patch-spec.mjs` — deterministic, fail-loud structural corrections (timestamps,
  `alertContext`) ahead of Orval.
- `scripts/dedupe-generated-index.mjs` — ported near-verbatim from `fuze-api`.
- `scripts/widen-response-enums.mjs` — the response-enum-widening codemod (R5's compile-time
  half) with its shared-schema transitive guard.
- Run `npm run generate` for the first time and commit `src/generated/**`.
- Verify `npm run generate` reproducibility (R15) and that generated types + zod schemas
  typecheck.
- Tests for all four scripts/behaviors named in the plan's Tests section.

**Explicitly Out-of-Scope:**
- Any change to the old runtime surface (`src/client.ts`, `src/config.ts`, `src/auth.ts`,
  `src/httpClient.ts`, `src/rateLimiter.ts`, `src/tokenStore.ts`, `src/validation.ts`,
  `src/schemas.ts`, `src/logger.ts`, `src/result.ts`, `src/internal/`) — untouched, still
  compiling, per the coexistence rule (deleted whole in Phase 8).
- `src/schema-overrides.ts`, the error hierarchy, `BaseResource`, resource classes, the
  dual-layer rate limiter, `parseLenient`'s **runtime** enum degradation — all later phases.
- Any new `npm` dependency (none were needed).

---

## 2. Phase Intent (Interpreted)

Stand up the spec → codegen pipeline end-to-end for the first time: commit the real, defective
Datto RMM v2 spec; write the deterministic patch step that corrects the defects generation cannot
infer (timestamps, `alertContext`); write the post-generate codemod that widens **response**
enums to the open `EnumUnion | (string & {})` form while leaving **request** enums closed (R5's
compile-time half); and prove the whole `npm run generate` pipeline is byte-reproducible (R15)
from the frozen, committed spec. Because this is the *first* real invocation of the pipeline
wired (but not exercised) in Phase 1, "verify, don't just trust" applied throughout: every defect
this phase corrects, and the exact shape every generated file takes, was confirmed by actually
fetching the live spec and running Orval against it, not assumed from the plan's illustrative
code sketches.

---

## 3. Files Touched

| File | Change Type | Rationale |
|------|------------|-----------|
| `spec/openapi.json` | Created | Committed Datto RMM v2 spec, fetched live from `zinfandel-api.centrastage.net`, pretty-printed with Python's `json.dump` (2-space indent, trailing newline, exact key order preserved — see §6 for why not `JSON.stringify`) |
| `spec/openapi-prev.json` | Created | Byte-identical first-commit diffing baseline (Step 1 note: "first commit: identical") |
| `scripts/patch-spec.mjs` | Created | Deterministic, fail-loud spec patch step: timestamps, `alertContext`, the `ProxySettings` request/response split, and two general malformed-keyword fixes discovered via actual generation (§5) |
| `scripts/dedupe-generated-index.mjs` | Created | Ported near-verbatim from `fuze-api`, adapted to this repo's `src/generated/types/index.ts` path and split into a pure `dedupeExportLines` core + thin CLI wrapper for testability |
| `scripts/widen-response-enums.mjs` | Created | The response-enum-widening codemod: request/response discrimination via per-operation suffixes + a spec-derived request-only-component set + transitive import-graph expansion; the shared-schema guard (`verifyNoSharedEnumBearingSchemas`) |
| `src/generated/**` | Created (committed) | Orval output (195 files under `types/`, 9 tag-split `.zod.ts` files under `schemas/`) after patch + dedupe + widen |
| `eslint.config.js` | Modified | Added `src/generated/**` to global ignores, mirroring `fuze-api`'s own config exactly (Phase 2 necessity — see §5) |
| `tsconfig.test.json` | Modified | Added `allowJs: true` and `scripts/**/*.mjs` to `include` so tests can import the (untyped, plain-JS) generate scripts without a `noImplicitAny` failure |
| `tests/generated/reproducibility.test.ts` | Created | Shells out to `npm run generate` + `git diff --exit-code -- src/generated`; skips cleanly if `spec/openapi.json` is absent |
| `tests/generated/patch-spec.test.ts` | Created | Unit tests for `patchSpec` — timestamps, `alertContext`, the request/response split, fail-loud drift, and the two malformed-keyword fixes |
| `tests/generated/dedupe-index.test.ts` | Created | Unit tests for `dedupeExportLines` — dedup, preservation, idempotency |
| `tests/generated/widen-enums.test.ts` | Created | Unit tests for `widenGeneratedTypes`, `computeRequestOnlyComponentNames`, and `verifyNoSharedEnumBearingSchemas` (including the three shared-schema-guard cases the plan names) |

---

## 4. Implementation Summary

**Spec fetch (Step 1).** `GET https://zinfandel-api.centrastage.net/api/v3/api-docs/Datto-RMM`
returned OpenAPI 3.1.0, 53 paths, 113 component schemas — matching the design's stated shape
exactly. The raw response is minified JSON whose `responses` objects use non-ascending numeric
string keys (e.g. `{"500":…,"409":…,"400":…,"401":…}`). Serializing with plain
`JSON.stringify`/Node would silently **reorder** those keys (V8 hoists integer-index-like string
keys to the front in ascending order), which would violate the plan's explicit "key order
preserved as fetched — no re-sorting" instruction and undermine the "committed once and frozen"
reproducibility premise (R15) before a single byte is committed. Python's `json.dump` (dicts
preserve exact insertion order regardless of key shape) was used for the one-time pretty-print
instead, and the result was verified: the first `responses` object's key order (`500, 409, 400,
401`) matches the raw fetch exactly. `spec/openapi-prev.json` is a byte-identical copy per the
plan's "first commit: identical" instruction.

**`scripts/patch-spec.mjs` (Step 2).** Implements the plan's two named corrections
(`TIMESTAMP_FIELDS`, `alertContext`) with the specified fail-loud behavior (collects every
missing anchor, throws once with all of them named). Confirmed against the real spec:
`Device.lastSeen/lastReboot/lastAuditDate/creationDate`, `AuthUser.created/lastAccess`, and
`Alert.timestamp/resolvedOn` are all `{type: string, format: date-time}` pre-patch;
`Alert.alertContext` is a 26-branch `oneOf` of dead `*Context` schemas pre-patch. Both patch
exactly as the plan describes. Three additional corrections were required to make this phase's
own gate (`npm run generate` + `npm run typecheck` green) pass — see §5 for why each is a
necessity, not scope creep — documented in full in the module's own JSDoc: the `ProxySettings`
request/response split, and two general malformed-JSON-Schema-keyword sweeps.

**`scripts/dedupe-generated-index.mjs` (Step 3).** Ported per the plan's explicit instruction
("copy `fuze-api`'s script near-verbatim"). Only `GENERATED_INDEX_PATH` changed
(`src/generated/types/index.ts`, matching this repo). Split into a pure `dedupeExportLines(content)`
core (returns `{content, duplicatesRemoved}`) plus a thin CLI wrapper, so the dedup logic is
directly unit-testable without touching the filesystem. Against the real generated index (194
export lines), it correctly reports zero duplicates (this spec's Orval output happens not to
produce any) — proven a no-op is the right outcome by the fixture-based unit tests instead.

**`scripts/widen-response-enums.mjs` (Step 4).** This is where the plan's own illustrative code
sketch (an inline literal union `deviceClass: 'device' | 'printer' | … ;`) diverges from Orval's
*actual* generated shape for the axios/types target, discovered by generating against the real
patched spec before writing the codemod (see §5, "verify the load-bearing assumption" applied to
the codemod's own foundation, not just its guard). Orval (`mode: 'tags-split'`) hoists **every**
enum-typed property, at every nesting depth, into its own file/type
(`Device.deviceClass` → `DeviceDeviceClass`; `GET /v2/activity-logs`'s `order` query param →
`GetActivitiesOrder`), and the hoisted name does not reliably carry a request-side suffix at the
end (a query param's hoisted enum drops the `Params` suffix entirely; Datto's write bodies are
all named `$ref`s with no suffix at all — `Udf`, `Warranty`, `ProxySettings`). The codemod
therefore discriminates response vs. request by two complementary root-identification mechanisms
— (a) the plan's literal per-operation suffix list (`Body|Params|Parameter|Parameters|Query|
QueryParams|Header|Headers|PathParameters`, kept exactly as specified, for query/path/header
types) and (b) a spec-derived set of named component schemas reachable from a `requestBody` and
from no response (`computeRequestOnlyComponentNames`) — and then expands both root sets
**transitively** by following each root file's own `import type {...} from './x'` lines, which
correctly reaches a hoisted grandchild (`ProxySettingsRequestType`, `GetActivitiesOrder`)
regardless of Orval's per-field naming quirks. This is documented at length in the module's own
JSDoc (deviations §5 summarizes it). Verified against the real generated output: 25 files were
widened (every genuine response enum, including deeply nested ones like the 14 `*Context`-derived
fields and `filterType.ts`), and all 8 named request-only components (`CreateSiteRequest`,
`ProxySettingsRequest`, `VariableCreationRequest`, `CreateQuickJobRequest`, `JobComponentRequest`,
`SiteRequest`, `VariableUpdateRequest`, `Warranty`) plus every per-operation `*Params` type and
their hoisted children stayed closed.

**Shared-schema guard (`verifyNoSharedEnumBearingSchemas`).** Implemented exactly per the plan's
detailed spec: a transitive `$ref` walk (through `properties`/`items`/`allOf`/`oneOf`/`anyOf`/
`additionalProperties`, cycle-safe) collects the full component-schema set reachable from every
operation's `requestBody` and from every response; the intersection, filtered to components that
declare an `enum` (directly or nested), throws a fail-loud error naming the offending component
and the exact reaching operations. This is not a hypothetical exercise: running the guard against
the real spec found a genuine instance — `ProxySettings.type` (`http|socks4|socks5`) is reached by
`POST /v2/site/{siteUid}/settings/proxy`'s requestBody directly and, nested one level, by
`PUT /v2/site`'s `CreateSiteRequest.properties.proxySettings`, and by three response operations
(`GET /v2/site/{siteUid}`, `GET /v2/site/{siteUid}/settings`, `GET /v2/account/sites`). Resolved in
`patch-spec.mjs` by cloning `ProxySettings` into `ProxySettingsRequest` and retargeting both
request-side ref locations, matching the spec's own established `*Request` naming convention
(`CreateSiteRequest`, `SiteRequest`, `CreateQuickJobRequest`, `VariableCreationRequest`,
`VariableUpdateRequest`) rather than inventing a new one. The two other shared components found by
the same scan (`Udf`, `JobComponentVariable`) carry no `enum` and were correctly left untouched
(widening is a no-op on an enum-free schema).

**Generation and commit (Step 5).** `npm run generate` produces `src/generated/types/**` (195
files, flat — Orval's schemas output is not tag-split even though the axios/endpoints target is)
and `src/generated/schemas/<tag>/<tag>.zod.ts` (9 files, one per spec tag). Both are committed.
`.gitignore`'s Phase-1-authored note already correctly described this end state ("finalized in
Phase 2") and needed no further edit.

**Reproducibility (Step 6).** Verified directly and repeatedly during implementation: `rm -rf
src/generated && npm run generate` followed by `git diff --exit-code -- src/generated` is clean
every time, including after the mid-implementation patch-spec fixes (§5). `tests/generated/
reproducibility.test.ts` automates this exact check as the R15 regression guard.

---

## 5. Deviations From Plan (If Any)

1. **Added the `ProxySettings` → `ProxySettingsRequest` request/response split to
   `patch-spec.mjs`, beyond the plan's two named corrections.** *Why:* the plan explicitly
   instructs the widen-enums codemod to include a transitive shared-schema guard and to fail the
   build if it ever fires — precisely so a real conflict "forces an explicit fix" rather than
   being silently mis-widened either direction. Running that guard against the real spec (not a
   hypothetical) found exactly one real conflict, detailed in §4. Per the guard's own error
   message ("split the shared schema or add a request-side suffix") and Decision 2's established
   pattern (spec defects are corrected in the patch step, never by hand-editing `spec/openapi.json`
   or working around them in the codemod), the fix belongs in `patch-spec.mjs`, using the
   spec's own existing `*Request` naming convention. Without this, `npm run generate` fails at the
   widen step — this phase's own exit gate cannot pass without it. Full reasoning, including why
   the two other shared components (`Udf`, `JobComponentVariable`) were correctly left alone, is
   in `patch-spec.mjs`'s `REQUEST_RESPONSE_SPLITS` JSDoc.
2. **Added two general, spec-wide malformed-keyword fixes to `patch-spec.mjs`
   (`fixMalformedNonStringConstraints`): stripping an invalid `pattern` from a non-`string`
   schema, and stripping a redundant top-level `enum` from an `array`-typed schema that already
   carries the real enum on `items`.** *Why:* neither is named in the plan's Step 2, but both are
   real, pre-existing defects in the committed `spec/openapi.json`
   (`ActivityLog.date` has `{type: number, pattern: "seconds.nanoseconds"}`; the `entities` query
   parameter of `GET /v2/activity-logs` has `{type: array, enum: [...], items: {enum: [...]}}`),
   discovered only by actually running `npm run generate` + `npm run typecheck` and reading the
   resulting compile errors (`Property 'regex' does not exist on type 'ZodNumber'`; `Property
   'enum' does not exist on type 'ZodArray<...>'`) — Orval's zod generator translates both
   malformed keyword combinations into TypeScript that does not compile. This phase's exit gate
   requires `npm run typecheck` to pass against the generated output; per the Guardrails for
   Out-of-Scope Work ("fix build/test failures caused by the current work"), this is a Phase 2
   necessity, not scope drift — the "current work" is the first real invocation of the generate
   pipeline, which is exactly what surfaces defects no design document could enumerate in advance.
   Implemented as a general sweep (not a fixed anchor list) since the defect is the malformed
   keyword combination itself, wherever it occurs, and does not fail loud on a zero count (a future
   spec without the defect is a fix, not drift) — this is a deliberate contrast with the
   fail-loud, fixed-anchor treatment of the plan's own two named corrections.
3. **Added `src/generated/**` to `eslint.config.js`'s global ignores** (previously only `dist/**`,
   `node_modules/**`, `coverage/**`, `*.config.js`). *Why:* `npm run lint` failed with 40+
   `no-redeclare` errors the moment `src/generated/**` existed — ESLint's core `no-redeclare` rule
   (enabled via `js.configs.recommended`) does not understand TypeScript's `export type X` +
   `export const X` declaration-merging idiom that Orval emits for every enum, and the installed
   `@typescript-eslint/eslint-plugin@8.62.1`'s `recommended` config does not disable the base rule
   or enable `@typescript-eslint/no-redeclare` (verified directly — neither key exists in its
   `recommended.rules`). `fuze-api`'s own `eslint.config.js` — the reference architecture this
   plan explicitly converges on — resolves this by ignoring `src/generated/**` outright, on the
   principle that generated code is never hand-fixed and therefore never linted. Adopting the
   identical convention (rather than inventing a different one, e.g. per-rule overrides) is a
   direct, precedented port, and squarely a Phase 2 necessity (fix build breakage this phase's own
   work caused, per the Guardrails).
4. **Added `allowJs: true` and `scripts/**/*.mjs` to `tsconfig.test.json`.** *Why:* the plan's own
   Tests section requires unit-testing the three plain-JS generate scripts directly (import their
   exported functions), but `strict`/`noImplicitAny` (inherited from `tsconfig.json`) rejects an
   import of a `.mjs` module with no declaration file as an implicit-`any` **error**, not a
   warning — `npm run typecheck` failed outright without this. `allowJs: true` lets `tsc` read the
   scripts' actual JS structure for inferred types instead. This only affects
   `tsconfig.test.json` (the test-only project); `tsconfig.json`/`tsconfig.tools.json` are
   untouched, so production `src/` typechecking is unaffected.

No other deviations. Every other step, file, and behavior matches the plan's Step 1–6 as written.

---

## 6. Ambiguities & Decisions

- **Spec serialization tool.** The plan specifies the target format (2-space indent, trailing
  newline, preserved key order) but not the tool. Chose Python's `json` module over Node's
  `JSON.stringify` specifically because the real spec's `responses` objects use non-ascending
  numeric-string keys, which V8 would silently reorder (see §4) — a JS-based serializer would
  have violated "no re-sorting" invisibly. This choice only affects the one-time commit; nothing
  about the ongoing pipeline depends on Python being present.
- **Discrimination mechanism for the widen codemod.** The plan's own suffix list
  (`Body|Params|…`) is necessary but, on the real generated output, not sufficient — see §4 and
  the module's JSDoc for the full reasoning. Added the spec-derived request-only-component set and
  transitive import-graph expansion as complementary mechanisms rather than replacing the plan's
  suffix list, since the suffix list is still exactly right for genuine per-operation
  parameter/anonymous-body types (which Datto's spec does have, for query parameters).
- **`REQUEST_RESPONSE_SPLITS` and malformed-keyword fixes as general mechanisms vs. one-off
  patches.** Chose data-driven, documented tables/sweeps (matching `TIMESTAMP_FIELDS`'s own
  pattern) over inline one-off edits, so a future spec refresh that shifts the defect is either
  caught (fail-loud, for the anchor-based split) or self-resolves cleanly (silent no-op, for the
  general malformed-keyword sweep) — consistent with the plan's own stated risk mitigation ("spec
  refresh reintroduces or shifts a defect... patch step is data-driven and documented").
- **`fuze-api`'s tag-derived subdirectory naming (`-v2-account`, `-v2-device`, …) under
  `src/generated/schemas/`.** Not corrected. Datto's spec tags are literally path prefixes
  (`/v2/account`) rather than short names; Orval sanitizes the leading slash into a leading
  hyphen. This is cosmetic (directory naming only) and not one of the design's identified defects
  (nullability, timestamps, UDFs, alertContext) or anything Phase 2's steps call out; the plan
  itself notes resources will hand-write their own paths as the single source of truth (Phase 8),
  so this has no behavioral consequence. Left untouched to avoid unrequested scope expansion.

---

## 7. Tests

- `tests/generated/reproducibility.test.ts` (1 test): shells out to `npm run generate`, asserts
  `git diff --exit-code -- src/generated` is clean; skips cleanly (not fails) if
  `spec/openapi.json` is absent.
- `tests/generated/patch-spec.test.ts` (9 tests): timestamp retyping across all three schemas;
  `alertContext` replacement; the `ProxySettings` split (clone + both ref locations retargeted +
  original left untouched); fail-loud on a missing timestamp anchor; fail-loud on missing
  `alertContext`; fail-loud on a split ref location no longer pointing at the expected shared
  schema; the invalid-`pattern`-on-non-string fix; the redundant-array-`enum` fix; determinism
  across two independent fragments.
- `tests/generated/dedupe-index.test.ts` (4 tests): removes a `.js`/no-extension duplicate pair;
  preserves non-export lines; is idempotent on a second pass; reports zero when there are no
  duplicates.
- `tests/generated/widen-enums.test.ts` (8 tests): widens a component-schema (response) enum
  while leaving a `*Body`-rooted and a `*Params`-rooted hoisted enum closed, and confirms a second
  pass is a no-op; excludes a named request-only component (`Warranty`) and its hoisted child via
  the spec-derived set specifically (proving the suffix list alone is insufficient, per §4/§6);
  `computeRequestOnlyComponentNames` — includes a request-only component, excludes a
  request-and-response-shared component, and PascalCases a spec name containing spaces; the
  shared-schema guard's three required cases — direct-ref sharing throws (naming the schema and
  both operations), transitive/nested sharing throws, and a benign enum-free shared component does
  not throw.
- Total: **22 new tests**, all passing; the pre-existing **37** Phase-1 tests remain green
  (unchanged) — **59 tests / 8 files** overall.

---

## 8. Security & Best-Practices Review

- No secrets in the committed spec (it is the public API *specification*, not data; verified no
  credential-shaped strings appear in `spec/openapi.json` beyond the documented OAuth token
  endpoint path itself).
- No new runtime dependencies; all three new scripts use only `node:fs`, `node:path`, `node:url`
  (already-available Node builtins) and `structuredClone` (native since Node 17, well within the
  Node ≥ 20 floor).
- No `eval`/dynamic code execution anywhere in the new scripts; all transforms are structural
  JSON/string manipulation.
- The widen codemod's regex-based TS parsing is narrowly scoped (import lines, enum-shaped type
  aliases) and only ever operates on Orval's own generated output, never on hand-written or
  user-supplied source — a malformed match degrades to "no widening applied" for that file, never
  to code execution or injection.
- `eslint.config.js`'s new `src/generated/**` ignore is scoped precisely to that directory; it
  does not weaken linting for any hand-written source.

---

## 9. Self-Review Scoring

| Element | Before | After | Comments |
|---------|--------|-------|----------|
| Extensibility | 9.0 | 9.5 | `REQUEST_RESPONSE_SPLITS` and `TIMESTAMP_FIELDS` are both data-driven tables — a future spec defect of the same shape is a one-entry addition, not a code change. The widen codemod's two-mechanism root-identification design (suffix list + spec-derived set) extends cleanly to a future anonymous request body without touching the transitive-expansion logic. |
| Understandability | 9.0 | 9.5 | Every deviation is documented at its point of use (module JSDoc) as well as in these notes, with concrete evidence (the exact schema names, operations, and compiler errors that necessitated each one) rather than assertions. |
| Best Practices | 9.0 | 9.5 | Pure-function/thin-CLI-wrapper split in all three scripts makes every core transform directly unit-testable without filesystem fixtures; the shared-schema guard and request-only-component computation share one `buildReachabilityMaps` traversal rather than duplicating the `$ref`-walk logic. |
| Plan Adherence | 9.0 | 9.5 | All six steps implemented; the plan's two named patch corrections and its exact widen-codemod suffix list are preserved verbatim. Deviations are all in the "necessary to make this phase's own gate pass" category (Guardrails), each with concrete before/after evidence, not stylistic preference. |
| Test Quality | 9.0 | 9.5 | All three of the plan's named shared-schema-guard cases (direct, transitive, benign) are covered explicitly; the *Body/*Params widen-exclusion test and the request-only-component-set test were added specifically because they exercise the mechanism the real generated output actually needs (not just the plan's inline-union sketch). |

---

## 10. Iterative Improvements Made

1. Discovered (by actually generating against the real patched spec before finalizing the
   codemod) that Orval hoists every enum property into its own file with a compound name, and
   redesigned the discrimination mechanism from a pure suffix check into suffix-list ∪
   spec-derived-request-only-set, transitively expanded via each file's own imports — rather than
   implementing the plan's inline-union sketch literally, which would not have matched reality at
   all.
2. Found and fixed the real `ProxySettings` shared-enum hazard via the plan's own guard, rather
   than discovering it only when a future spec refresh triggered the build failure the guard is
   designed to produce.
3. Found and fixed two additional real spec defects (invalid `pattern` on a non-string field;
   redundant array-level `enum`) via actual `npm run typecheck` failures against the generated
   zod output, rather than assuming the design's four named defect categories were exhaustive.
4. Found and fixed the `eslint.config.js` `no-redeclare` gap by directly comparing against
   `fuze-api`'s own config once `npm run lint` failed against the committed generated output,
   adopting the identical, already-precedented fix rather than inventing a new one.
5. Reformatted all new files with the project's `prettier --write` after confirming (by testing
   the pre-existing `prettierrc` filename against `prettier --check`) that the repo's actual,
   observable code style — as evidenced by existing hand-written files like `src/client.ts` — is
   prettier's own defaults (double-quoted strings), not the singleQuote style the misnamed config
   file specifies; this pre-existing filename issue is unrelated to Phase 2's work and was left
   untouched.

---

## 11. Remaining Risks or Follow-Ups

- `spec/openapi.json` was fetched from the `zinfandel` region during this phase (the design notes
  the spec is region-invariant aside from `servers[].url`); the plan's Deferred Validation item
  ("Live spec refresh & diff") is unchanged and still requires live egress not guaranteed in every
  future environment.
- The `ProxySettings`/`ProxySettingsRequest` split and the two general malformed-keyword fixes are
  new, non-plan-literal corrections; Step-A/Step-B reviewers should specifically confirm the
  reasoning in `patch-spec.mjs`'s JSDoc and §5 above holds up, since they are the most consequential
  deviations in this phase.
- `src/generated/schemas/` tag-subdirectory names (`-v2-account`, etc.) are cosmetically ugly
  (leading hyphen from Orval sanitizing a leading slash) but functionally inert; flagged in §6 as
  a conscious non-fix.
- The zod schemas generated in this phase are still **strict** end-to-end (no leniency layered on
  yet) — this is intentional; Phase 4 (`schema-leniency.ts`) is where response-side leniency and
  runtime enum degradation are added. Phase 2 only delivers the generated schema layer plus the
  compile-time half of R5.

---

## 12. Commands Run / To Run

- `npm run generate` — patch → orval → dedupe → widen; run repeatedly during implementation
  (including a `rm -rf src/generated` full rebuild) to confirm reproducibility at every stage.
- `git diff --exit-code -- src/generated` — confirmed clean after every regeneration.
- `npm run typecheck` — passes (`typecheck:src`, `typecheck:test`, `typecheck:tools` all green).
- `npm run lint` — passes, 0 errors (11 pre-existing `no-explicit-any` warnings in untouched old
  files, unchanged from Phase 1).
- `npm test` — `vitest run`: 8 files, 59 tests, all passing.
- `npm run build` — `tsup`: ESM `dist/index.js` + `dist/index.d.ts` emitted successfully.
- `git ls-files --error-unmatch spec/openapi.json spec/openapi-prev.json` — both tracked.
- `git ls-files --error-unmatch spec/openapi.patched.json` — fails as expected (untracked).
- `grep -qE 'openapi\.patched\.json' .gitignore` — passes.
- `test -n "$(ls -A src/generated)"` — passes (non-empty).
- `ls src/generated/schemas/*/*.zod.ts` / `test -d src/generated/types` — both pass.

---

## 13. Final Assertion

I assert that:
- Only Phase 2 has been implemented.
- No unnecessary scope expansion occurred (all deviations are documented, evidence-backed
  necessities to make this phase's own exit gate pass, per the Guardrails for Out-of-Scope Work).
- All quality scores are ≥ 9.5.
