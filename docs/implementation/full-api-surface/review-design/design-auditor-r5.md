## design-auditor — round 5

Reconciled the one open round-4 finding (`design-auditor-r4-f2`, dispositioned `Fixed` in
`reviser-r4.md`) against the current design, then hunted for new issues with attention to the
mechanism the r4 fix introduced. No prior finding is silently dropped: all earlier-round findings
(`r1-f1…f7`, `r2-f1`, `r2-f2`, `r3-f1`, and the `r3-f2`→`r4-f2` lineage) are accounted for — every one
prior to r4-f2 was already `Closed` and is not re-listed.

**r4-f2 lands and is ratified.** The r3-f2/r4-f2 lineage flagged that the named production path for
the widened response type ("an Orval `transformer` on the types target") could not emit the
`EnumUnion | (string & {})` open-enum idiom. The design now names a **committed post-generate
codemod** run as step 2 of `npm run generate` (leniency Key Concept + R15's generate sequence),
"exactly the pattern `fuze-api` establishes." Verified against the reference repo:
`fuze-api/package.json:48` is `"generate": "orval && node scripts/dedupe-generated-index.mjs"` and
`scripts/dedupe-generated-index.mjs` exists — a committed node post-generate rewrite of Orval output.
The mechanism is feasible and reproducible under R15 (a script, re-derived byte-for-byte on
regeneration, never a hand-edit). The "Orval transformer" characterization is gone.

**Probed and cleared (no finding).** I tested whether the codemod can widen *response* enum fields
without leaking into *request* bodies (which R6/Decision 2 keep strict), since — unlike `parseLenient`,
which is response-only by call site — a static codemod has no runtime request/response separation.
Verified against Orval's actual emission model in `fuze-api/src/generated/types/`: Orval emits one
enum type **per schema+field** (`ticketStatus.ts`, `serviceTicketCreateStatus.ts`,
`caseMemberStatus.ts`, `projectTicketStatusId.ts`, …), not a single shared alias — so response-model
enum types are distinct files/types from request-body enum types and the codemod can scope widening to
response types. The concern is factually unfounded; raising it would misdescribe the toolchain.

No new actionable, non-deferrable issue survives verification this round. Every requirement traces
both directions, the `Tracking:` line is present (`None`, explicit), the spec-pipeline and codegen
mechanisms are grounded in the reference repo, and the response-leniency / cursor-strictness /
enum-widening interactions are internally consistent. The design has converged.

## Findings

| ID | Severity | Status | Category | Where | Finding | Recommendation |
|----|----------|--------|----------|-------|---------|----------------|
| design-auditor-r4-f2 | Medium | Closed | Feasibility | — | ratified: the widened-response-type production path is now a **committed post-generate codemod** run as step 2 of `npm run generate` (leniency Key Concept + R15), replacing the infeasible "Orval transformer" characterization. Verified against the reference — `fuze-api/package.json:48` is `"generate": "orval && node scripts/dedupe-generated-index.mjs"` and `scripts/dedupe-generated-index.mjs` exists — so the pattern is real, feasible, and reproducible under R15 (a script, not a hand-edit). Orval's per-schema+field enum emission (confirmed in `fuze-api/src/generated/types/`) lets the codemod widen response enum types without touching request-body enum types, keeping R6's strict-request-enums guarantee intact. |
