## mediator — round 1 (Mode A)

Artifact: `docs/implementation/full-api-surface/plan.md` (Phase 8). Both escalated findings are
Medium but land in the **Requirements Gap / Research Gap** category — defects in plan/design
artifacts the reviser does not own, needing a fact or authoring decision outside the code under
revision. Per the ruling boundary (only Medium/Low *judgment* disputes may be ruled; Requirements
and Research gaps are always human), both go to the human. I re-verified every disputed factual
claim against the working tree; all check out (see dossiers).

| ID | Decision | Ruling / question |
|----|----------|-------------------|
| implementation-auditor-r1-f2 | Human | Two Phase 8 exit-gate greps (`! git grep -qn "Result<" -- src/`, `! git grep -qn "validationMode" -- src/`) are unsatisfiable against correct code — they hit a third-party zod type name and a doc comment. Reword the gate commands and/or ratify the two residual matches as documented false positives in `plan.md`. Plan-artifact edit, not a code fix. |
| implementation-auditor-r1-f4 | Human | Plan Goal (`plan.md:531`) and design R1 assert "53 paths / **75** operations"; the committed `spec/openapi.json` has 53 paths / **57** operations and the client covers 57/57. Confirm whether the committed spec is the complete v2 surface or a truncated fetch, then correct the "75" figure (if complete) or re-run generation against a corrected spec (if truncated). Requires a fact the reviser cannot establish. |

---

### Dossier — implementation-auditor-r1-f2

**Dispute.** The auditor found (Medium, Plan Adherence → Requirements Gap) that two of Phase 8's own
exit-gate commands cannot pass even against correct code. The reviser agreed and escalated rather
than fix, on the grounds that the defect lives in `plan.md` (which the reviser does not own), not in
the code being revised. No prior human ruling exists for this round.

**Independent verification (this tree, after f1's fix landed):**
- `git grep -n "Result<" -- src/` → matches **only** `z.ZodSafeParseResult<...>` at
  `src/validation/schema-leniency.ts:807,812,819,828` (a third-party zod type name, unrelated to the
  retired `Result<T>` contract).
- `git grep -n "Result<" -- src/ | grep -v ZodSafeParseResult` → **empty (exit 1)**. The R9/R19
  intent (no `Result<T>`/`ProblemError` contract) is genuinely met.
- `git grep -n "validationMode" -- src/` → one match, `src/client/datto-client-config.ts:34`, a
  Phase-3 doc comment that documents the config schema *rejecting* `validationMode`.
- `src/docs/` no longer exists (f1's relocation of the stray `architect-r5.md` is real), so that file
  is no longer a `Result<` gate contributor.
- Gate text confirmed at `plan.md:580-581`.

So the finding is factually correct: as literally written, both gates fail on legitimate,
correct code. The phase's substantive R9/R19 requirement is nonetheless satisfied.

**Why human, not ruled.** Categorized Requirements Gap: the fix is an edit to a plan artifact
(`plan.md`) outside the reviser's remit, and it requires an authoring decision (how to reword the
greps vs. formally ratifying the two matches as false positives in the phase record) that is the
planner's call, not a judgment the mediator can substitute for the code owner.

**Recommendation to the human/planner.** Refine the two gate commands to word-boundary / value-line
greps that exclude `ZodSafeParseResult` and doc comments — e.g. `! git grep -qnw "Result" -- 'src/**/*.ts' | grep -v ZodSafeParseResult`
style, or scope to non-comment lines — so the gate tracks the code's actual (correct) state; and
record the two residual matches as ratified, documented false positives in the Phase 8 record. This
blocks only the *literal* gate text passing, not Phase 8's correctness.

---

### Dossier — implementation-auditor-r1-f4

**Dispute.** The auditor found (Medium, Requirements Gap) that the plan's Phase 8 Goal and the
design's Problem Statement / R1 assert "53 paths / **75** operations," while the committed spec and
the delivered client have **57** operations. R1's mechanical guarantee ("every committed-spec
operation reachable") holds, but the "75" figure is unreconciled: either the design number is stale,
or the committed spec is truncated (which would silently undercut R1's "entire v2 surface" promise).
The reviser re-verified the count and escalated, stating it cannot itself establish whether the
committed spec is complete (a live re-fetch needs egress to `*.centrastage.net` and cannot run
unattended).

**Independent verification (this tree):**
- Programmatic count of `spec/openapi.json` (every `paths[path][method]` over the standard HTTP verb
  set) → **53 paths / 57 operations**. Matches both the auditor's and reviser's counts.
- "75 operations" appears in the plan and design prose, not just once:
  `plan.md:22`, `plan.md:531`, `design.md:9,23,74 (R1),417,497`, plus process-artifact copies. The
  discrepancy is systemic across the requirement text, not a lone typo.
- The client's 57/57 coverage is mechanically guarded by `coverage-map.test.ts` (derives the spec
  set at test time, asserts duplicate-free set equality, drives each op to a nock intercept) — so the
  code's guarantee against the *committed* spec is sound regardless of the "75" question.

**Why human, not ruled.** Explicitly a Requirements Gap / Research Gap. The unresolved node is a
fact — is the committed spec the complete Datto v2 surface? — that neither the reviser nor the
mediator can establish without a live re-fetch (network egress unavailable). The two outcomes have
materially different fixes, one of which (truncated spec) could add operations Phase 8 never
implemented. This is squarely a human/planner decision.

**The fork the human must resolve:**
1. **Committed spec is complete** → the "75" figure is stale. Correct it to **57** in `design.md`
   (§Problem Statement, R1, and the §417/§497 prose) and `plan.md` (l.22, l.531, and the l.569
   "covers all 75 operations" claim). Requirements-Gap follow-up; Phase 8 stands.
2. **Committed spec is truncated** (relative to Datto's live `*.centrastage.net` v2 surface) → the
   fix is larger: re-fetch a corrected spec, re-run `npm run generate`, and re-scope Phase 8 (or a
   follow-on phase) to any newly surfaced operations. R1's "entire v2 surface" promise would not yet
   be met.

**Recommendation.** Confirm spec completeness against the authoritative Datto source, then take
branch 1 or 2. Until resolved, treat the "75" figure as unverified prose; it does not block Phase
8's own correctness against the committed spec, only the face-value trustworthiness of the "75"
number and R1's "entire v2 surface" claim.
