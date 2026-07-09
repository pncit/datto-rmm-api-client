## implementation-auditor — round 1

Scope reviewed: the Phase 4 working-tree additions (`git status` shows only new, untracked
`src/validation/` and `tests/unit/validation/`; `pipeline-run.json` is an orchestration artifact, not
code). Cross-checked against `plan.md` Phase 4, `design.md` (R5/R7/R20), the ported
`../fuze-api/src/validation/schema-leniency.ts`, the generated schemas under `src/generated/`, the
committed fixtures, and the implementor's phase-4 notes.

### Phase Coverage Checklist
| Step | Status | Notes |
|------|--------|-------|
| 1 — Port `schema-leniency.ts` + export `enumFieldPaths` | ✅ Implemented | Faithful port; `_zod.def` access stays isolated to this one file; `enumFieldPaths` reuses the same walk and is exported. |
| 2 — Enum degradation on the recursive walk | ✅ Implemented | `addCatchallRecursive` `'enum'` case widens to `z.enum(values).or(z.string())`; `detectUnknownProperties` `'enum'` case detects out-of-set members against the *original* schema. Request path untouched (never calls `parseLenient`). |
| 2 (folded) — null/absent leniency on any response field | ✅ Implemented | `toLenientField` (`.nullable().optional()`) applied to every named object field at every depth. Not its own numbered step; correctly derived from the Goal/Tests text. |
| 3 — Aggregated, leveled diagnostics | ⚠️ Partial | `DiagnosticsCollector` dedupes/summarizes and emits one `debug` line per group; but the `total` denominator misreports for the dominant enveloped-list response shape (f1), and the collector is not actually reusable at `warn` for the Phase-6 drop path as the notes claim (f3). |

### Drift Report
**Out-of-scope changes:** None. No old-surface file was touched; all new code lands under the new
`src/validation/` path per the coexistence rule.
**Acceptable Phase-4 necessities:** `src/validation/diagnostics.ts` split out from `schema-leniency.ts`
(the plan's Files line explicitly permits this "if the collector is non-trivial").

### Notes on faithfulness / correctness verified
- Enum widening never drops the item; the `rmmnetworkdevice`/`quantumdevice` regression cases are
  covered and pass through.
- No `z.union` exists anywhere in `src/generated/schemas/**` (verified by grep), so the deviation in
  §5.3 of the notes (blanket leniency relaxing union-discriminator requiredness) is inert today — see
  f4 for the one residual action.
- R20 boundary honored: both diagnostic messages are static text; every wire value rides in `meta`.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| implementation-auditor-r1-f1 | Medium | Open | Completeness | `src/validation/schema-leniency.ts:541` (`parseLenient`), `src/validation/diagnostics.ts:84` (`flush`) | `total = Array.isArray(result.data) ? result.data.length : 1` only yields a meaningful denominator when the top-level parsed value is an array. But every Datto list response is an **enveloped object** `{ pageDetails: {...}, devices: [...] }` (confirmed: `pageDetails` appears across `src/generated/schemas/**` and in `src/__tests__/fixtures/devicesPage.json`), so `result.data` is an object → `total` collapses to `1`. For the design's own canonical case (3 widened `deviceClass` values across 848 devices) the emitted line is `{ field: 'devices.deviceClass', count: 3, total: 1 }` — `count` exceeds `total`, and the "3/848" denominator the design promises is unattainable. Every aggregation test uses a top-level array (`total: 50`, `total: 4`), so this dominant real shape is untested. | Derive `total` from the collection actually walked (e.g. track the largest array length encountered during `detectUnknownProperties`, keyed to the diagnostic's array node) rather than from the top-level shape; or pin the contract that callers hand `parseLenient` the array itself and have Phase 6's `validateArrayResponse` extract `devices`/list before calling — and add an enveloped-list test so the `count/total` relationship is exercised against the real shape. |
| implementation-auditor-r1-f2 | Medium | Open | Design | `src/validation/schema-leniency.ts:527-529` (no-logger fast path), JSDoc at `:501-520` | The no-logger fast path runs `schema.safeParse(data)` on the *unmodified strict* schema, so nullability tolerance **and** enum degradation are silently skipped when no logger is passed. That couples a load-bearing R5/R7 correctness feature to an optional *diagnostics* argument: called without a logger, a response carrying an undocumented enum member hard-fails validation (in Phase 6 → thrown `DattoValidationError`) — exactly the failure R5's degradation exists to prevent. The JSDoc advertises the leniency behaviors unconditionally, giving no hint they evaporate without a logger. (Mitigated in practice only because the wired client always injects a default logger — but `parseLenient` is a standalone exported primitive.) | Document the coupling explicitly in the JSDoc ("leniency — null tolerance, enum degradation, unknown-key strip — is applied only when a `logger` is provided; otherwise a strict `safeParse` runs"), and ensure Phase 6 always passes the client's (always-present) logger into every `parseLenient` call so no response path ever hits the strict fast path. |
| implementation-auditor-r1-f3 | Low | Open | Design | `src/validation/diagnostics.ts:84-98` (`flush`) | `flush` hardcodes `logger.debug(...)`, but the plan (Phase 4 Step 3) states the R7 per-item **drop** path is "aggregated the same way" at **`warn`**, and the phase notes (§9, Extensibility 9.5) claim Phase 6 can reuse this collector "without modification." That claim is inaccurate: a `warn`-level drop summary cannot reuse `flush` as written without editing this phase's code to introduce a level. | Either parameterize the emit level (e.g. `flush(logger, context, total, level: 'debug' | 'warn' = 'debug')` and widen the `DiagnosticsLogger` type accordingly) so Phase 6's drop aggregation genuinely reuses it, or correct the notes' "without modification" claim to reflect that Phase 6 will extend `flush`. |
| implementation-auditor-r1-f4 | Low | Open | Design | `src/validation/schema-leniency.ts:64-66` (`toLenientField`), `:94-103` (object case) | Blanket `.nullable().optional()` on every field makes a union branch's own discriminator no longer required by the permissive parse, so a payload matching no branch's real shape now succeeds against the first (effectively all-optional) branch instead of failing (documented in notes §5.3, and the ported union-failure test was changed to match). This is safe *only while no response schema contains a union* — true today (verified: zero `z.union` in `src/generated/schemas/**`) but not guaranteed after a spec refresh or a Phase-6 hand-written override introduces one. There is no in-code guard or comment recording this invariant at the point where it matters. | Add a short comment at `toLenientField`/the object case recording that blanket field leniency intentionally relaxes union-discriminator requiredness and is sound only while response schemas contain no unions, and flag (for Phase 9's schema audit) an assertion that `src/generated/schemas/**` emits no `z.union` — so the invariant fails loudly if a future spec introduces one rather than silently mis-matching branches. |

No other issues found: the port is faithful, scope is clean, `_zod.def` isolation holds, R20 message/`meta`
discipline is correct, and the enum-degradation / null-tolerance behaviors are covered by meaningful tests.
