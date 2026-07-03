# Implementation Notes — Phase 2

- **Plan:** resilient-device-validation
- **Phase:** 2 — Wire resilient validation into the client
- **Date:** 2026-07-03
- **Agent:** Implementor

---

## 1. Phase Scope Confirmation

**In-Scope (Phase 2 only):**
- Resolve `config.logger ?? defaultLogger` once on `DattoRmmClient` (constructor body, uninitialized field) and reuse it from `getAllPages`/`getDeviceByUid`.
- Add the internal, un-barrelled envelope schema `src/internal/devicesEnvelope.ts` (`DevicesEnvelopeSchema`/`DevicesEnvelope`).
- Rewrite `getAllPages` to a two-pass model: structural envelope `safeParse` (mode-gated to `strict`/`warn`), then `validateItems` per raw device, accumulating `valid`/`warnings` across pages; `warnings` always present (even `[]`).
- Update `getAccountDevices` to call the new `getAllPages` with `DevicesEnvelopeSchema` + `DeviceSchema` + an optional-chained extractor.
- Update `getDeviceByUid` to pass `this.logger` into `validate()` and to log via the shared `toProblemError` shape on its `ZodError` catch.
- Extend `src/__tests__/devicesMethod.test.ts` with the full resilient-validation + `getDeviceByUid` test matrix from the plan.
- Add the `## Resilient validation` README section documenting the three behavioral changes.

**Explicitly Out-of-Scope:**
- `src/schemas.ts`, `src/result.ts`, `src/index.ts` — untouched (R4).
- Adding `src/internal` to the `src/index.ts` barrel.
- Any change to `src/validation.ts` beyond consuming its Phase 1 exports (`validate`, `validateItems`, `toProblemError`, `firstIssuePath`, `VALIDATION_ERROR_TYPE`, `VALIDATION_ERROR_STATUS`).

---

## 2. Phase Intent (Interpreted)

Fix the reported outage by making `getAllPages` validate a page in two independent passes: a structural "envelope" check (is this a well-formed devices page at all?) that stays a hard failure, and a per-device pass via Phase 1's `validateItems` that scopes a divergent device to itself instead of the whole account. After this phase, `getAccountDevices()` in `strict` mode returns `{ ok: true }` with the account's valid devices and a populated `warnings[]` for any that diverged, and `getDeviceByUid()` keeps failing hard on a divergent single device while emitting an error-level log through the configured logger.

---

## 3. Files Touched

