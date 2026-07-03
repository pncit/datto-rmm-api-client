## architect — round 2

Code Review Mode, exhaustive. Round 2 in-progress review. Scope: Phase 1 diff vs `main` — the
production change remains confined to `src/validation.ts`; the test file
`src/__tests__/validation.test.ts`; and four pre-existing-drift fixture JSON files corrected in
`reviser-r3`. No protected barrelled module (`schemas.ts`/`result.ts`/`index.ts`/`client.ts`) was
touched — verified against the diff — so R4's public-surface guard still holds and
`validateItems`/`toProblemError`/`firstIssuePath`/`VALIDATION_ERROR_*` remain genuinely non-public
(barrel exports only `client`/`config`/`result`/`schemas`).

### Disposition of my round-1 findings (all reported `Fixed` by reviser-r4 — re-verified against source)

- **architect-r1-f1 (firstIssuePath duplication) → Closed, ratified.** `firstIssuePath(error:
  ZodError): string` now exists as a single exported helper in `src/validation.ts` and is called
  from both `validate()`'s `warn` branch and `toProblemError()`; the inline
  `issues[0]?.path?.join(".") || "(root)"` and its `"(root)"` sentinel appear in exactly one place.
  The seam Phase 2's envelope hard-fail can import is established. Resolved.
- **architect-r1-f2 (extractIdentity leaky-abstraction / dishonest "generic" claim) → Closed,
  ratified.** `extractIdentity` now carries a doc comment stating plainly that identity extraction
  is best-effort and limited to the `id`/`uid` conventions, that any other key falls back to
  `index N`, and that a differently-keyed caller should pass `identityOverride` rather than rely on
  discovery. The reuse boundary is now honest about what is and isn't injectable. Resolved.
- **architect-r1-f3 (array-centric builder can't carry a caller-known identity) → Closed,
  ratified.** `toProblemError` gained an optional trailing `identityOverride?: string`, used
  verbatim when present (`identityOverride ?? extractIdentity(item) ?? \`index ${index}\``). The
  change is additive — the sole current call site (`validateItems`) is unaffected — and lets Phase
  2's single-value `getDeviceByUid` inject its known uid instead of emitting `index 0`. Resolved.

### New findings this round

None. A fresh end-to-end re-read of `src/validation.ts` against all "What You Must Evaluate" axes
surfaces no new structural issue:

- **Ownership / layering:** the `ZodError → ProblemError` DTO construction (`toProblemError`) and
  the path convention (`firstIssuePath`) sit at the validation boundary, the correct owner. Deps
  flow `validation.ts → result.ts` (pure types) and `validation.ts → logger.ts` (pure); no cycle,
  no cross-layer/deep import, no barrel leakage.
- **Data flow / side effects:** I/O (logging) is injected via `LoggerLike` and confined to the
  seams; pure partitioning inside. `validate()`'s `strict` branch deliberately throws without
  logging (caller owns fatality); `validateItems()` never throws — the hoisted `Array.isArray`
  guard now makes "Never throws" unconditionally true across all three modes, matching the JSDoc.
- **Reuse seam:** `entityLabel` injection + `identityOverride` + shared `firstIssuePath`/prefix
  constants give one consistent, greppable message and DTO shape across the single-value and array
  seams, with no domain-specific copy baked into the helper — the reuse contract Phase 2 builds on
  is coherent.
- **Public API / breaking changes:** `validate()`'s new `logger` param is optional and trailing —
  existing 3-arg call sites still compile (pinned by a dedicated test). All other new exports are
  additive and off the barrel. No breaking change.
- **Performance:** single linear `forEach` + `safeParse` per element; no quadratic behavior,
  repeated work, or unbounded logging (one log line per divergent item).
- **Tests:** the previously-flagged coverage asymmetries are closed — the `uid=` identity branch
  and the no-logger `validateItems` overload are now both exercised, alongside the non-array
  guard in every mode.

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | Low | Closed | Architecture | `src/validation.ts` (`firstIssuePath`, `validate` warn, `toProblemError`) | Ratified: the first-issue-path computation and its `"(root)"` sentinel are now centralized in the exported `firstIssuePath` helper and called from both prior sites; Phase 2's envelope path can import it rather than hand-copy a third time. | No action. |
| architect-r1-f2 | Low | Closed | Architecture | `src/validation.ts` (`extractIdentity`) | Ratified: doc comment now states the `id`/`uid`-only, best-effort limitation and directs differently-keyed callers to `identityOverride`, making the "generic reuse" claim honest. | No action. |
| architect-r1-f3 | Low | Closed | PublicAPI | `src/validation.ts` (`toProblemError` signature) | Ratified: optional trailing `identityOverride?: string` added and threaded ahead of `extractIdentity`/`index` fallback; additive, current call site unaffected, lets a single-value caller inject a known identity. | No action. |
