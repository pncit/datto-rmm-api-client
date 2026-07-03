## implementation-auditor — round 1

Scope reviewed: `git diff HEAD` for Phase 1 — changes confined to `src/validation.ts`
(modified) and `src/__tests__/validation.test.ts` (new). `pipeline-run.json` is a harness
artifact, not implementation. No protected file (`schemas.ts`/`result.ts`/`index.ts`) changed,
so the Phase 1 R4 exit-gate guard holds. Independently ran `tsc --noEmit` (library-only
typecheck, not a test): exit 0 — the phase compiles clean. Tests were not run per skill policy.

### Phase Coverage Checklist
| Step | Status | Notes |
|------|--------|-------|
| 1. Logger-aware `validate()` (`logger` optional trailing, `warn`→`logger.warn`, path-named not raw blob, `strict` no log, `off` untouched) | ✅ Implemented | `logger: LoggerLike = defaultLogger`; `warn` logs `Validation warning at path: ${path}` using `issues[0]?.path?.join(".") || "(root)"`; `strict` throws without logging; `off` raw passthrough. |
| 1b. `VALIDATION_ERROR_TYPE`/`VALIDATION_ERROR_STATUS` constants | ✅ Implemented | Exported once (`"validation-error"`/`400`), consumed by `toProblemError`; reserved for Phase 2 envelope reuse. |
| 2. `validateItems()` per-item helper (generic `entityLabel`, mode partitioning, `off` `Array.isArray` guard, `warn` raw passthrough, `strict` parsed + `warnings[]`, build `ProblemError` once, log at correct level) | ✅ Implemented | Matches plan snippet exactly; `warn` pushes raw `item`, `strict` pushes `result.data`; log line interpolates `problem.detail`. |
| 3. `toProblemError()` + `extractIdentity()` (short stable title, id/uid best-effort else `index N`, first Zod path, `ZodError` in `raw`, exported from non-barrelled module) | ✅ Implemented | Signature and shape as specified; `extractIdentity` narrows `unknown` via `typeof` before indexing. |
| Tests: `src/__tests__/validation.test.ts` covering both seams | ✅ Implemented | All enumerated plan cases present (5 `validate` + 5 `validateItems`), including the missing-id→`index 0` and non-array-`off` edge cases. See test findings below. |

### Drift Report
**Out-of-scope changes:** None. Only `src/validation.ts` and the new test file changed; no
`client.ts`/`schemas.ts`/`result.ts`/`index.ts` edits, no envelope module (correctly deferred to
Phase 2), no fixture edits.
**Acceptable Phase X necessities:** Import swap in `validation.ts` (`z` dropped, `ZodError`
added; `defaultLogger`/`LoggerLike` and `ProblemError` added) — all required by the new seams.
The one deviation the notes record (extracting the `warn`-path `path` into a named `const`) is
cosmetic and behavior-preserving; verified against the diff.

Overall: a faithful, clean implementation of a highly-specified phase. Findings are limited to
two test-hardening gaps that pin exactly the contracts this feature turns on.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| implementation-auditor-r1-f1 | Low | Open | Tests | `src/__tests__/validation.test.ts:25-34` | The "strict on invalid data throws" test uses a bare `.toThrow()`, which passes for *any* thrown value. The plan (Phase 1 Tests) specifies `strict` invalid "**throws a `ZodError`**", and Phase 2's `getDeviceByUid` fatality logic keys on `e instanceof ZodError` — so the thrown *type* is a load-bearing contract that this test does not pin. A regression that threw a plain `Error` would pass. | Import `ZodError` from `zod/v4` and assert `.toThrow(ZodError)` (or `expect(() => …).toThrow(); ` plus a `try/catch` asserting `instanceof ZodError`), locking the thrown type. |
| implementation-auditor-r1-f2 | Low | Open | Tests | `src/__tests__/validation.test.ts:36-45` (and `:101-119`) | The `warn`-path tests assert `logger.warn` was called but never guard that `console.warn` is *not* called. Routing off `console` onto the configured logger is the exact defect this phase fixes (design R6); because the tests inject a mock logger that is a distinct object from `console`, a regression that left a hardcoded `console.warn(...)` alongside the new `logger.warn(...)` would still pass. The plan's Phase 1 `validate()` `warn` case explicitly says "via `logger.warn`, **not `console`**". | Add `const spy = jest.spyOn(console, "warn").mockImplementation(() => {});` in the `warn` cases and assert `expect(spy).not.toHaveBeenCalled();` (restore after), pinning that diagnostics leave `console` for the injected logger. |
