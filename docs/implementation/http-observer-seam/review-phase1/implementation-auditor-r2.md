## implementation-auditor — round 2

Reconciled the three round-1 findings (all `Remediate` per triage-r1, all dispositioned `Fixed` by
reviser-r1) against the current working tree, re-ran every Phase 1 exit gate, and then swept the
full Phase 1 surface for new issues.

### Reconciliation of round-1 findings

- **implementation-auditor-r1-f1 (High, PlanAdherence).** `observerCallbackSchema` no longer uses the
  wrapping `z.function({ input:[z.any()], output: z.void() })` form. It is now
  `z.custom<(event: never) => unknown>((value) => typeof value === "function").optional()`
  (`src/http/http-observer.ts:120-122`). Verified empirically against the installed `zod@4.4.3`:
  `dattoHttpObserverSchema.parse({ onRequest }).onRequest === onRequest` is **true** (raw pass-through
  restored, R9), a value-returning parsed callback **no longer throws** at invocation (so the
  spurious per-attempt `warn` and R7 breakage are gone), an `async` parsed callback is returned as a
  plain function so `invokeObserver`'s `.then(undefined, …)` handler receives the thenable (no
  unhandled rejection, R7), and a non-function is still rejected. `.strictObject`/`.optional()` and
  the unknown-key/non-function rejections are preserved. The doc comment (`:103-119`) now explains why
  the `z.function`/`dattoLoggerSchema` form is incompatible instead of claiming to mirror it, and the
  deviation is recorded in `implementation-phase1-notes.md` §5. `dattoLoggerSchema` untouched, per the
  triage scope boundary. Ratified.
- **implementation-auditor-r1-f2 (Medium, Tests).** New `describe("invokeObserver on a schema-parsed
  callback (R7 regression — f1/f2)")` block in `tests/unit/http/observer.test.ts:188-252` obtains
  callbacks **through** `dattoHttpObserverSchema.parse(...)` (not hand-built raw `fn`) and asserts:
  a value-returning parsed callback logs zero `warn`; a parsed async-rejecting callback yields zero
  `unhandledRejection` (monitored via a real `process.on("unhandledRejection", …)` listener) and
  exactly one `warn` naming `onResponse`; and `parse({ onRequest }).onRequest` is `toBe`-identity to
  the input. These exercise the real wired path and would fail against the old wrapping schema.
  Ratified.
- **implementation-auditor-r1-f3 (Low, Tests).** `tests/unit/client/config.test.ts:69-70` now asserts
  identity (`expect(received).toHaveLength(1); expect(received[0]).toBe(rawEvent)`) rather than
  structural `toEqual`, pinning that parsing neither clones the payload nor substitutes the callback.
  Ratified.

### Exit-gate re-verification (all pass)

`npm run typecheck` clean (src/test/tools); `npm test` 558/558 across 39 files; `npm run build`
clean. `dist/index.d.ts` contains `DattoHttpObserver`, has **0** `declare module`, and leaks neither
`ObserverCapture` nor `__dattoObserverCapture`. `src/http/http-observer.ts` is axios-free
(`from 'axios'` and `\bAxios[A-Z]` both 0). `src/http/observer.ts` is not re-exported from
`src/index.ts`. No existing test regressed.

### New-issue sweep

Re-read all Phase 1 artifacts (`http-observer.ts`, `observer.ts`, `axios-augment.d.ts`,
`datto-client-config.ts`, `index.ts`, `surface-pin.ts`, both test files). All five steps land as
specified, the seven helper primitives match their pinned signatures, the stash augment sits on both
request-config interfaces, and no Phase 2/3/4 transport wiring or unrelated refactor leaked in
(diff limited to the five expected source/test files plus bookkeeping notes/pipeline JSON). No new
defect found.

### Drift Report
**Out-of-scope changes:** None.
**Acceptable Phase 1 necessities:** None beyond the round-1 remediation to the schema, its doc
comment, the two test files, and the §5 deviation note.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| implementation-auditor-r1-f1 | High | Closed | PlanAdherence | — | — | ratified: `observerCallbackSchema` replaced with a non-wrapping `z.custom` shape-only validator; verified `parse` returns the consumer's function by identity, value-returning/async callbacks no longer throw at invocation, R7/R9 restored, non-function still rejected. |
| implementation-auditor-r1-f2 | Medium | Closed | Tests | — | — | ratified: schema-parsed R7 regression tests added (value-returning ⇒ no warn; async-rejecting ⇒ zero unhandled rejections + one attributed warn; parse identity), exercising the real wired path. |
| implementation-auditor-r1-f3 | Low | Closed | Tests | — | — | ratified: config round-trip now asserts `toBe` identity of the delivered payload, pinning raw non-cloning delivery. |
