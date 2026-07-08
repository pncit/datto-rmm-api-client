## design-auditor — round 3

Reconciled the two open round-2 findings against the revised design (both dispositioned `Fixed` in
`reviser-r2.md`), then hunted for new issues — with attention to consequences the round-1/round-2
fixes introduced.

Both round-2 fixes land and are ratified:

- **r2-f1** — R3 now names a dedicated `pageDetails` **override** schema modeling
  `nextPageUrl`/`prevPageUrl` as nullable strings and `count`/`totalCount` as present integers,
  enforced strictly on structure (missing/malformed throws `DattoValidationError`) while a `null`
  `nextPageUrl` is the ordinary terminal. The schema-override and `BaseResource`/`paginate` Key
  Concepts state the same. "Strict cursor" vs. "unmodeled nullability" is now consistent.
- **r2-f2** — R5 and the leniency Key Concept now state the emitted **response type** for a widened
  enum field is `EnumUnion | (string & {})`, so the compile-time contract matches the runtime one.

New issues this round center on the r1-f7 fix (making `src/generated/**` uncommitted): re-verified
against the `fuze-api` reference repo, that decision contradicts both the reference it cites and the
design's own verification method. Verified facts: `fuze-api` **commits** `src/generated/**` (its
`.gitignore` carries an explicit note — "src/generated/ IS committed since it's derived from an
external OpenAPI spec"; `git ls-files src/generated` lists the tracked files) and commits
`spec/openapi.json` + `spec/openapi-prev.json`; its Orval config uses the two targets the design
describes (axios/types + zod, `strict.response: false`).

## Findings

| ID | Severity | Status | Category | Where | Finding | Recommendation |
|----|----------|--------|----------|-------|---------|----------------|
| design-auditor-r2-f1 | High | Closed | Feasibility | — | ratified: R3, the schema-override Key Concept, and the `paginate`/`BaseResource` Key Concept now model `pageDetails` as a dedicated override — nullable `nextPageUrl`/`prevPageUrl`, present `count`/`totalCount`, strict on structure, `null` cursor = normal terminal. The strict-cursor / unmodeled-nullability contradiction is resolved. |
| design-auditor-r2-f2 | Medium | Closed | DesignDecision | — | ratified: R5 and the leniency Key Concept now widen the emitted response type to `EnumUnion \| (string & {})` so the compile-time type matches the widened runtime contract. |
| design-auditor-r3-f1 | High | Open | CurrentState | R15 (source "fuze-api pattern") / Success Criteria + Verification (`git diff of src/generated must be empty`) / Migration step 2 | The r1-f7 fix declares `src/generated/**` a **regenerated build artifact, not committed**, citing "fuze-api pattern" as R15's source. Verified against the reference: `fuze-api` does the **opposite** — it **commits** `src/generated/**` (its `.gitignore` states so explicitly; `git ls-files src/generated` lists them). So (a) R15's cited source is factually inverted, contradicting the Decision-1 convergence thesis, and (b) the design contradicts itself: the byte-for-byte reproducibility check — Success Criteria "reproduces `src/generated/**` byte-for-byte" and Verification "`npm run generate`; git diff of `src/generated` must be empty" — is **vacuous** when `src/generated` is gitignored, because `git diff` never reports untracked files. The criterion that guards regeneration correctness can never fail as written. It works in `fuze-api` precisely because generated output *is* committed. | Resolve the contradiction one way: either **commit `src/generated/**`** (mirroring `fuze-api`, so `git diff` is a real reproducibility gate) and correct R15/Migration accordingly, or keep it uncommitted and replace the verification with a method that does not rely on git tracking (e.g. generate into a temp dir and `diff` against a committed checksum/snapshot) — and drop the "fuze-api pattern" source claim for R15 since the reference commits generated output. |
| design-auditor-r3-f2 | Medium | Open | Feasibility | R4 (two Orval targets: types + `.zod.ts`) / R5 (emitted response type widened) / R15 ("generated output is never hand-edited") | The r2-f2 fix guarantees the *emitted TypeScript response type* for a widened enum field is `EnumUnion \| (string & {})`. But R4 generates the public **types** from a separate Orval axios/types target driven by the spec, which emits the **narrow** enum union — and R15 forbids hand-editing generated output. The design never says how the widened type is produced: the runtime widening lives in the hand-written `parseLenient` (dynamic, per-node), whereas the emitted type is static per field from the types target. As written, the guaranteed widened type cannot come from the narrow types target without an unstated mechanism, and cannot be achieved by editing generated files. | Name the mechanism: e.g. derive the public response types from `z.infer` of the override-wrapped zod schemas (which carry the `union(enum, string)` widening) rather than from Orval's types target, or specify an Orval `transformer`/output post-step that widens enum fields — in either case consistent with "never hand-edit generated." One sentence in R5/R4 or the leniency Key Concept resolves it. |
