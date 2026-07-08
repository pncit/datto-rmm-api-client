## design-auditor — round 4

Reconciled the two open round-3 findings against the revised design (both dispositioned `Fixed` in
`reviser-r3.md`), then hunted for new issues — with attention to the mechanism the r3-f2 fix
introduced. No prior finding is silently dropped; all earlier-round findings (`r1-f1…f7`, `r2-f1`,
`r2-f2`, `r3-f1`) are already `Closed` and are not re-listed.

**r3-f1 lands and is ratified.** Re-verified against the reference repo and the current design:
`fuze-api` commits its generated output (`.gitignore:61` — "src/generated/ IS committed since it's
derived from an external OpenAPI spec"; `git ls-files src/generated` lists the tracked files). The
design now mirrors this — R15 commits `src/generated/**` (patched spec stays an uncommitted transient
intermediate), Migration step 2 commits generated output, and the Current State `fuze-api` note records
the tracked-because-external rationale. The `git diff of src/generated must be empty` gate is now a
real reproducibility check, and R15's "fuze-api pattern" source is factually correct.

**r3-f2 does not fully land — kept `Open`.** The r3-f2 fix named a mechanism, but the named mechanism
is not capable of producing the guaranteed type. Verified against the reference and Orval's model
(see finding). The requirement/intent is sound and unchanged; only the production path named to
satisfy r3-f2 is wrong, so the underlying concern (a *workable*, reproducible path for the widened
response type) is not yet resolved. This is r3-f2's first reviser↔reviewer round-trip, the point is
factual (not a subjective tradeoff), and a concrete correct path exists in the reference repo — so it
is kept `Open` with counter-evidence rather than escalated.

## Findings

| ID | Severity | Status | Category | Where | Finding | Recommendation |
|----|----------|--------|----------|-------|---------|----------------|
| design-auditor-r3-f1 | High | Closed | CurrentState | — | ratified: R15 now commits `src/generated/**` (mirroring `fuze-api`, verified via `.gitignore:61` and `git ls-files src/generated`), the patched spec stays an uncommitted transient intermediate, Migration step 2 commits generated output, and the Current State note records the tracked-because-external rationale — so the `git diff` reproducibility gate has teeth and the R15 source claim is correct. |
| design-auditor-r3-f2 | Medium | Open | Feasibility | Lenient-parsing Key Concept ("an Orval `transformer` on the types target ... rewrites every response enum field to the widened `EnumUnion \| (string & {})` form") / R5 / R15 | The r3-f2 fix named the production path as **"an Orval `transformer` on the types target,"** but that mechanism cannot produce the stated output, on two grounds verified against the reference and Orval's model. (1) Orval's `transformer` hooks operate on the OpenAPI **spec/verb model** (JSON-Schema) *during* generation, not on the emitted TypeScript text; and the `EnumUnion \| (string & {})` "open-enum" idiom is a **TypeScript-only** type expression with **no JSON-Schema representation** — a spec-level enum widened with a string collapses to plain `string`, discarding the literal members, which is the opposite of the intended `union-of-literals + string` type. So no spec/verb transformer can emit `X \| (string & {})`. (2) The reference (`fuze-api`) uses **no** Orval transformer at all; where it must rewrite generated output deterministically it runs a **committed post-generate node script** as the second step of `npm run generate` (`"generate": "orval && node scripts/dedupe-generated-index.mjs"`). The design's own phrasing is internally split — "post-generate ... applied once across the generated output" (a codemod) vs. "an Orval `transformer`" (an in-generation hook). As written a Planner following it literally hits a dead end. | Correct the named mechanism to a feasible one consistent with R15 ("deterministic, reproducible, never hand-edited"): either (a) a **committed post-generate TS codemod** run as step 2 of `npm run generate` — exactly the pattern `fuze-api`'s `scripts/dedupe-generated-index.mjs` establishes — that rewrites response enum fields to `EnumUnion \| (string & {})` across the emitted output; or (b) **derive the public response types from `z.infer`** of the override-wrapped zod schemas (which already carry the `union(enum, string)` widening), so the widened type falls out of the schema layer with no separate rewrite. Drop the "Orval `transformer` on the types target" characterization in the leniency Key Concept / R5, since Orval transformers cannot express the idiom. |
