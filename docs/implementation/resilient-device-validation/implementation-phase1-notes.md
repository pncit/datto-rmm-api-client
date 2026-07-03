# Implementation Notes — Phase 1

- **Plan:** resilient-device-validation
- **Phase:** 1 — Logger-aware validation seam + per-item helper
- **Date:** 2026-07-03
- **Agent:** Implementor

---

## 1. Phase Scope Confirmation

**In-Scope (Phase 1 only):**
- Give `validate()` an optional trailing `logger: LoggerLike = defaultLogger` parameter and route its `warn` diagnostic through `logger.warn` (path-named, not the raw `ZodError.message`), leaving `strict`/`off` semantics unchanged.
- Add `VALIDATION_ERROR_TYPE`/`VALIDATION_ERROR_STATUS` shared constants in `src/validation.ts`.
- Add `validateItems<T>()`: validates each element of `unknown[]` against a `ZodType<T>`, partitions by mode (`strict`/`warn`/`off`), returns `{ valid, warnings }`, and logs per divergent item at the correct level.
- Add and export `toProblemError()` (+ best-effort `extractIdentity`) building the single shared `validation-error` `ProblemError` shape.
- Add `src/__tests__/validation.test.ts` covering both seams.
- No wiring into `client.ts` — that is Phase 2.

**Explicitly Out-of-Scope:**
- `src/client.ts`, `src/schemas.ts`, `src/result.ts`, `src/index.ts` — untouched.
- The new internal envelope schema (`src/internal/devicesEnvelope.ts`) — Phase 2.

**Post-review addendum:** the pre-existing fixture/schema drift in `device.json`/`devicesPage*.json` originally recorded below as out-of-scope (and as an unresolved risk in §11) was fixed during review (`reviser-r3`) once it became clear it made the phase's own `npm test` exit-gate command fail unconditionally with no other place in the plan to fix it without touching a protected file. See §3/§4 for what changed; §11 has been updated to reflect the fix instead of flagging it as an open risk.

---

## 2. Phase Intent (Interpreted)

Split the single validation module into the two primitives the resilient pagination path (Phase 2) needs, without touching `client.ts`: a logger-aware single-value `validate()` seam, and a new array seam `validateItems()` that never throws — it partitions an array of raw items into survivors and per-item `ProblemError` rejections, logging at the mode-appropriate level. Both seams share one `ProblemError`-building helper (`toProblemError`) and one pair of error-literal constants, so every `validation-error` site in the eventual client wiring (Phase 2) produces the same shape. This phase is fully unit-testable in isolation.

---

## 3. Files Touched