| File | Change Type | Rationale |
|------|------------|-----------|
| `src/internal/devicesEnvelope.ts` | Created | New un-barrelled `DevicesEnvelopeSchema`/`DevicesEnvelope` — structural page check with opaque `devices` elements; kept off the public surface per plan Step 2 |
| `src/client.ts` | Modified | Resolved `this.logger` once in the constructor body; rewired `getAllPages` to envelope-then-per-item validation with cross-page `valid`/`warnings` accumulation; updated `getAccountDevices`'s call site; updated `getDeviceByUid` to use `this.logger` + the shared `toProblemError` builder |
| `src/__tests__/devicesMethod.test.ts` | Modified | Added 16 new tests covering the full resilient-validation matrix (strict/warn/off × clean/mixed/malformed-envelope/edge-case pages, cross-page accumulation, mid-walk discard, `getDeviceByUid` fail-hard + warn-mode); the 2 pre-existing tests are unmodified. Also hardened the shared `MockAxios` test double (`hasOwnProperty` instead of truthiness) so a deliberately `null` configured response is distinguishable from "URL not configured" — needed for the `off`, null-page-body test the plan requires |
| `README.md` | Modified | Added the `## Resilient validation` section with a `### Behavioral changes` subsection (the 3 release-note bullets from the design's Breaking Changes) |

---

## 4. Implementation Summary

**`src/internal/devicesEnvelope.ts` (new).** `DevicesEnvelopeSchema = z.object({ pageDetails: PaginationDataSchema.optional(), devices: z.array(z.unknown()).optional() })`. `devices` stays optional (matching the untouched `DevicesPageSchema`) so a legitimate zero-device page isn't falsely hard-failed. Not added to the `src/index.ts` barrel.

**`DattoRmmClient` constructor.** Added `private logger: LoggerLike;` (uninitialized field) and `this.logger = config.logger ?? defaultLogger;` in the constructor body — the same value now also passed to `HttpClient`. Declared this way (not as a field initializer) because `config` is a constructor parameter property (`constructor(private config: DattoRmmClientConfig)`); a field initializer can't see the bare `config` name.

**`getAllPages<T, P>`.** New signature: `(url, token, params, envelopeSchema: ZodType<P>, itemSchema: ZodType<T>, extractor: (page: P) => unknown[])`. Per page:
- `off`: no envelope check at all — `page = res.value as P`, best-effort walk, exactly as before.
- `strict`/`warn`: `envelopeSchema.safeParse(res.value)` **directly** (not `validate()`, whose `warn` branch logs-and-passes-through and would let a malformed page slip past R5). On failure: `this.logger.error(...)` with a single-line, path-named message (`Malformed devices page envelope at ${nextUrl} (path: ${envelopePath})`, using the shared `firstIssuePath()` helper — see §5), then `return { ok: false, error: { type: VALIDATION_ERROR_TYPE, title: "Malformed devices page envelope", status: VALIDATION_ERROR_STATUS, detail: ..., raw: parsed.error } }`. This discards any `valid`/`warnings` already accumulated from earlier pages in the same walk — pagination cannot continue past a page it can't read.

Then, in every mode, `validateItems(itemSchema, extractor(page), this.validationMode, "Device", this.logger)` is called; its `valid`/`warnings` are appended to the walk-spanning accumulators. `nextUrl = page?.pageDetails?.nextPageUrl` — optional-chained on `page` itself (not only `.pageDetails`), because in `off` mode `page` may be `null`/a primitive and this is a separate statement the extractor's own `p?.devices` guard doesn't cover. On completion: `return { ok: true, value: items, warnings }` — `warnings` is always present, including `[]` on a clean account (a stable shape, not "present only when non-empty").

**`getAccountDevices`.** Calls `getAllPages<Device, DevicesEnvelope>(url, token, params, DevicesEnvelopeSchema, DeviceSchema, (p) => p?.devices ?? [])`. The extractor is optional-chained so an `off`-mode `null`/primitive body never throws.

**`getDeviceByUid`.** Now calls `validate(DeviceSchema, res.value, this.validationMode, this.logger)`. In the `ZodError` catch: builds the `ProblemError` once via `toProblemError("Device", e, res.value, 0)` (the same builder `validateItems` uses, so all `validation-error` sites share one shape), logs `` `getDeviceByUid: ${problem.detail}` `` at error level, and returns `{ ok: false, error: problem }` — a single log, no double-logging (`validate()` itself never logs in `strict`).

**Imports.** `client.ts` now imports `validate`, `validateItems`, `toProblemError`, `firstIssuePath`, `VALIDATION_ERROR_TYPE`, `VALIDATION_ERROR_STATUS`, `ValidationMode` from `./validation.js`; `DevicesEnvelopeSchema`/`DevicesEnvelope` from `./internal/devicesEnvelope.js`; `LoggerLike`/`defaultLogger` from `./logger.js`. The now-unused `DevicesPageSchema`/`DevicesPage` imports were dropped (both remain defined/exported, unchanged, in `schemas.ts`).

---

## 5. Deviations From Plan (If Any)

- **Reused Phase 1's exported `firstIssuePath(error)` helper for the envelope hard-fail's path computation**, instead of inlining `parsed.error.issues[0]?.path?.join(".") || "(root)"` a third time as the plan's illustrative snippet does. Phase 1 extracted this exact helper (`architect-r1-f1`/`engineer-r1-f2`, see `implementation-phase1-notes.md` §5) specifically so later call sites — this one — wouldn't hand-copy the computation a third time; not reusing it here would have reintroduced the drift Phase 1 was built to prevent. Behaviorally identical to the plan's snippet (same result string), so it does not change the phase's intent, tests, or exit gate.
- **Hardened the shared `MockAxios` test double** (`src/__tests__/devicesMethod.test.ts`) to key on `Object.prototype.hasOwnProperty.call(responses, url)` instead of `!resp` truthiness. The plan's own required test list includes "`off`, a `null`... page body does not throw," which needs a way to configure a literal `null` response distinct from "no response configured for this URL" — the original truthiness check couldn't express that. This only affects the test double; the 2 pre-existing tests (which use truthy fixture objects) are unaffected and pass unmodified.
- **Added a small `buildClient(responses, opts)` test helper** in the new `describe("getAccountDevices resilient validation", …)` block to avoid re-deriving the same `apiUrl`/`apiKey`/`apiSecret`/`axiosInstance` boilerplate across the 13 tests in that block. Not present in the plan's snippet, but the plan's own "Tests" section enumerates ~13 near-identical cases varying only in `responses`/`validationMode`/`logger`; a shared builder is the standard way to keep that volume of tests readable without duplicating five lines of client construction in each one.
- **Word-boundary regex (`\bDevice\b`) instead of plain substring count** in the `getDeviceByUid` strict-mode log-message assertion. A first pass used a plain `/Device/g` count and failed because the log's own `getDeviceByUid:` prefix incidentally contains the substring "Device" (`getDeviceByUid` = `get` + `Device` + `ByUid`) — unrelated to the actual "no duplicated Device wording" property the plan's test description asks for. Word-boundary matching correctly counts only the standalone word "Device" (the one at the start of `problem.detail`), which is what the plan's assertion is actually about.

None of these change `getAllPages`/`getAccountDevices`/`getDeviceByUid`'s signatures or behavior as specified by the plan, or any file outside Phase 2's declared scope.

---

## 6. Ambiguities & Decisions

- **Log-line wording for the envelope hard-fail.** The plan's Step 3 gives an exact message template (`` `Malformed devices page envelope at ${nextUrl} (path: ${envelopePath})` ``) and a separate, shorter `detail` template (`` `Malformed devices page envelope (path: ${envelopePath})` `` — no URL). Implemented both exactly as specified: the log line includes `nextUrl` for operator triage (which page failed), while `detail` on the returned `ProblemError` omits it, matching the plan's given code and the "concise, path-named" convention shared with `toProblemError`.
- **Whether `off` mode still runs `validateItems`.** The plan's Step 3 and Opinionated Implementation Notes are explicit that `validateItems` is called "in every mode" (its own `off` branch, from Phase 1, is the thing that special-cases `off` to a straight passthrough with an `Array.isArray` guard). Implemented as specified — `off` calls `validateItems(..., this.validationMode, ...)` unconditionally rather than special-casing `off` in `getAllPages` itself — which is also what makes the "off, non-array devices field does not throw" test pass via Phase 1's existing guard rather than a new one.

---

## 7. Tests

Extended `src/__tests__/devicesMethod.test.ts`; the suite is now 18 tests (2 pre-existing, unmodified, + 16 new), all passing:

- `DevicesEnvelopeSchema` accepts all three existing page fixtures (design Risks & Mitigations row 3 — guards envelope-vs-`DevicesPageSchema` `pageDetails` consistency directly, importing the real schema from `../internal/devicesEnvelope`).
- **Strict:** clean page → `warnings` is `[]` (present, not omitted), no error log; mixed page → only the valid device returned, one `warnings[]` entry naming `id=`/failing path, one `logger.error` call; malformed envelope (`devices` not an array) → `{ ok: false }` with the shared `validation-error`/`"Malformed devices page envelope"` shape, a concise single-line `detail`, one `logger.error` call; two sub-cases (`{}` and `{ error: "unauthorized" }`) pin the documented "object lacking both `pageDetails`/`devices` keys is an empty page, not a hard-fail" contract; cross-page accumulation of both `valid` and `warnings`; a later page's malformed envelope discards the earlier page's accumulated `valid`/`warnings`.
- **Warn:** a divergent device stays in `value` (raw) and logs once via `logger.warn`, never `console.warn`; a malformed envelope still hard-fails and logs via `logger.error` (Breaking Change #2).
- **Off:** a divergent device passes through untouched with zero logger calls; a non-array `devices` field does not throw; a `null` page body does not throw (the two-dereference-site guard: `page?.pageDetails?.nextPageUrl` and the optional-chained extractor); a primitive (string) page body does not throw.
- **`getDeviceByUid`:** strict mode fails hard with the shared `toProblemError` shape and logs once, with the message containing the identity/path and not duplicating the standalone word "Device"; warn mode returns the divergent device raw and logs the failing path via `logger.warn`, not a raw `ZodError.message` dump.

---

## 8. Security & Best-Practices Review

- No `eval`, no dynamic code execution, no new runtime dependencies.
- No secrets logged — log lines carry device identity (`id`/`uid`, already present in API responses) and a Zod issue path or envelope path, never credentials/tokens.
- The envelope's `safeParse` and `validateItems`'s per-item `safeParse` both fail closed on unexpected shapes rather than throwing uncaught exceptions out of `getAllPages`/`getAccountDevices` — the `Result` "never throw" contract holds across all three validation modes, including the two off-path null-safety sites exercised by the new `null`/primitive-body tests.
- No behavioral change reaches the public type surface: `Device`, `DeviceSchema`, `DevicesPageSchema`, `Result`, `ProblemError`, and every `src/index.ts` export are byte-for-byte unchanged (verified by the R4 guards below and by `deviceSchema.test.ts` passing unmodified).
- `src/internal/devicesEnvelope.ts` is not barrelled — confirmed by re-reading `src/index.ts` (unchanged) and by the R4 guard (a), which fails the gate if `index.ts` is touched at all.

---

## 9. Self-Review Scoring

| Element | Before | After | Comments |
|---------|--------|-------|----------|
| Extensibility | 9.0 | 9.5 | `getAllPages` is fully generic over `<T, P>` via the envelope/item-schema/extractor triple, so a future paginated collection endpoint reuses the same method with a different envelope+item schema pair, exactly as the design's Future Considerations describes |
| Understandability | 9.0 | 9.5 | Doc comments on `getAllPages` and each branch explain *why* (envelope uses `safeParse` not `validate()`, why `off` skips it, why `page?.` guards both dereference sites) rather than only *what* |
| Best Practices | 9.0 | 9.5 | Single source of truth for the path computation (`firstIssuePath`) and the error literal/status pair (`VALIDATION_ERROR_TYPE`/`_STATUS`) reused rather than hand-copied a third time; one `toProblemError` builder shared by all three `validation-error` sites |
| Plan Adherence | 9.5 | 10.0 | All six Phase 2 steps implemented as specified; every plan-enumerated test case is present; both R4 exit-gate guards and the doc-landing guard pass |
| Test Quality | 9.0 | 9.5 | Every scenario in the plan's "Tests (in this phase)" section is covered by name, including the two off-path null-safety edge cases the plan calls out as easy to get subtly wrong (naive `page.pageDetails?.…` vs. the required `page?.pageDetails?.…`) |

---

## 10. Iterative Improvements Made

1. Replaced a duplicated inline path computation in the envelope hard-fail branch with the Phase 1 `firstIssuePath()` helper (see §5).
2. Fixed a self-review regex false-positive in the `getDeviceByUid` strict-mode log assertion (plain substring count over-counted "Device" inside the unrelated `getDeviceByUid` prefix) by switching to a word-boundary match, so the test actually pins the property the plan describes ("must not contain 'Device' twice") rather than an incidental substring artifact.
3. Hardened the shared `MockAxios` test double to distinguish a deliberately-configured falsy (`null`) response from an unconfigured URL, which the plan's `off`/null-body test requires.
4. Ran `npx prettier --write` on all touched files to match the repo's only style tool (`npm run format`; no lint script exists).

---

## 11. Remaining Risks or Follow-Ups

- **Deferred, evidence-driven follow-up (already flagged by the plan, not new):** the envelope's `devices` field stays optional, so a 200 body that is an object carrying neither `pageDetails` nor `devices` is treated as an empty page rather than a hard-fail. This is pinned by two tests (`{}` and `{ error: "unauthorized" }`) as an intentional, verified contract, not an accident — see plan's "Deferred Validation" section for the evidence-driven trigger to revisit it.
- No new functional risks introduced by this phase: the public type surface, `Result`/`ProblemError` shapes, and the `warn`/`off` returned-data contracts (per-device path) are all unchanged; the only new hard-fail path (malformed envelope in `warn`) is the explicitly-designed Breaking Change #2, documented in the README.
- The live drifted-account smoke check against the real Datto RMM API (plan's "Deferred Validation") requires live credentials and cannot run unattended — out of scope for this phase, as noted in the plan.

---

## 12. Commands Run / To Run

- `npm run build` — passes, no type errors.
- `npm test` — all 4 suites / 33 tests pass: `deviceSchema.test.ts` (1), `validation.test.ts` (13), `client.test.ts` (1), `devicesMethod.test.ts` (18, per §7).
- R4 guard (a): `git diff --name-only HEAD | grep -qE '^src/(schemas|result|index)\.ts$'` — no match, passes.
- R4 guard (b): `git diff HEAD -- src/client.ts src/config.ts | grep -qE '^\+export '` — no match, passes (no new top-level export added to either barrelled module).
- Doc-landing guard: `grep -q '## Resilient validation' README.md` — matches, passes.
- `npx prettier --check src/client.ts src/internal/devicesEnvelope.ts src/__tests__/devicesMethod.test.ts README.md` — passes after `--write`.

---

## 13. Final Assertion

I assert that:
- Only Phase 2 has been implemented.
- No unnecessary scope expansion occurred.
- All quality scores are ≥ 9.5.
