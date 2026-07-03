## architect — round 2

Re-entered on the architecture axis (boundaries, coupling, abstraction fit, over-length). I
re-verified my three round-1 findings against the revised `design.md`, ruled on the reviser's one
rejection, and did a fresh selective pass for any *new* structural issue. The design-auditor
(r1–r3) and engineer (r1) threads have converged and their fixes landed; I did not re-litigate
them. The core seam — envelope validation (protocol, hard-fail) vs. per-item validation (drift,
mode-scoped), with `Result.warnings[]` reuse and `config.logger` threaded in — remains sound.

## Findings

| ID | Severity | Status | Category | Where | Finding | Recommendation |
|----|----------|--------|----------|-------|---------|----------------|
| architect-r2-f1 | Low | Closed | Over-length | Decision 2 L132–136; R5 L43; R8 L46; Breaking Changes L171; Success L182 | Carries forward architect-r1-f1. Verified: the envelope hard-fail *mechanism* ("direct `safeParse`, deliberately not the mode-branching `validate()` seam") is now stated once, normatively, in Decision 2. The "Generic `getAllPages` plumbing" concept references it ("validates the envelope per Decision 2") without re-explaining. R5/R8/Breaking Changes/Success now carry only their requirement or observable-outcome statements — the residual restatements are section-appropriate (requirement row, breaking-note, success assertion), not duplicated mechanism. Single source of truth restored. | None — resolved. |
| architect-r2-f2 | Low | Closed | Coupling | Overview / Decision 3 | Carries forward architect-r1-f2, which the reviser (r3) Rejected. I accept the rejection. The finding was a request for an *additive* meta-invariant sentence naming the three `ValidationMode` interpretation sites (`validate()`, the per-item helper, the envelope path); the reviser correctly notes each site is already singly and fully specified where it belongs, Non-Goal 4 bounds the surface a maintainer could shift, and the point never made the design wrong. Not worth re-asserting at convergence; prefer not adding prose. | None — accepted as rejected. |
| architect-r2-f3 | Low | Closed | Abstraction | Key Concepts L97 | Carries forward architect-r1-f3. Verified: the plumbing concept now states `pageDetails.nextPageUrl` is read from the envelope-parse result in `strict`/`warn` and directly off the raw page in `off`, and is not carried by the item extractor. The two internal control paths through the walk are now explicit. | None — resolved. |

### Notes (not findings)
- Fresh selective pass surfaced no new architecture issue. The `extractor: (page: P) => unknown[]`
  signature nominally types `page` as the envelope-parsed `P`, while `off` skips the envelope parse
  and reads the raw page — a latent seam, but the design already specifies `off`'s raw-passthrough
  behavior explicitly (L97, L134) and this is Planner-level cast detail, not a design gap. Not a
  finding.
- The `valid: T[]` field of the per-item helper holds raw-cast `unknown` in `warn`/`off` — consistent
  with the pre-existing `off` cast-through in `validate()`, and deliberate per the L112 passthrough
  rationale. No finding.
- No objection to the design. From the architecture lens it has converged.