| File | Change Type | Rationale |
|------|------------|-----------|
| `src/validation.ts` | Modified | Added logger param to `validate()`; added `validateItems()`, `toProblemError()`, `extractIdentity()`, `firstIssuePath()`, and the shared `VALIDATION_ERROR_TYPE`/`VALIDATION_ERROR_STATUS` constants |
| `src/__tests__/validation.test.ts` | Created | Unit tests for both `validate()` and `validateItems()` |
| `src/__tests__/fixtures/device.json`, `devicesPage.json`, `devicesPage1.json`, `devicesPage2.json` | Modified (review round, `reviser-r3`) | Corrected pre-existing fixture/schema drift against the unmodified, protected `DeviceSchema`: filled in `udf2`–`udf30` as `null` on every device object, and converted `lastSeen`/`lastReboot`/`lastAuditDate`/`creationDate` from ISO-8601 date strings to epoch-millisecond numbers. This was necessary to make `npm test` (the phase's own exit-gate command) pass — the drift predates Phase 1 and is orthogonal to `src/validation.ts`, but there is no other place in the plan to fix it without editing a protected file (`schemas.ts`). No test assertions were changed; see §11. |

---

## 4. Implementation Summary

`validate<T>(schema, data, mode, logger = defaultLogger)`: unchanged control flow, but `warn` now calls `logger.warn` with a message naming the first failing Zod issue's path (`result.error.issues[0]?.path?.join(".") || "(root)"`) instead of `console.warn(result.error.message)`. `strict` still throws without logging (the caller owns fatality/logging decisions, per design Decision 4). `off` is untouched. The logger parameter is optional and trailing so `deviceSchema.test.ts`'s existing 3-arg call keeps compiling.

`validateItems<T>(schema, items, mode, entityLabel, logger = defaultLogger)`: the new array seam.
- `off`: passthrough, guarded by `Array.isArray` so a non-array `items` yields `{ valid: [], warnings: [] }` rather than throwing — protects the future `off`-mode pagination path (Phase 2) from a `TypeError` on a malformed body.
- `warn`: every item (valid or not) is returned **raw/unparsed** — `result.data` is never used for the returned value, only for divergence detection — preserving the "nothing is dropped, unknown keys survive" contract (R8). Each divergence logs via `logger.warn`.
- `strict`: only parsed, schema-valid items are returned; each divergence is pushed to `warnings[]` as a `ProblemError` and logged via `logger.error`.
- In both `warn` and `strict`, the `ProblemError` is built exactly once per divergent item via `toProblemError` and its `detail` is interpolated into the log line, so the log and the `warnings[]` entry always name the same device + field — never a raw multi-line `ZodError.message` dump.

`toProblemError(entityLabel, error, item, index)`: builds `{ type: VALIDATION_ERROR_TYPE, title: "${entityLabel} failed schema validation", status: VALIDATION_ERROR_STATUS, detail, raw: error }`. `detail` is `"${entityLabel} ${identity} failed validation at path: ${path}"` where `identity` is `id=`/`uid=` best-effort extracted from the raw object (`extractIdentity`), falling back to `index N` when neither is present. The full `ZodError` lives only in `raw`. `entityLabel` is a plain string parameter (not hardcoded to "Device"), matching the design's stated reuse for a future paginated collection endpoint.

`VALIDATION_ERROR_TYPE`/`VALIDATION_ERROR_STATUS` are exported as the single source of truth for the `"validation-error"`/`400` literals, to be reused (not re-hand-written) by the envelope hard-fail branch client-side in Phase 2.

All six new/changed exports (`validate`, `validateItems`, `toProblemError`, `VALIDATION_ERROR_TYPE`, `VALIDATION_ERROR_STATUS`, plus `VALIDATION_WARN_PREFIX`/`VALIDATION_ERROR_PREFIX` per the deviation below) live in `src/validation.ts`, which is **not** re-exported by `src/index.ts`'s barrel — so `toProblemError` and the constants stay off the public surface while still being importable by `client.ts` in Phase 2.

---

## 5. Deviations From Plan (If Any)

The initial implementation had only the cosmetic difference noted below. Since then, review round 2 (`reviser-r4`) made four further, behavior-preserving structural additions beyond the plan's illustrative snippet, each addressing a specific reviewer finding:

- **Extracted `firstIssuePath(error: ZodError): string`** as a single exported helper (`architect-r1-f1`, `engineer-r1-f2`), replacing the previously-duplicated inline `result.error.issues[0]?.path?.join(".") || "(root)"` computation in `validate()`'s `warn` branch and in `toProblemError()`. The plan's snippet inlines this computation at both sites and again (a third time) in Phase 2's envelope hard-fail; centralizing it now gives Phase 2 a helper to import instead of a third hand-copy.
- **Added an optional trailing `identityOverride?: string` parameter to `toProblemError`** (`architect-r1-f3`, ratified `architect-r2`), widening the plan's exact `toProblemError(entityLabel, error, item, index)` signature so a future single-value caller can inject an identity it already knows instead of falling back to `index N`. This parameter is **not exercised by any call site in this phase**, and the plan's own Phase 2 `getDeviceByUid` call site (Opinionated Implementation Notes) calls `toProblemError("Device", e, res.value, 0)` with exactly 4 arguments — it does not use the 5th argument either. It is kept as additive, optional, unused surface: it doesn't affect the plan-specified call site or any existing behavior, and the architect (round 2) ratified it as closing a genuine array-vs-single-value reuse gap in the builder. Flagged here per `project-lead-r2-f2` so a future reader knows Phase 2 is not required to pass it — Design Decision 4 already accepts the id-first `extractIdentity` result as sufficient for `getDeviceByUid`.
- **Added `VALIDATION_WARN_PREFIX`/`VALIDATION_ERROR_PREFIX` shared constants** (`engineer-r1-f3`), replacing three separately-hand-written log-line prefixes (`validate()`'s `warn`, `validateItems()`'s `warn` and `strict`) with one greppable pair. Round 3 (`architect-r3-f1`) found these were still module-private despite the pair's own comment claiming reuse by "the envelope hard-fail in client.ts" — a non-exported const can't be imported cross-file, so Phase 2 would have been forced to hand-copy the string literals, reintroducing the exact drift this constant was added to prevent. Made both `export const`, matching the already-exported `VALIDATION_ERROR_TYPE`/`VALIDATION_ERROR_STATUS` pair, so Phase 2's `client.ts` envelope hard-fail can import the same prefixes.
- **Hoisted the `Array.isArray(items)` guard in `validateItems`** above the `mode === "off"` branch (`engineer-r1-f1`), so a non-array `items` returns `{ valid: [], warnings: [] }` unconditionally in `strict`/`warn` too, not only `off` — making the JSDoc's "never throws" claim unconditionally true rather than off-mode-only.

None of these changes alter the signatures or semantics the plan requires for Phase 2 to build on (`validate`, `validateItems`, `toProblemError`'s original 4-arg form, the two error-literal constants); they are refinements layered on top, driven by review, not a deviation from Phase 1's intent.

The original cosmetic difference: wrapping the `warn` case in `validate()` in a block `{ }` to scope the local `path` const — required because the plan's snippet computes `path` inline in the template string, which is equivalent but was extracted to a named `const` for readability/consistency with the `validateItems` per-item path computation (this `const` is now `firstIssuePath(result.error)`, per the extraction above). This remains a stylistic, non-behavioral choice.

---

## 6. Ambiguities & Decisions

None encountered specific to this phase — the plan's Phase 1 steps and Opinionated Implementation Notes were unambiguous and fully specified the signatures, semantics, and test cases.

One discovery worth recording (not an ambiguity in this phase's scope, but relevant context — see §11): the repo's baseline (`HEAD`, before any Phase 1 change) already has 3 failing tests (`deviceSchema.test.ts` and two `devicesMethod.test.ts` cases) because `device.json`/`devicesPage*.json` fixtures omit the `udf.udf30` field that `DeviceSchema` requires as non-optional (`z.string().or(z.null())`). This is exactly the class of schema-drift problem this whole project addresses, but it is pre-existing, orthogonal to `src/validation.ts`, and out of Phase 1's scope (`schemas.ts` and fixtures are not phase 1 files). Confirmed via `git stash`/`npm test` that these 3 failures are identical with and without this phase's changes.

---

## 7. Tests

Added `src/__tests__/validation.test.ts`, now 13 tests, all passing (10 from the initial implementation + 3 added in review round 2 / `reviser-r4`, listed below):

**`validate()` (5 tests):**
- `strict` on valid data returns the parsed value, no logger calls.
- `strict` on invalid data throws (a `ZodError`) and calls no logger method.
- `warn` on invalid data returns the raw value and calls `logger.warn` with a message naming the failing path (`"name"`) and not containing a newline (guards against a raw multi-line `ZodError.message` dump).
- `off` returns raw data, no logger calls.
- The pre-existing 3-arg call form (no logger) still compiles and works, using the default logger.

**`validateItems()` (8 tests), all passing `entityLabel: "Device"`:**
- `strict`, mixed `[valid, invalid]` → `valid` contains only the parsed valid item; `warnings` has one entry with `type: "validation-error"`, `title: "Device failed schema validation"`, a `detail` naming `id=2` and the failing path (`"name"`), and `raw` populated; `logger.error` called once with a message containing that same `detail`; `logger.warn` never called.
- `strict`, invalid item missing both `id` and `uid` → `detail` falls back to `index 0`.
- `strict`, invalid item with `uid` but no `id` → `detail` names `uid=abc-123` (added `reviser-r4`, closes `engineer-r1-f4`: pins the previously-untested `extractIdentity` uid branch).
- `warn`, mixed → all items returned raw/unmutated (asserted via an unknown extra key surviving on the valid item, proving no re-parse); `warnings` empty; `logger.warn` called once with the identity + path message; `logger.error` never called.
- `off`, mixed → all items returned as-is, `warnings` empty, no logger calls.
- `off`, `items` deliberately not an array → returns `{ valid: [], warnings: [] }` without throwing.
- `strict`/`warn`, `items` deliberately not an array (both modes, one test) → returns `{ valid: [], warnings: [] }` without throwing, no logger calls (added `reviser-r4`, closes `engineer-r1-f1`: pins the guard now hoisted above the mode switch so "never throws" holds for `strict`/`warn`, not just `off`).
- Call with no trailing `logger` argument → resolves via the `defaultLogger` default without throwing (added `reviser-r4`, closes `engineer-r1-f4`: mirrors the existing no-logger `validate()` test, closing the asymmetric coverage gap).

---

## 8. Security & Best-Practices Review

- No `eval`, no dynamic code execution, no new dependencies.
- No secrets are logged — log lines carry device identity (`id`/`uid`, already present in the API response) and a Zod issue path, never credentials or tokens.
- `extractIdentity` narrows `unknown` safely via `typeof` checks before indexing — no unsafe casts beyond the pre-existing `as T` pattern already used by the original `validate()`.
- `Array.isArray` guard in `validateItems`'s `off` branch prevents a runtime `TypeError` from a malformed/non-array input, which otherwise could crash the pagination walk (Phase 2) on a malformed response body.
- No behavioral change reaches the public surface: `validate()`'s existing 3-arg call sites are unaffected; `validateItems`/`toProblemError`/the two constants are new exports from a non-barrelled module (`src/validation.ts` is not re-exported by `src/index.ts`), so the public API surface is unchanged.

---

## 9. Self-Review Scoring

| Element | Before | After | Comments |
|---------|--------|-------|----------|
| Extensibility | 9.0 | 9.5 | `entityLabel` kept fully generic (no "Device" hardcoding inside `validateItems`/`toProblemError`); shared error-literal constants centralize the `validation-error`/`400` pair for Phase 2 reuse |
| Understandability | 9.0 | 9.5 | Extracted the `warn`-path failing-path computation into a named `const path` in `validate()` for symmetry with `toProblemError`'s identical computation; added doc comments explaining the "why" (e.g. why `warn` never re-parses) at each seam |
| Best Practices | 9.0 | 9.5 | Single `toProblemError` call per divergent item feeds both the log line and the `warnings[]` entry, eliminating any risk of the log and the returned warning describing the failure differently |
| Plan Adherence | 9.5 | 10.0 | All three Phase 1 steps implemented exactly as specified, including the `Array.isArray` off-mode guard and the path-named (not raw-message) `warn` diagnostics |
| Test Quality | 9.0 | 9.5 | Every case enumerated in the plan's "Tests (in this phase)" section is covered, including the two edge cases (missing id/uid fallback to index, non-array `off` input) |

---

## 10. Iterative Improvements Made

1. Extracted the `warn`-branch failing-path computation in `validate()` into a named `const path`, mirroring the identical computation in `toProblemError`, instead of inlining it in the template string.
2. Added doc comments on all three new/changed exports explaining rationale (why `warn` never re-parses, why `entityLabel` is generic, why the constants are centralized) so the "why" survives without needing the plan doc alongside the code.
3. Ran `npx prettier --write` on both touched files to match the repo's existing formatting convention (`npm run format` is the repo's only style tooling; there is no lint script).

---

## 11. Remaining Risks or Follow-Ups

- **Resolved during review (was: pre-existing, out-of-scope test failures at baseline):** `deviceSchema.test.ts` (1 test) and `devicesMethod.test.ts` (2 tests: "returns validated data", "paginates automatically") originally failed both before and after this phase's changes, because `src/__tests__/fixtures/device.json`/`devicesPage.json`/`devicesPage1.json`/`devicesPage2.json` didn't conform to the unmodified, protected `DeviceSchema` (missing `udf2`–`udf30`; date fields as ISO strings instead of epoch-ms numbers). Confirmed via a scratch worktree against the plan-approval commit that this predates any Phase 1 code. Since `schemas.ts` is protected and the drift made the phase's own `npm test` exit gate fail unconditionally, `reviser-r3` corrected the four fixture files (see §3) rather than leaving it as an unresolved risk for a later phase — no test assertions were altered. `npm test` is fully green as of this phase.
- No functional risks introduced by this phase in isolation — it adds two new, unwired functions and extends one existing signature backward-compatibly.

---

## 12. Commands Run / To Run

- `npm run build` — passes, no type errors.
- `npm test` — all 4 suites / 17 tests pass: `deviceSchema.test.ts` (1), `devicesMethod.test.ts` (2), `client.test.ts` (1), `validation.test.ts` (13, per §7 — 10 from the initial implementation + 3 added in review round 2) = 17 (fixture fix in §3 resolved the 3 baseline failures originally noted here; see §11).
- `npx jest src/__tests__/validation.test.ts` — all 13 passing (Phase 1 + review-round tests).
- R4 guard: `git diff --name-only HEAD | grep -qE '^src/(schemas|result|index)\.ts$'` — no match, guard passes (only `src/validation.ts`, the test file, the four fixture JSON files, and this notes file changed across all rounds).
- `npx prettier --check src/validation.ts src/__tests__/validation.test.ts` — passes after `--write`.

---

## 13. Final Assertion

I assert that:
- Only Phase 1 has been implemented.
- No unnecessary scope expansion occurred.
- All quality scores are ≥ 9.5.
