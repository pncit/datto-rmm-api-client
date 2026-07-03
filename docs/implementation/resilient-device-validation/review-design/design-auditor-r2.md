## design-auditor — round 2

Re-verified the reviser's four `Fixed` dispositions against the revised `design.md` and the actual
package (`src/client.ts`, `src/validation.ts`, `src/result.ts`, `src/schemas.ts`). All four fixes
land: the `getAllPages` plumbing is now specified with the new signature and per-page aggregation
(f1); `warn` now returns every item raw/unparsed so R8's passthrough holds (f2); envelope validation
is stated mode-gated, skipped in `off` (f3); and the strict single-value `logger.error` is assigned
to `getDeviceByUid`'s own catch, not `validate()` (f4). Those are closed below.

Re-verification surfaced two new inconsistencies that the f3 revision (scoping R5's hard-fail to
`strict`/`warn`) brought into focus: the design never says *how* an envelope hard-fail is produced in
`warn` mode, where the existing `validate()` seam does **not** throw — and R8's "only log routing
changes" claim is now inaccurate for `warn`, which gains a malformed-envelope hard-fail it did not
have before. Both are documented against the code below.

### Prior-finding re-verification
| ID | Reviser said | Verified in design | Result |
|----|--------------|--------------------|--------|
| r1-f1 | Fixed | "Generic `getAllPages` plumbing" (L96–97) gives signature `getAllPages<T,P>(envelopeSchema, itemSchema, extractor: (page)=>unknown[])` + per-page `valid`/`warnings` aggregation; "What Stays the Same" (L197) now states the extractor return type changes `T[]`→`unknown[]` | Closed |
| r1-f2 | Fixed | L112: `warn` returns every item **raw and unparsed**, running `DeviceSchema` only to detect divergence for logging; R8 passthrough (L46) genuinely preserved | Closed |
| r1-f3 | Fixed | Decision 2 (L134,136) + R5 (L43) + Success (L179) state envelope validation is mode-gated: runs in `strict`/`warn`, skipped in `off` (raw `pageDetails?.nextPageUrl` read best-effort) | Closed |
| r1-f4 | Fixed | Decision 4 (L153): strict-path `logger.error` emitted by `getDeviceByUid`'s own catch; `validate()` deliberately does not log in `strict`; per-item helper owns its own error logs | Closed |

## Findings

| ID | Severity | Status | Category | Where | Finding | Recommendation |
|----|----------|--------|----------|-------|---------|----------------|
| design-auditor-r1-f1 | Medium | Closed | Abstraction | Key Concepts / "What Stays the Same" | ratified: new `getAllPages` signature (envelope + per-item schema + `(page)=>unknown[]` extractor) and cross-page `valid`/`warnings` aggregation are now specified; "What Stays the Same" no longer claims the extractor pattern is unchanged. | — |
| design-auditor-r1-f2 | Medium | Closed | DesignDecision | Per-item helper (`warn` branch) | ratified: `warn` now returns every item raw/unparsed (Zod run only to detect divergence), so unknown keys survive and R8's passthrough contract is genuinely preserved. | — |
| design-auditor-r1-f3 | Medium | Closed | Completeness | Decision 2 / R5 / R8 | ratified: envelope validation is stated mode-gated (skipped in `off`); R5 scoped to `strict`/`warn`; `off`'s no-validation contract keeps no hard-fail hole. | — |
| design-auditor-r1-f4 | Low | Closed | Completeness | Decision 3 / Decision 4 | ratified: strict-path `logger.error` for `getDeviceByUid` assigned to its catch block; `validate()` explicitly does not log in `strict`; double-log ambiguity removed. | — |
| design-auditor-r2-f1 | Medium | Open | Completeness | Decision 2 / R5 / Key Concepts ("runs the envelope schema", L97) | R5 requires a malformed envelope to hard-fail with `{ok:false}` in **both** `strict` **and** `warn`. But the only validation seam the design describes, `validate(schema,data,mode,logger)`, does **not** throw in `warn` — today it `console.warn`s and returns the raw data (`src/validation.ts:20–22`), and the new logger-aware version keeps that `warn` semantics (L117). So the envelope check cannot be routed through `validate(envelopeSchema, page, mode)`: in `warn` that would log-and-passthrough a malformed page instead of hard-failing, silently violating R5. The design says `getAllPages` "runs the envelope schema" but never states the envelope check is a mode-independent hard-fail (a raw `safeParse` → `{ok:false}` within `strict`/`warn`) rather than the mode-sensitive `validate()`. A Planner wiring the envelope through `validate()` produces a warn-mode R5 hole. | State that envelope validation uses `safeParse` and hard-fails (`{ok:false, error:{type:"validation-error"}}`) on failure in both `strict` and `warn` — independent of the per-device mode behavior — and is skipped only in `off`; i.e. it is **not** the mode-branching `validate()` seam. One sentence in Decision 2 or "Generic `getAllPages` plumbing" closes it. |
| design-auditor-r2-f2 | Medium | Open | DesignDecision | R8 / Migration → Breaking Changes | R5 now (post-f3) makes `warn` hard-fail on a malformed envelope. Today `warn` does **not**: `validate(DevicesPageSchema,…,"warn")` logs and returns the raw page, and `extractor (p)=>p.devices ?? []` yields `{ok:true, value:[]}` on an unparseable envelope (`src/client.ts:56,63,80` + `src/validation.ts:21–22`). So `warn` gains a new `{ok:false}` failure path where it previously returned `{ok:true}`. Yet R8 (L46) asserts `warn` "preserve[s] their current returned-data contract … only log routing changes" — which is now inaccurate for the malformed-envelope case — and Breaking Changes (L166–168) calls out only the `strict` outcome-shape change, not this `warn` one. | Amend R8 to scope "only log routing changes" to the per-device path, and acknowledge that `warn` now hard-fails on a malformed envelope where it previously returned `{ok:true, value:[]}`; add that `warn`-mode note to Breaking Changes/release-notes alongside the `strict` change. This is a wording/consistency tightening — the hard-fail itself is the intended Decision 2 behavior, not a reversal. |
