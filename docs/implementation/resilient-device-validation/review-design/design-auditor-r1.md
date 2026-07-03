## design-auditor — round 1

Reviewed `design.md` against the actual package at `src/`. The problem is real and the
core decision (validate per-device, split envelope from item validation, thread the logger)
is sound and well-scoped — Non-Goals are tight, alternatives are genuine (not straw-manned),
requirements trace both directions, and the Tracking line (`#13`) is present. Current-state
claims are almost entirely accurate. The findings below concern three under-specified seams
where the design's "nothing else changes" framing overstates what actually stays the same.

### Current State Verification
| Claim | Status | Correction (if needed) |
|-------|--------|------------------------|
| `validate(schema, data, mode): T` is the single seam; `off` returns `data as T`, `strict` throws `ZodError`, `warn` calls `console.warn` and returns raw `data`; takes no logger | Verified | `src/validation.ts` matches exactly |
| `getAllPages` validates the whole page via `DevicesPageSchema` in try/catch; a `ZodError` returns `{ok:false, type:"validation-error"}` and aborts the walk, discarding collected items | Verified | `src/client.ts:55-62`; items collected so far are discarded on the early `return` |
| `getDeviceByUid` validates `DeviceSchema` in try/catch with same `ZodError`→`{ok:false}` handling | Verified | `src/client.ts:95-102` |
| `DeviceSchema` closed object; `patchManagement`/`antivirus`/`udf` required & non-nullable; closed enums for `deviceClass`, `patchStatus`, `antivirusStatus` | Verified (minor) | `antivirusStatus` is a closed enum but `.or(z.null())` (nullable); does not affect the design |
| `Result` `ok:true` branch already carries `warnings?: ProblemError[]`; `ProblemError` has `type/title/status` + optional `detail/errorCode/requestId/retryAfterMs/raw` | Verified | `src/result.ts` — no type change needed to carry rejections |
| `LoggerLike` has debug/info/warn/error; `config.logger` threaded into `HttpClient`; `defaultLogger = console`; validation path can't see the logger | Verified | `src/logger.ts`, `src/client.ts:27` |
| `config.validationMode` defaults to `"strict"`; `logger?`/`validationMode?` exist | Verified | `src/client.ts:18`, `src/config.ts` |
| `deviceSchema.test.ts` fixture validates unchanged (used as R4 guard) | Verified | file exists and asserts `validate(DeviceSchema, device, "strict")` round-trips |

### Design Completeness
Problem/Vision/Requirements/Decisions/Migration/Success/Risks all Complete. Two gaps
(Abstraction plumbing of the generic `getAllPages`; mode-gating of envelope validation) and
one internal inconsistency (`warn`-mode returned data vs. R8) are Partial — see findings.

## Findings

| ID | Severity | Status | Category | Where | Finding | Recommendation |
|----|----------|--------|----------|-------|---------|----------------|
| design-auditor-r1-f1 | Medium | Open | Abstraction | Key Concepts / "What Stays the Same" | `getAllPages<T,P>` is generic: today its `extractor: (page: P) => T[]` receives an already-**parsed** page and returns typed items (`client.ts:41,80`). The new per-item model needs the *raw* `unknown[]` (validated individually against a separately-threaded `DeviceSchema`). So the method must now take both an envelope schema and an item schema, and the extractor must return `unknown[]`, not `T[]`. Yet "What Stays the Same" lists "the extractor pattern" as unchanged. That is contradictory and leaves the central plumbing unspecified. | Specify the new `getAllPages` signature: envelope schema + per-item schema + a raw-item extractor (`(page) => unknown[]`), and how `validateItems`' `warnings`/`valid` are aggregated across pages into the final `{ok:true, value, warnings}`. Remove "the extractor pattern" from "What Stays the Same" or state precisely how its type changes. |
| design-auditor-r1-f2 | Medium | Open | DesignDecision | Per-item helper (`warn` branch) vs R8 / "What Stays the Same" | In `warn`, the helper returns valid items "parsed" and invalid items "raw". Zod `z.object` strips unknown keys on parse (confirmed by `deviceSchema.test.ts`'s exact `toEqual`). Today `warn` on a drifted page returns the **whole raw page** unparsed (`validate` returns `data as T` after `console.warn`), so extra/unknown fields survive. Under the new design, valid devices in a drifted page are now Zod-parsed and lose unknown keys. R8 claims `warn` changes "only log routing" and "all device data flows through" — this is a real returned-data change, not just log routing. | Either keep `warn` returning every item raw/unparsed (preserving the current passthrough contract), or amend R8, Migration/Breaking Changes, and "What Stays the Same" to state that in `warn` valid devices are now Zod-parsed (unknown keys stripped). Decide deliberately — `warn` is the documented drift workaround, so consumers may rely on raw passthrough. |
| design-auditor-r1-f3 | Medium | Open | Completeness | Decision 2 / R5 / R8 | The design never states whether envelope validation (R5's hard-fail) runs in `off` mode. Today `off` performs zero validation (`validate` returns `data as T`; pagination reads `data.pageDetails?.nextPageUrl` off the raw shape). If envelope validation now always runs, `off` gains a new hard-fail path on a malformed envelope, changing `off`'s "no validation" contract that R8 and "What Stays the Same" assert is preserved. If it does not run in `off`, R5's guarantee has a mode-shaped hole. | State explicitly whether envelope validation is mode-gated. If it always runs, note the `off`-mode behavioral change in R8/Breaking Changes; if it is skipped in `off`, scope R5 to `strict`/`warn` and say how `off` still safely reads `pageDetails`. |
| design-auditor-r1-f4 | Low | Open | Completeness | Decision 3 / Decision 4 (single-value `validate` in strict) | Decision 3 says the logger-aware `validate()` logs through `logger.warn` in `warn` and "in strict it still throws" — i.e. `validate()` does not log in `strict`. R7/Decision 4 require `getDeviceByUid` to emit a `logger.error` on a strict divergence. The error-level log for the single-value strict path is therefore the **caller's** responsibility, but this is only implied. If a Planner assumes `validate()` logs it, R7 goes unmet (or is double-logged). | State that the strict-path `logger.error` for `getDeviceByUid` is emitted in its catch block (not by `validate()`), and that `validate()` deliberately does not log in `strict`. |
