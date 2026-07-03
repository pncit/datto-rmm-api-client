## reviser — round 1

Disposition of the Open findings from `design-auditor-r1`. All four are genuine in-scope
under-specifications at real seams; each is Fixed by tightening the design (no scope added).

| ID | Disposition | Rationale |
|----|-------------|-----------|
| design-auditor-r1-f1 | Fixed | Added a "Generic `getAllPages` plumbing" concept specifying the new signature (envelope schema + per-item schema + `extractor: (page) => unknown[]`) and the per-page aggregation of `valid`/`warnings` into the final `{ ok: true, value, warnings }`. Corrected "What Stays the Same" so it no longer claims the extractor pattern is unchanged — it now states the return type changes from `T[]` to `unknown[]`. Contradiction resolved. |
| design-auditor-r1-f2 | Fixed | Made a deliberate decision: in `warn` the helper returns every item **raw and unparsed**, running `DeviceSchema` only to detect divergence for logging, never to reshape the value. This preserves the current passthrough contract exactly (unknown keys survive), so R8's "only log routing changes" stays accurate. No amendment to R8/Breaking Changes was needed since the passthrough contract is now genuinely preserved. |
| design-auditor-r1-f3 | Fixed | Stated explicitly that envelope validation is **mode-gated**: it runs in `strict`/`warn` and is skipped in `off`, which reads `pageDetails?.nextPageUrl` best-effort and passes `devices` raw as today. Scoped R5 to `strict`/`warn` and updated Decision 2, R5, and the Success Criteria so `off`'s "no validation" contract keeps no hard-fail hole. |
| design-auditor-r1-f4 | Fixed | Clarified in Decision 4 that the strict-path `logger.error` for `getDeviceByUid` is emitted in its own `catch` block, not by `validate()`, and that `validate()` deliberately does not log in `strict` (it throws). Noted the per-item helper owns its own error logs because it does not throw. Prevents the double-log / unmet-R7 ambiguity a Planner could otherwise hit. |
