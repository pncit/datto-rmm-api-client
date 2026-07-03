## architect — round 1

Reviewing `design.md` on the architecture axis (boundaries, coupling, abstraction fit,
over-length) — a different lens from the design-auditor thread, which has already converged on
completeness/consistency (r1–r3, all Closed). I did not re-litigate those; I read for structural
coherence and for text bloat accreted across the three revision rounds.

The core structure is sound and I want to state that plainly: splitting **envelope validation**
(protocol, hard-fail) from **per-item validation** (drift, mode-scoped) is the right seam, the
`Result.warnings[]` reuse avoids a type change, and threading `config.logger` into the validation
layer closes a genuine observability gap without widening any public surface. The two findings
below are refinements — one on duplication/over-length, one on where `ValidationMode` semantics
now live — not objections to the design.

## Findings

| ID | Severity | Status | Category | Where | Finding | Recommendation |
|----|----------|--------|----------|-------|---------|----------------|
| architect-r1-f1 | Low | Open | Over-length | Key Concepts L97 / Decision 2 L132–136 / R5 L43 / R8 L46 / Breaking Changes L171 / Success L182 | The single point that emerged from the r2 revisions — "envelope validation is a **direct `safeParse` hard-fail**, deliberately *not* the mode-branching `validate()` seam, returning `{ok:false, type:validation-error}` identically in strict/warn, skipped in off" — is now restated in near-identical prose in six places. Each revision round appended another copy rather than pointing at the canonical one. This is multi-source-of-truth for a single decision: a future edit to the envelope semantics must be made consistently in six spots, and a reader can't tell which is authoritative. The same over-statement affects the mode-gating narrative (runs strict/warn, skipped in off) restated in R5, R8, Decision 2, and Success. | Make **Decision 2** the single normative statement of the envelope hard-fail + mode-gating. Reduce the other five to one-clause references ("per Decision 2, …") — R5/R8 keep the requirement, drop the mechanism re-explanation; Success/Key Concepts assert the observable outcome only. Net effect is a shorter, more maintainable doc with one place to change. |
| architect-r1-f2 | Low | Open | Coupling | Key Concepts (`validate()` L116–117, per-item helper L99–115, envelope safeParse L97/L134) | `ValidationMode` semantics are now encoded at **three** independent sites: `validate()` (single value: off→cast, warn→log+raw, strict→throw), the per-item helper (array: off→cast, warn→log+raw, strict→drop+log+collect), and the envelope path in `getAllPages` (strict/warn→hard-fail, off→skip). The three disagree on control flow *by design* (throw vs. partition vs. hard-fail), so full consolidation isn't warranted — but the design never names these as the authoritative mode-decision sites, so a maintainer adding or shifting a mode (the Non-Goals forbid a *new* mode, but the enums/behaviors can still move) has three scattered branch points to keep in lockstep, with no doc anchor tying them together. | Add one sentence (Overview or Decision 3) naming these three as the only places `ValidationMode` is interpreted and stating that each mode's meaning must stay consistent across them. Cheaper than restructuring, and it converts an implicit coupling into a documented invariant a Planner/maintainer can hold. |
| architect-r1-f3 | Low | Open | Abstraction | Decision 2 L134 ("reads `pageDetails?.nextPageUrl` best-effort off the raw page") vs. Key Concepts L97 (envelope-parsed `pageDetails`) | Pagination's `nextPageUrl` is sourced two different ways depending on mode: in strict/warn it comes from the envelope-`safeParse`d page; in off it's read best-effort off the raw object. So `getAllPages` now has two internal control paths through what was one loop, and the extractor (`(page)=>unknown[]`, items only) does not cover `pageDetails` — leaving *how the loop obtains `pageDetails` per mode* implied rather than specified. This is an abstraction seam the plumbing description (r1-f1's fix) stopped just short of. | State in "Generic `getAllPages` plumbing" that `pageDetails.nextPageUrl` is read from the envelope-parse result in strict/warn and directly off the raw page in off, i.e. it is not carried by the item extractor. One clause removes the ambiguity about the loop's two paths without adding design. |

### Notes (not findings)
- Non-Goals, alternatives, and requirement traceability are strong; I found nothing to add there.
- The `validate()` / `validateItems()` split (single-value throw-seam vs. array partition-seam) is a
  justified two-function boundary, not accidental duplication — they have genuinely different
  contracts. No finding.
