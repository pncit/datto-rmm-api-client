## engineer — round 2

In-progress review. Prior turns: my `engineer-r1` (f1–f4, all `Fix` in `reviser-r5`) and the
architect-r1 / design-auditor / reviser lineage. I re-verify each of my four `Fix` claims against the
current design text, then scan the r5 revisions for newly-introduced engineering issues on my axes
(maintainability, abstraction, error/observability, DX, success-criteria concreteness). Design Review
Mode / restraint posture: round 2 should converge toward zero, and it does.

Re-verification of my r1 findings (all ratified → `Closed`):

- **f1 (brevity/duplication)** — Resolved. The `pageDetails` cursor override is now stated once
  canonically in R3; the schema-override Key Concept (l.247) and `BaseResource`/`paginate` Key Concept
  (l.278–279) reference "the R3 `pageDetails` override" rather than re-describing it. Enum-widening +
  post-generate codemod is canonical in the lenient-parsing Key Concept (l.249–266, trimmed to two
  paragraphs); Decision 2 (l.351) now points to it ("see the lenient-parsing Key Concept"). The
  reproducibility-gate thread is canonical in R15; the spec-patch Key Concept (l.239) and Migration
  step 2 defer to R15. Down to one canonical home + pointers per thread.
- **f2 (diagnostics volume & levels)** — Resolved. New "Leniency diagnostics volume & levels" Key
  Concept (l.267–273): events aggregated per page/call and deduped by `(context, field, value)`,
  benign strip/widen at `debug`, per-item drop at `warn`, and the per-row masker hot-path is explicitly
  ruled out.
- **f3 (type⇄runtime enum-widening alignment)** — Resolved. Success Criteria (l.502–504) adds a fixture
  carrying an unobserved enum value that both type-checks against the codemod-widened response type and
  survives `parseLenient` without drop, verifying build-time and runtime widening stay aligned.
- **f4 (device-namespace DX split)** — Resolved. R18 (l.91) and Success Criteria (l.511) commit the
  README to a namespace→endpoint map making the `account.devices()` (list) vs `devices.get(uid)`
  (single/mutate) split explicit; no alias added, matching the recommendation.

No new engineering issues. The r5 additions (rate-limit static table + request-descriptor path, single
logger-boundary masking decorator, sanitization script + CI scan, diagnostics aggregation) are each
sited in one place and consistent with the surrounding concepts; the requirement↔mechanism restatements
that remain (e.g. R20 vs the masking Key Concept) are the normal requirement/design split, not the
triplication f1 targeted, and I do not re-raise them under restraint posture.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | Medium | Closed | Brevity/Duplication | R3; leniency Key Concept; R15 (+ pointers at l.239, 247, 278, 351, Migration step 2) | Ratified. Each of the three duplicated threads (pageDetails cursor override, enum-widening/codemod, reproducibility gate) now has a single canonical home with the other sites referencing it by ID/name rather than re-describing it. | Closed — reviser fix verified in current text. |
| engineer-r1-f2 | Medium | Closed | Error/Observability | "Leniency diagnostics volume & levels" Key Concept (l.267–273) | Ratified. Diagnostics are aggregated/deduped per page/call rather than emitted per item, with a debug (benign strip/widen) vs warn (per-item drop) level split; the per-row masker hot-path is closed off. | Closed — reviser fix verified. |
| engineer-r1-f3 | Low | Closed | Success-criteria concreteness | Success Criteria (l.502–504) | Ratified. A verifiable criterion now covers the build-time widened type ⇄ runtime `parseLenient` widening alignment that R5 makes load-bearing. | Closed — reviser fix verified. |
| engineer-r1-f4 | Low | Closed | Developer experience | R18 (l.91); Success Criteria (l.511) | Ratified. The `account.devices()` vs `devices.get(uid)` namespace split is committed to a documented namespace→endpoint map rather than left surprising; no alias added. | Closed — reviser fix verified. |
