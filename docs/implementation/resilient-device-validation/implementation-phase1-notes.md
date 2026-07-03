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
- Fixing the pre-existing fixture/schema drift in `device.json`/`devicesPage*.json` that causes `deviceSchema.test.ts` and two `devicesMethod.test.ts` cases to fail at baseline (see §11 — this is the exact class of bug the overall project fixes, but it predates and is independent of Phase 1's changes).

---

## 2. Phase Intent (Interpreted)

Split the single validation module into the two primitives the resilient pagination path (Phase 2) needs, without touching `client.ts`: a logger-aware single-value `validate()` seam, and a new array seam `validateItems()` that never throws — it partitions an array of raw items into survivors and per-item `ProblemError` rejections, logging at the mode-appropriate level. Both seams share one `ProblemError`-building helper (`toProblemError`) and one pair of error-literal constants, so every `validation-error` site in the eventual client wiring (Phase 2) produces the same shape. This phase is fully unit-testable in isolation.

---

## 3. Files Touched

| File | Change Type | Rationale |
|------|------------|-----------|
| `src/validation.ts` | Modified | Added logger param to `validate()`; added `validateItems()`, `toProblemError()`, `extractIdentity()`, and the shared `VALIDATION_ERROR_TYPE`/`VALIDATION_ERROR_STATUS` constants |
| `src/__tests__/validation.test.ts` | Created | Unit tests for both `validate()` and `validateItems()` |

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

All four new/changed exports (`validate`, `validateItems`, `toProblemError`, `VALIDATION_ERROR_TYPE`, `VALIDATION_ERROR_STATUS`) live in `src/validation.ts`, which is **not** re-exported by `src/index.ts`'s barrel — so `toProblemError` and the constants stay off the public surface while still being importable by `client.ts` in Phase 2.

---

## 5. Deviations From Plan (If Any)

No deviations. Implementation follows the plan's Opinionated Implementation Notes for Phase 1 closely; the only difference from the plan's illustrative snippet is cosmetic (wrapping the `warn` case in `validate()` in a block `{ }` to scope the local `path` const — required because the plan's snippet computes `path` inline in the template string, which is equivalent but I extracted it to a named `const` for readability/consistency with the `validateItems` per-item path computation). This is a stylistic, non-behavioral choice, not a deviation from intent.

---

## 6. Ambiguities & Decisions

None encountered specific to this phase — the plan's Phase 1 steps and Opinionated Implementation Notes were unambiguous and fully specified the signatures, semantics, and test cases.

One discovery worth recording (not an ambiguity in this phase's scope, but relevant context — see §11): the repo's baseline (`HEAD`, before any Phase 1 change) already has 3 failing tests (`deviceSchema.test.ts` and two `devicesMethod.test.ts` cases) because `device.json`/`devicesPage*.json` fixtures omit the `udf.udf30` field that `DeviceSchema` requires as non-optional (`z.string().or(z.null())`). This is exactly the class of schema-drift problem this whole project addresses, but it is pre-existing, orthogonal to `src/validation.ts`, and out of Phase 1's scope (`schemas.ts` and fixtures are not phase 1 files). Confirmed via `git stash`/`npm test` that these 3 failures are identical with and without this phase's changes.

---

## 7. Tests

Added `src/__tests__/validation.test.ts`, 10 tests, all passing:

**`validate()` (5 tests):**
- `strict` on valid data returns the parsed value, no logger calls.
- `strict` on invalid data throws (a `ZodError`) and calls no logger method.
- `warn` on invalid data returns the raw value and calls `logger.warn` with a message naming the failing path (`"name"`) and not containing a newline (guards against a raw multi-line `ZodError.message` dump).
- `off` returns raw data, no logger calls.
- The pre-existing 3-arg call form (no logger) still compiles and works, using the default logger.

**`validateItems()` (5 tests), all passing `entityLabel: "Device"`:**
- `strict`, mixed `[valid, invalid]` → `valid` contains only the parsed valid item; `warnings` has one entry with `type: "validation-error"`, `title: "Device failed schema validation"`, a `detail` naming `id=2` and the failing path (`"name"`), and `raw` populated; `logger.error` called once with a message containing that same `detail`; `logger.warn` never called.
- `strict`, invalid item missing both `id` and `uid` → `detail` falls back to `index 0`.
- `warn`, mixed → all items returned raw/unmutated (asserted via an unknown extra key surviving on the valid item, proving no re-parse); `warnings` empty; `logger.warn` called once with the identity + path message; `logger.error` never called.
- `off`, mixed → all items returned as-is, `warnings` empty, no logger calls.
- `off`, `items` deliberately not an array → returns `{ valid: [], warnings: [] }` without throwing.

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

- **Pre-existing, out-of-scope test failures at baseline:** `deviceSchema.test.ts` (1 test) and `devicesMethod.test.ts` (2 tests: "returns validated data", "paginates automatically") fail both before and after this phase's changes, because `src/__tests__/fixtures/device.json`/`devicesPage.json`/`devicesPage1.json`/`devicesPage2.json` omit the `udf.udf30` field that `DeviceSchema` requires (non-optional `z.string().or(z.null())`). Confirmed via `git stash` that this is identical at `HEAD` before any Phase 1 work — it is not caused by this phase and `src/schemas.ts`/fixtures are outside Phase 1's file scope. This is exactly the schema-drift class of bug the project fixes, and Phase 2's resilient per-device validation will very likely make `devicesMethod.test.ts` pass again once wired (a drifted `udf30` field would become a per-device warning instead of a page-level throw) — but that is Phase 2's concern, and the `deviceSchema.test.ts` fixture drift is orthogonal to any phase in this plan (it's a single-device `validate()` call against a fixture that itself doesn't match the shipped schema). Flagging for the ImplementationAuditor / Phase 2 implementor's awareness rather than silently fixing fixtures outside this phase's declared scope.
- No functional risks introduced by this phase in isolation — it adds two new, unwired functions and extends one existing signature backward-compatibly.

---

## 12. Commands Run / To Run

- `npm run build` — passes, no type errors.
- `npm test` — 11 passed / 3 failed (14 total); the 3 failures are the pre-existing baseline failures described in §11, unrelated to this phase (verified via `git stash` to reproduce the identical 3 failures with this phase's changes absent).
- `npx jest src/__tests__/validation.test.ts` — 10/10 passing (all new Phase 1 tests).
- R4 guard: `git diff --name-only HEAD | grep -qE '^src/(schemas|result|index)\.ts$'` — no match, guard passes (only `src/validation.ts` and the new test file changed).
- `npx prettier --check src/validation.ts src/__tests__/validation.test.ts` — passes after `--write`.

---

## 13. Final Assertion

I assert that:
- Only Phase 1 has been implemented.
- No unnecessary scope expansion occurred.
- All quality scores are ≥ 9.5.
