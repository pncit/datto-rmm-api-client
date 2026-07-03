## implementation-auditor — round 2

Continuing the Phase 2 review. Read my round-1 turn and the reviser's round-1 disposition first,
then re-verified against the current working tree. Phase 2 code (`src/client.ts`,
`src/internal/devicesEnvelope.ts`, `README.md`) is committed at the `pre-revision phase2:stepA`
checkpoint (`96f92c1`); the reviser's round-1 fix is the unstaged edit to
`src/__tests__/devicesMethod.test.ts`. I scoped the full phase with `git diff e8dc461` (the Phase 1
completion commit) so the committed client rewrite is in view, not just the working-tree delta.
`npm run build` and `npm test` were run by the harness earlier in scoping (build clean; 4 suites /
36 tests pass) — findings below rest on reading the diff, not on re-running tests.

### Carry-forward verification (round 1 → round 2)

- **implementation-auditor-r1-f1** (reviser: *Fixed*) — **ratified.** The non-object-body R5 branch
  is now exercised in validating modes: `devicesMethod.test.ts:224–243` (`test.each` over `null` and
  an HTML-string body under `strict`) and `:409–422` (`warn`, `null` body) both assert
  `{ ok: false, error: { type: "validation-error", title: "Malformed devices page envelope" } }`
  with exactly one `logger.error`. They sit distinctly alongside the `off`-mode `null`/primitive
  tests (`:477–503`) that assert the opposite passthrough, so the mode-gating of the hard-fail is
  now pinned in both directions. Genuinely resolved → Closed.

### Phase Coverage Checklist (re-confirmed)
| Step | Status | Notes |
|------|--------|-------|
| 1. Resolve `this.logger` once (uninitialized field + constructor-body assign) | ✅ Implemented | `client.ts:28,36`; reused by both methods, same value handed to `HttpClient` (`:45`). |
| 2. Un-barrelled `DevicesEnvelopeSchema` | ✅ Implemented | `src/internal/devicesEnvelope.ts`; not in `index.ts` (verified). `devices` optional per documented Step-2 gap. |
| 3. Rewrite `getAllPages` (envelope safeParse → validateItems, cross-page accum, off-path null-safety) | ✅ Implemented | Direct `safeParse` in strict/warn (`:95`); `off` skips (`:90`); one `firstIssuePath` reused for log + `detail` (`:100–111`); both deref sites guarded (`p?.devices` `:153`, `page?.pageDetails?.nextPageUrl` `:131`); `warnings` always present (`:138`). |
| 4. `getAccountDevices` new call | ✅ Implemented | `:146–154`. |
| 5. `getDeviceByUid` fail-hard + error log via shared builder | ✅ Implemented | `:169–184`; `toProblemError("Device", e, res.value, 0)` once, logs `getDeviceByUid: ${problem.detail}`, returns same object. |
| 6. Import cleanup | ✅ Implemented | Dropped `DevicesPageSchema`/`DevicesPage`; no unused imports. |
| Docs `## Resilient validation` + `### Behavioral changes` | ✅ Implemented | README has exact heading + all three bullets incl. empty-`[]` truthiness caveat. |
| Exit gates (R4 a/b, doc grep) | ✅ Pass | Re-ran all three against `e8dc461`: no protected file changed, no new top-level export in client/config, no `internal` barrel in `index.ts`, README heading present. |

### Drift Report
**Out-of-scope changes:** None. `pipeline-run.json` is orchestration telemetry, not code.
`schemas.ts`/`result.ts`/`index.ts`/`validation.ts` untouched by Phase 2.
**Acceptable Phase 2 necessities:** new un-barrelled `src/internal/devicesEnvelope.ts`, the
`this.logger` field, the `MockAxios` `hasOwnProperty` hardening — all plan-mandated or plan-required.

### Notes
The phase remains faithful to the plan in letter and spirit; error shapes, log routing, cross-page
accumulation/discard semantics, and both off-path null-safety sites all match. Two small
test/documentation polish items remain, below. No behavioral or correctness defects found.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| implementation-auditor-r1-f1 | Low | Closed | Tests | `src/__tests__/devicesMethod.test.ts:224–243,409–422` | ratified: the non-object-body R5 branch is now covered in `strict` (`null` + HTML-string via `test.each`) and `warn` (`null`), asserting the malformed-envelope hard-fail + one `logger.error`, distinctly from the `off`-mode passthrough tests. Fully resolves the round-1 gap. | None — closed. |
| implementation-auditor-r2-f1 | Low | Open | Tests | `src/__tests__/devicesMethod.test.ts` (envelope cases) | R5 explicitly enumerates a third envelope-failure branch — an object with **`pageDetails` present but unparseable** (`PaginationDataSchema` requires `prevPageUrl`/`nextPageUrl` as `string\|null`, so e.g. `pageDetails: { nextPageUrl: 42 }` or `pageDetails` missing `nextPageUrl` hard-fails). Coverage now exists for "non-object body" (r1-f1) and "`devices` present-but-wrong-type" (`:195`), but the "unparseable `pageDetails`/`nextPageUrl`" branch — the one that guards the actual pagination cursor — has no direct strict/warn test even though the envelope schema does enforce it. | Add one `strict` case with a 200 object body whose `pageDetails.nextPageUrl` is a non-string/non-null (e.g. `42`) asserting `{ ok: false, error: { title: "Malformed devices page envelope" } }`, `error.detail` naming the `pageDetails.nextPageUrl` path, and one `logger.error`. Cheap; pins the last R5-enumerated branch. |
| implementation-auditor-r2-f2 | Low | Open | Docs | `README.md` (Behavioral changes, bullet 2) | The bullet wraps an inline code span across a soft break with the continuation ``"validation-error" } }` `` landing at column 0 (a lazy-continuation line), so the rendered inline code becomes `{ ok: false, error: { type: "validation-error" } }` only by CommonMark's lazy-continuation rule — fragile and hard to read/edit in source, and inconsistent with the cleanly-wrapped bullets 1 and 3. | Reflow so the `{ ok: false, error: { type: "validation-error" } }` code span sits on one line (or is indented under the list item), matching the other two bullets. Purely presentational; no behavior change. |
