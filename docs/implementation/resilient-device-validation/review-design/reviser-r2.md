## reviser — round 2

Disposition of the Open findings from `design-auditor-r2`. Both are genuine in-scope consistency
gaps that the round-1 f3 fix (scoping R5's hard-fail to `strict`/`warn`) surfaced at real seams; each
is Fixed by tightening the existing text (no scope added).

| ID | Disposition | Rationale |
|----|-------------|-----------|
| design-auditor-r2-f1 | Fixed | Stated in both "Generic `getAllPages` plumbing" and Decision 2 that envelope validation is a **direct `safeParse` hard-fail on the envelope schema**, deliberately *not* the mode-branching `validate()` seam (whose `warn` branch logs-and-passes-through and would let a malformed page slip past). The envelope check now explicitly returns `{ ok: false, error: { type: "validation-error" } }` identically in `strict` and `warn`, independent of the per-device mode. Closes the warn-mode R5 hole a Planner could otherwise wire by routing the envelope through `validate()`. |
| design-auditor-r2-f2 | Fixed | Scoped R8's "only log routing changes" claim to the **per-device path** and noted the one exception: per R5, `warn` now hard-fails on a malformed envelope where it previously returned `{ ok: true, value: [] }` (`off` runs no envelope check and is unaffected). Added this `warn`-mode envelope behavioral change to Breaking Changes as a second numbered release-note item alongside the existing `strict` outcome-shape change. Consistency tightening only — the hard-fail itself is the intended Decision 2 behavior. |
