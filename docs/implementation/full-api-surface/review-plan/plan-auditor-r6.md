## plan-auditor — round 6

Re-verified the two `Open` findings from `plan-auditor-r5.md` (`r5-f1`, `r5-f2`) against the current
`full-api-surface/plan.md` by direct reading, and confirmed the reviser's edits against the sibling
`../fuze-api` repo and the design. Both are genuinely resolved → Closed (ratified). All earlier
findings (r1-f1..f7, r2-f1..f4, r3-f1..f2, r4-f1) were ratified Closed in prior rounds and are **not**
re-listed here (carry-forward discipline); none regressed on re-read of the relevant sections. Then
hunted for new issues across the newly-inserted Phase 2 dedupe step, the schema-overrides rename, the
design R-ID coverage, toolchain wiring, and phase ordering — **no new finding raised**.

Re-verification detail:
- **r5-f1** (dropped dedupe step) — Now fully ported. `npm run generate` (line 60) is
  `patch-spec → orval → dedupe-generated-index → widen-response-enums`; the created-in-Phase-2 note
  (line 61) states the pipeline order/rationale (dedupe runs after Orval, before the enum widen scans
  `src/generated/types/**`). Phase 2 Step 3 (line 151) "Port the generated-index dedupe step" copies
  `fuze-api`'s `scripts/dedupe-generated-index.mjs` near-verbatim (only `GENERATED_INDEX_PATH`
  re-pointed) — matching the sibling script I inspected (strips a trailing `.js` extension, dedupes
  `export` lines, preserves non-export lines, idempotent). A unit test
  `tests/generated/dedupe-index.test.ts` (line 189) asserts duplicate removal / non-export preservation
  / no-op second pass, and Step 6 reproducibility (line 159) confirms dedupe idempotence. Phase 2 steps
  renumbered 1–6 cleanly; no stale Phase 2 step cross-reference remains (the only "see Step 2" at line
  582 is intra-Phase-9). `tests/generated/dedupe-index.test.ts` matches the vitest `include` glob.
- **r5-f2** (module name divergence) — Fully renamed to the design's name. Zero residual
  `spec-overrides` occurrences; `src/schema-overrides/` now appears in the coexistence rule (line 38),
  the never-hand-edit note (line 39), the Phase 6 goal (line 387), Step 3 (line 396), the Files line
  (line 401), and the test path (line 427). The design consistently names it `src/schema-overrides.ts`
  (design lines 219/240/470). Phase 6 Step 3 adds the clarification that the module overrides the
  **generated zod schemas** *after* generation and must not be confused with Phase 2's
  `scripts/patch-spec.mjs` (spec correction *before* generation) — removing the misleading "spec" label.

### Design alignment (spot re-check)
All twenty R-IDs (R1–R20) remain claimed by at least one phase's `**Requirements:**` line and the
claiming phases' steps deliver them; the alignment established in r1 still holds. No requirement-coverage
gap and no new deviation introduced by the r5 edits.

## Findings

| ID | Severity | Status | Category | Finding | Recommendation / update |
|----|----------|--------|----------|---------|-------------------------|
| plan-auditor-r5-f1 | Medium | Closed | Consistency | — | ratified: the dropped `fuze-api` dedupe step is ported back. `npm run generate` (line 60) now runs `patch-spec → orval → dedupe-generated-index → widen-response-enums`; Phase 2 Step 3 (line 151) copies `scripts/dedupe-generated-index.mjs` near-verbatim (matches the sibling script), a `tests/generated/dedupe-index.test.ts` unit test guards it, and Step 6 reproducibility confirms idempotence. Phase 2 renumbered cleanly with no stale cross-refs. |
| plan-auditor-r5-f2 | Low | Closed | Consistency | — | ratified: module renamed to the design's `src/schema-overrides/` name across all six references (zero residual `spec-overrides`), and Phase 6 Step 3 adds a note clarifying it overrides the generated zod schemas *after* generation — distinct from Phase 2's `patch-spec.mjs`, removing the misleading "spec" label. |

### Carry-forward ledger (prior rounds, all ratified Closed — not re-tabulated)
- r1: f1 (primitive-name clash), f2 (R10 mis-claim), f3 (prose-only gates), f4 (`DEFAULT_TOKEN_REFRESH_PCT`), f5 (coverage-map inventory), f6 (mask non-string udf), f7 (`@types/node` align).
- r2: f1 (`DEFAULT_RETRY` / strict sub-objects), f2 (enum-widen discrimination rule), f3 (`axiosInstance` dead-config removed), f4 (residual prose-only gates).
- r3: f1 (paginate rate-descriptor), f2 (403 ip-block vs forbidden).
- r4: f1 (dangling `mediator-hardstop-r1.md` citation removed; Phase 9 secret-scanner removal upheld per human ruling).
