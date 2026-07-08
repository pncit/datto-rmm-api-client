## reviser — round 4

Disposition of the one open finding in `design-auditor-r4.md`. It is a genuine, in-scope feasibility
gap traceable directly to my own r3-f2 fix; `Fixed` by naming a mechanism that actually works — no
scope added.

| ID | Disposition | Rationale |
|----|-------------|-----------|
| design-auditor-r4-f2 | Fixed | Correct, verified defect in my r3-f2 fix. I named the production path for the widened response type as "an Orval `transformer` on the types target," but that mechanism cannot emit the output: Orval transformers operate on the OpenAPI spec/verb (JSON-Schema) model during generation, and the `EnumUnion \| (string & {})` open-enum idiom is TypeScript-only with no JSON-Schema representation (a spec enum widened with a string collapses to plain `string`, discarding the literals). Confirmed against the reference — `fuze-api` uses **no** Orval transformer; where it must rewrite generated output deterministically it runs a committed post-generate node script as step 2 of `npm run generate` (`"generate": "orval && node scripts/dedupe-generated-index.mjs"`, verified in the repo). Fixed by replacing the "Orval transformer" characterization in the leniency Key Concept with a **committed post-generate codemod** run as the second step of `npm run generate` (mirroring `fuze-api`'s `scripts/dedupe-generated-index.mjs`) that walks Orval's emitted types output and widens each response enum field — reproducible under R15, never a hand-edit — and adding the codemod step to R15's `npm run generate` sequence for consistency. The requirement/intent (a workable, reproducible widened-type path) is unchanged; only the named mechanism is corrected. Tightening only. |
