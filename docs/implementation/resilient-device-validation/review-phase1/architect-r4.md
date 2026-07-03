## architect — round 4

Code Review Mode, exhaustive. Round 4 in-progress review. Scope re-confirmed against `git diff main`:
the only production change is `src/validation.ts`; plus the unit test
`src/__tests__/validation.test.ts` and four pre-existing-drift fixture JSON files. No
barrelled/protected module is touched — `src/index.ts` still exports only
`client`/`config`/`result`/`schemas`, so the R4 public-surface guard holds and
`validateItems`/`toProblemError`/`firstIssuePath`/`VALIDATION_ERROR_*`/`VALIDATION_*_PREFIX` remain
genuinely non-public. `client.ts` imports only `validate`/`ValidationMode`, and its two call sites
(lines 56, 96) still pass 3 args — the new trailing optional `logger` param keeps them compiling, so
no breaking change.

### Disposition of prior architect findings

- **architect-r3-f1 (log-line prefix constants were module-private despite a `client.ts`-reuse claim)
  → Closed, ratified.** `reviser-r6` fixed it: `VALIDATION_WARN_PREFIX` and `VALIDATION_ERROR_PREFIX`
  are now `export const` (`src/validation.ts:17-18`), matching the already-exported
  `VALIDATION_ERROR_TYPE`/`VALIDATION_ERROR_STATUS` sibling pair, and the doc comment (lines 13-16) is
  updated to state plainly that the export exists so `client.ts`'s envelope hard-fail can import the
  same prefixes rather than hand-copy the literals. The single-source-of-truth seam Phase 2 depends on
  is now complete and internally consistent with the sibling type/status pair. Re-verified against
  source; no regression.
- **architect-r1-f1 / architect-r1-f2 / architect-r1-f3 → remain Closed** (ratified r2, re-verified
  r3; `firstIssuePath` centralization, `extractIdentity` honest-limitation doc, and
  `toProblemError`'s optional `identityOverride` are all still present and unchanged). Per
  carry-forward discipline these earlier-round closures are not re-listed below.

### New findings this round

None. A fresh end-to-end re-read of `src/validation.ts` against every "What You Must Evaluate" axis
surfaces no new structural issue, and the round-3 fix introduced no regression:

- **Ownership / layering:** the `ZodError → ProblemError` DTO construction (`toProblemError`), the
  path convention (`firstIssuePath`), and the shared type/status/prefix constants all sit at the
  validation boundary — the correct owner. Dependencies flow `validation.ts → result.ts` (pure types)
  and `→ logger.ts` (pure); no cycle, no cross-layer/deep import, no barrel leakage.
- **Data flow / side effects:** I/O (logging) is injected via `LoggerLike` and confined to the seams;
  pure partitioning inside. `validate`'s `strict` branch throws without logging (caller owns
  fatality); `validateItems` never throws in any mode (hoisted `Array.isArray` guard).
- **Reuse seam:** `entityLabel` injection + `identityOverride` + the now-fully-exported
  `firstIssuePath`/type/status/prefix constants give one consistent, greppable message and DTO shape
  across the single-value and array seams, with no domain-specific copy baked into the helper. The
  reuse contract Phase 2 builds on is coherent and importable end to end.
- **Public API / breaking changes:** `validate`'s new `logger` param is optional and trailing;
  existing 3-arg call sites in `client.ts` still compile. All other new exports are additive and off
  the barrel. No breaking change.
- **Performance:** single linear `forEach` + `safeParse` per element; no quadratic behavior, repeated
  work, or unbounded logging (one log line per divergent item).

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r3-f1 | Low | Closed | Architecture | `src/validation.ts:17-18` (`VALIDATION_WARN_PREFIX` / `VALIDATION_ERROR_PREFIX`) | Ratified: `reviser-r6` made both prefix constants `export const`, matching the exported `VALIDATION_ERROR_TYPE`/`_STATUS` pair, and updated the comment to confirm the export is for `client.ts`'s envelope-hard-fail reuse. The greppable-message convention is now a true importable single source of truth; Phase 2 no longer needs to hand-copy the literals. | No action. |
