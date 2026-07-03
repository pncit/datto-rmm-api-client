## implementation-auditor — round 1

Scope reviewed: the Phase 2 working-tree diff (`git diff HEAD`) — `src/client.ts`, the new
un-barrelled `src/internal/devicesEnvelope.ts`, `src/__tests__/devicesMethod.test.ts`, and the
`## Resilient validation` README section. `src/validation.ts` is a Phase 1 artifact (unchanged in
this diff) and was read only to confirm the seams `client.ts` consumes exist and behave as the plan
assumes. Tests were **not** run (assumed passing per skill).

### Phase Coverage Checklist
| Step | Status | Notes |
|------|--------|-------|
| 1. Resolve logger once on client (uninitialized field + constructor-body assign) | ✅ Implemented | `private logger: LoggerLike;` declared (client.ts:28); `this.logger = config.logger ?? defaultLogger;` in constructor body (client.ts:36); reused by both methods; same value handed to `HttpClient` (client.ts:45). No inline field initializer, avoiding the TS2663 the plan warned about. |
| 2. Internal un-barrelled `DevicesEnvelopeSchema` | ✅ Implemented | New `src/internal/devicesEnvelope.ts`; `pageDetails: PaginationDataSchema.optional()`, `devices: z.array(z.unknown()).optional()`; not added to `src/index.ts` (verified `index.ts` untouched, no `internal` barrel). `devices` optional per the documented Step-2 gap. |
| 3. Rewrite `getAllPages` (envelope safeParse → validateItems, cross-page accumulation, hard-fail semantics, off-path null-safety) | ✅ Implemented | Direct `envelopeSchema.safeParse` in strict/warn (client.ts:95), not `validate()`; `off` skips envelope (client.ts:90); single-line path-named error log + concise path-named `detail` reusing one `firstIssuePath` (client.ts:100–111); shared `VALIDATION_ERROR_TYPE/_STATUS`; `warnings` always present incl. `[]`; both dereference sites guarded — extractor `p?.devices` and `page?.pageDetails?.nextPageUrl` (client.ts:131). |
| 4. `getAccountDevices` calls new `getAllPages` | ✅ Implemented | client.ts:146–154 with `DevicesEnvelopeSchema` + `DeviceSchema` + optional-chained `(p) => p?.devices ?? []`. |
| 5. `getDeviceByUid` fail-hard + error log via shared builder | ✅ Implemented | `validate(DeviceSchema, res.value, this.validationMode, this.logger)`; catch builds `toProblemError("Device", e, res.value, 0)` once, logs `getDeviceByUid: ${problem.detail}`, returns same object; `unknown-error` branch unchanged (client.ts:166–190). |
| 6. Import cleanup | ✅ Implemented | Added `validateItems`/`toProblemError`/`firstIssuePath`/`VALIDATION_ERROR_TYPE`/`_STATUS`; dropped `DevicesPageSchema`/`DevicesPage`; imports `DevicesEnvelopeSchema`/`DevicesEnvelope`, `LoggerLike`/`defaultLogger`, `ProblemError`. No unused imports observed. |
| Docs: `## Resilient validation` + `### Behavioral changes` | ✅ Implemented | README has the exact heading (doc-landing grep passes) and all three release-note bullets, including the empty-`[]` truthiness caveat. |
| Exit gates | ✅ Pass | R4 guard (a): schemas/result/index untouched. R4 guard (b): no `+export ` added to client.ts/config.ts. Doc grep matches. (build/test assumed passing.) |

### Test Coverage vs. Plan's "Tests (in this phase)"
Every enumerated case is present in `devicesMethod.test.ts`: envelope accepts all three fixtures;
strict clean-empty-`warnings`; strict mixed; strict malformed-envelope + concise no-newline `detail`
+ log; strict object-lacking-both-keys (both `{}` and `{ error: "unauthorized" }` via `test.each`);
strict cross-page accumulation; strict mid-walk discard (asserts via message-match, not call-count,
as the plan requires); warn passthrough + `console.warn` spy; warn malformed-envelope hard-fail; off
per-device passthrough; off non-array `devices`; off `null` **and** primitive-string body; both
`getDeviceByUid` cases (strict fail-hard with `\bDevice\b` word-boundary count, warn path-named).
The two pre-existing tests are unmodified and unaffected by always-present `warnings`.

### Deviations (cross-checked against notes §5, all justified)
- `firstIssuePath()` reused for the envelope path instead of re-inlining the computation — genuinely
  better (single source of truth established in Phase 1); behaviorally identical. ✅
- `MockAxios` hardened to `hasOwnProperty` — required to configure a literal `null` response distinct
  from "unconfigured URL" for the off/null-body test; touches only the test double. ✅
- `buildClient` helper + `\bDevice\b` word-boundary assertion — both sound, verified against the
  diff. ✅

### Drift Report
**Out-of-scope changes:** None. `docs/.../pipeline-run.json` is orchestration telemetry (an appended
worker log entry), not code. Protected files (`schemas.ts`/`result.ts`/`index.ts`) untouched;
`validation.ts` untouched.
**Acceptable Phase 2 necessities:** `src/internal/devicesEnvelope.ts` (new, un-barrelled) and the
`this.logger` field — both mandated by the plan.

The phase is faithful to the plan in letter and spirit; behavior, error shapes, log routing, and the
off-path null-safety all match. One minor test-coverage gap is noted below.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| implementation-auditor-r1-f1 | Low | Open | Tests | `src/__tests__/devicesMethod.test.ts` (strict/warn envelope cases, ~L195, L362) | R5 and design L139 / Success-Criteria explicitly enumerate the **"response not an object"** envelope-failure branch (a string/HTML error page or `null` body reaching a validating mode — the literal scenario from the design's Problem Statement). The malformed-envelope tests only exercise the *present-but-wrong-type* `devices: "nope"` branch inside an object; the non-object-body branch is only asserted in **`off`** mode (where it passes through), never in `strict`/`warn` where `z.object` should hard-fail. So the distinct R5 branch that actually protects against auth-error/HTML pages has no coverage in a validating mode. | Add one case: `validationMode: "strict"` (and/or `warn`) with a non-object body (e.g. `"<html>not a devices page</html>"` or `null`) asserting `{ ok: false, error: { type: "validation-error", title: "Malformed devices page envelope" } }` and one `logger.error`. Cheap (reuse the existing off-mode string/null fixtures) and pins the design-enumerated branch. |
