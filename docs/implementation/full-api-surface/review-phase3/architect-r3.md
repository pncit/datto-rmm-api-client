## architect — round 3

In-progress review of Phase 3 (error hierarchy, injectable UDF-masking logger, config). I read my
prior `architect-r1`/`architect-r2` turns and the reviser's `reviser-r2`/`reviser-r3` dispositions.
All three r1 findings were ratified `Closed` in r2 and are not re-listed. My two r2 findings were
both dispositioned `Fixed` by `reviser-r3`; I re-verified each against the current source and ratify
both (→ `Closed`):

- **architect-r2-f1** (no cycle/depth guard in `scrub` recursion) — `scrub`
  (`src/logging/mask.ts:69-93`) and `scrubEntries` (`:99-111`) now thread a `Set<object>` of live
  recursion ancestors: on entry to an array or plain object the value is added to `seen`, a re-seen
  ancestor short-circuits to `CIRCULAR_PLACEHOLDER` (`"[circular]"`), and the value is removed in a
  `finally` on exit so a benign shared (non-circular) reference reached via two branches is still
  walked in each — only a genuine ancestor cycle is suppressed. `scrubMeta` (`:122-124`) starts a
  fresh `seen` per top-level call. The realistic self-referential-`meta` crash on the mandatory
  logging boundary is eliminated. Ratified.
- **architect-r2-f2** (over-strong boundary-invariant docstring) — the `withUdfMasking` docstring
  (`src/logging/mask.ts:126-146`) no longer asserts the absolute "no call site … can leak an
  unmasked UDF value" claim. It now states the two true bounds — only `meta` (never the message)
  is scrubbed, and only plain-object/array structure inside `meta` is walked — and names the
  concrete residual risk (`DattoApiError#response` holds a raw wire body, so logging `{ err }` does
  not redact UDF values nested in `err.response`), directing call sites to extract needed fields as
  plain data. Accurately scoped. Ratified.

I also re-scanned the full Phase-3 surface this round for any remaining architectural issue —
`src/errors/{base-error,datto-api-error,datto-validation-error,index}.ts`,
`src/logging/{logger,mask}.ts`, `src/client/datto-client-config.ts`, `src/defaults.ts`: dependency
direction is downward and acyclic (`client → {defaults, logging, errors}`, `defaults` leaf), the
error hierarchy's boundary mapping (`fromAxiosError`) keeps raw-payload handling total and
non-throwing, the config schema's `strictObject` correctly rejects retired/unknown keys, and
`defaults.ts`'s layer-neutral homing rationale holds. No new findings.

All previously `Open` findings are now `Closed`; nothing carried `Open`, nothing escalated.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r2-f1 | Medium | Closed | Boundaries | `src/logging/mask.ts:69-124` | — | ratified: `scrub`/`scrubEntries` thread a `Set<object>` ancestor set (added on entry, removed on `finally`), short-circuiting a true cycle to `"[circular]"` while still walking benign shared references; `scrubMeta` starts a fresh set per call. The self-referential-`meta` `RangeError` crash on the mandatory logging boundary is fixed; regression tests present. |
| architect-r2-f2 | Low | Closed | Security | `src/logging/mask.ts:126-146` | — | ratified: docstring drops the absolute leak-proof claim and states the two real bounds (only `meta`, only plain-object/array structure), naming the `DattoApiError#response` residual-risk and directing call sites to pass plain data. Coverage now stated accurately. |
