## implementation-auditor — round 2

Scope reviewed: the current Phase 4 working tree (`git diff` on `src/validation/schema-leniency.ts`,
`src/validation/diagnostics.ts`, `tests/unit/validation/schema-leniency.test.ts`,
`tests/unit/validation/diagnostics.test.ts`; `pipeline-run.json` is an orchestration artifact, not
code). Re-verified each of round 1's four findings against the code the reviser (`reviser-r1.md`)
marked `Fixed`, then hunted for regressions or new issues introduced by the changes.

### Disposition re-verification

- **f1 (`total` denominator for enveloped lists) — ratified.** `detectUnknownProperties` now takes a
  `collectionSize` parameter, threaded from `parseLenient` (seeded `1`), reset to `parsed.length`
  only when the walk enters an `array` node (`arraySize`), and passed unchanged through every other
  node type — including the `object`/`optional`/`nullable`/`union`/`record`/`pipe`/`default` recursions.
  `DiagnosticsCollector.record` accepts it as the 4th arg and stores it per group (`Math.max`), and
  `flush` emits each group's own `total`. For the enveloped shape `{ pageDetails, devices: [...848] }`
  a `devices[i].deviceClass` widening now reports `total: 848`, not `1`. The new test "reports total
  against the enclosing array's length for an enveloped list response" exercises exactly the design's
  canonical case (3 widened / 848 enveloped) and asserts `field: 'devices.deviceClass', count: 3,
  total: 848`; `diagnostics.test.ts` adds coverage for the `default 1` and `Math.max` behaviors. The
  count/total contract now holds against the dominant real shape.
- **f2 (logger gates leniency, not just diagnostics) — ratified.** `parseLenient`'s JSDoc now carries
  an explicit paragraph stating the `logger` argument gates null tolerance, presence tolerance, and
  enum degradation (delegating to strict `schema.safeParse` when absent), names it a behavioral gate
  rather than a diagnostics knob, and records the safe-in-practice caveat (Phase 6's `BaseResource`
  always injects the client logger). The finding's second half — a Phase-6 code change to guarantee a
  logger is always passed — correctly stays out of Phase 4 scope (no `BaseResource` exists yet); the
  reviser flagged it forward. Documentation is the load-bearing Phase-4 deliverable and is present.
- **f3 (`flush` not reusable at `warn`) — ratified.** `flush` no longer takes a logger object; it takes
  a plain `DiagnosticsSink` `(message, meta?) => void` and calls it once per group. `parseLenient`
  passes `(message, meta) => logger.debug(message, meta)`; Phase 6's `warn`-level drop path can reuse
  the class unmodified with a `warn` sink. The new test "supports a level-specific sink so callers can
  reuse flush at a different log level" proves `warn` (not `debug`) receives the call. This resolves
  the inaccurate "reusable without modification" claim by making it literally true, and is a cleaner
  outcome than the finding's suggested `level` parameter (the collector no longer knows log-level
  vocabulary).
- **f4 (union-discriminator invariant undocumented) — ratified.** A load-bearing comment now sits at
  `toLenientField` (`src/validation/schema-leniency.ts:68-75`): it records that blanket per-field
  `.nullable().optional()` relaxes a union branch's discriminator requiredness, states this is sound
  only while `src/generated/schemas/**` declares no `z.union` (verified today), and flags Phase 9's
  completeness audit to assert union-freedom so a future spec/override introducing a response union
  fails loudly. The actual Phase 9 assertion is correctly deferred (no Phase 9 file exists); the
  in-code record the finding asked for is present at the point the invariant matters.

### Drift / regression check on the round-2 changes
- No new out-of-scope changes: all edits stay under `src/validation/**` and its tests. No old-surface
  file touched.
- The `flush` signature change has exactly one caller (`parseLenient`); no dangling references.
- `LenientParseLogger` remains `debug`-only, consistent with `parseLenient`'s `debug` sink; the
  `warn`-reuse path lives only in the test, as intended for Phase 4.
- `collectionSize` is threaded through every recursive branch — verified none was missed (object,
  array, optional/nullable, both union recursions, record, pipe, default, and the enum leaf all pass
  it), so no branch silently reverts to the default `1`.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| implementation-auditor-r1-f1 | Medium | Closed | Completeness | `src/validation/schema-leniency.ts` (`detectUnknownProperties`, `parseLenient`), `src/validation/diagnostics.ts` (`record`/`flush`) | ratified: `collectionSize` is threaded from `parseLenient` and reset to `parsed.length` at each array node, stored per group and emitted per group's own `total`; the enveloped-list case now reports `total: 848` and is covered by a dedicated test asserting `count: 3, total: 848`. | — |
| implementation-auditor-r1-f2 | Medium | Closed | Design | `src/validation/schema-leniency.ts` (`parseLenient` JSDoc) | ratified: JSDoc now states explicitly that omitting `logger` skips null tolerance, presence tolerance, and enum degradation (strict `safeParse`), naming it a behavioral gate. The Phase-6 "always pass a logger" enforcement is correctly deferred to Phase 6 and flagged forward. | — |
| implementation-auditor-r1-f3 | Low | Closed | Design | `src/validation/diagnostics.ts` (`flush`), `src/validation/schema-leniency.ts` (`parseLenient`) | ratified: `flush` now takes a plain `(message, meta?) => void` sink, so Phase 6's `warn` drop path can reuse the collector unmodified; a test proves `warn` (not `debug`) receives the call. The "reusable without modification" claim is now accurate. | — |
| implementation-auditor-r1-f4 | Low | Closed | Design | `src/validation/schema-leniency.ts:68-75` (`toLenientField`) | ratified: an in-code invariant comment records that blanket field leniency relaxes union-discriminator requiredness, that it is sound only while `src/generated/schemas/**` is union-free, and flags Phase 9 to assert union-freedom. | — |

No open or new findings. The four round-1 findings are all genuinely resolved with meaningful tests;
the port stays faithful, `_zod.def` isolation holds, R20 message/`meta` discipline is intact, and no
regression or drift was introduced by the round-1 fixes. Phase 4 is converged.
