## plan-auditor — round 5

Re-verified the single round-4 `Open` finding (`plan-auditor-r4-f1`) against the current
`full-api-surface/plan.md` by direct reading — it is genuinely fixed. All earlier findings
(r1-f1..f7, r2-f1..f4, r3-f1, r3-f2) were ratified Closed in prior rounds and are **not** re-listed
here (carry-forward discipline); none regressed on re-read of the relevant plan sections. Then hunted
for new issues against the design and the ported `fuze-api` toolchain (inspected directly): two new
findings raised — one Medium (a dropped step in the faithfully-ported generation pipeline) and one
Low (a module-name divergence from the design).

Re-verification note on the round-4 fix:
- **r4-f1** — Phase 9 Step 2 (line 549) no longer cites the missing
  `review-plan/mediator-hardstop-r1.md`. The "No automated secret *detector*/scanner" rationale now
  stands on its own terms — the heuristic is unreliable (false-positives on the OpenAPI prose / OAuth
  structural keys, false-negatives on novel shapes) and the at-rest guarantee rests on the
  deterministic key-based sanitizer, commit-time review, and the benign existing fixtures. No
  dangling artifact reference remains; the human ruling (scanner rightly removed) is honored.

### Design alignment (spot re-check)
All twenty R-IDs remain claimed by at least one phase; the alignment table from r1 still holds. New
findings below are pipeline/consistency issues, not requirement-coverage gaps.

## Findings

| ID | Severity | Status | Category | Finding | Recommendation / update |
|----|----------|--------|----------|---------|-------------------------|
| plan-auditor-r4-f1 | Low | Closed | Consistency | — | ratified: Phase 9 Step 2 (line 549) reworded to drop the missing `mediator-hardstop-r1.md` citation while keeping the self-standing key-based-sanitizer + commit-time-review + benign-fixtures rationale; human ruling (scanner correctly removed) honored. |
| plan-auditor-r5-f1 | Medium | Open | Consistency | The plan's `npm run generate` (Phase 1 Step 2, line 60) is `node scripts/patch-spec.mjs && orval && node scripts/widen-response-enums.mjs` — it **substitutes** the response-enum codemod for `fuze-api`'s post-generate step but **drops the dedupe step entirely**. Verified in the sibling repo: `fuze-api`'s `generate` is `orval && node scripts/dedupe-generated-index.mjs`, and that committed script exists precisely because "Orval **sometimes generates duplicate export lines** (e.g., both `.ts` and `.js` extensions)" in `src/generated/types/index.ts`. The plan copies `fuze-api`'s Orval config essentially verbatim (same `mode:'tags-split'`, same `schemas:'./src/generated/types'`, same two-target axios+zod shape), so the identical generator is very likely to emit the same duplicate-export index for the Datto surface. The plan even lists `scripts/dedupe-generated-index.mjs` in its own Repo Context as a "post-generate codemod precedent," yet neither ports it nor justifies its omission — a deviation from the plan's own "Port, don't reinvent / keep the copies faithful" rule. Impact: a duplicated `src/generated/types/index.ts` would either trip Phase 2's `npm run lint` gate (duplicate export / `no-duplicate-imports`) or ship duplicate re-exports into the committed generated output; the enum-widening codemod does not address index dedupe. | Either add the ported `dedupe-generated-index.mjs` back into the `generate` pipeline (e.g. `patch-spec → orval → dedupe-generated-index → widen-response-enums`, with the dedupe step running before or after the widen step, and note the pipeline order in Phase 2), or state explicitly in Phase 2 why Datto's generation does **not** produce the duplicate-index `fuze-api` had to dedupe (and back that claim by a Phase 2 gate/test on `src/generated/types/index.ts`). |
| plan-auditor-r5-f2 | Low | Open | Consistency | The design names the hand-maintained reconciliation module `src/schema-overrides.ts` consistently (design lines 219, 240, 246, 471: "**Schema-override module** (`src/schema-overrides.ts`, R8)"). The plan renames it to a directory `src/spec-overrides/` (coexistence rule line 38; Phase 6 Step 3 line 393; `src/spec-overrides/index.ts` + split files). Two concerns: (a) an unremarked divergence from a design-named artifact, and (b) the chosen name "**spec**-overrides" is misleading — this module overrides the **generated zod schemas** (`udfSchema`, `alertContextSchema`, `pageDetailsSchema`, write-body required marks), whereas the actual **spec**-level correction lives separately in Phase 2's `patch-spec.mjs`. Calling the schema-override module "spec-overrides" invites an implementor to conflate it with the Phase 2 spec-patch mechanism. The design's "schema-overrides" name is the accurate one. | Rename the module to align with the design (`src/schema-overrides/` or `src/schema-overrides.ts`), or add a one-line note in Phase 6 Step 3 explaining the deliberate rename and clarifying it overrides generated schemas (not the spec) so it is not confused with Phase 2's `patch-spec.mjs`. |

### Carry-forward ledger (prior rounds, all ratified Closed — not re-tabulated)
- r1: f1 (High, primitive-name clash), f2 (R10 mis-claim), f3 (prose-only gates), f4 (`DEFAULT_TOKEN_REFRESH_PCT`), f5 (coverage-map inventory), f6 (mask non-string udf), f7 (`@types/node` align).
- r2: f1 (`DEFAULT_RETRY` / strict sub-objects), f2 (enum-widen discrimination rule), f3 (`axiosInstance` dead-config removed), f4 (residual prose-only gates).
- r3: f1 (paginate rate-descriptor), f2 (403 ip-block vs forbidden).
