## reviser — round 4 (design revision)

Applied Cluster J (triage-r4) as a structure-only edit to Decision 4 and its
satellite sites. No rule changed; all four load-bearing sub-rules survive the
restructure (verified against chain-watch): (1) observer request-interceptor
registered first → runs last (Decision 5, cross-referenced from Decision 4
Rationale); (2) `onError` placed after the `!axios.isAxiosError` guard, gated on
stash-exists (Decision block rule 2); (3) grant `onResponse` fired before
`safeParse` (Decision 4 Rationale); (4) terminal selection by wire status
(Decision block rule 1). The two named non-dispatched paths remain in Decision
block rule 2. Verification (`:254`) kept intact.

| ID | Disposition | Rationale |
|----|-------------|-----------|
| architect-r2-f1 | Fix | In-scope tightening. Moved the gate rule out of the ~600-word Rationale into a scannable three-item list in Decision 4's **Decision** block (dispatched wire-status; non-dispatched stash-gate + the two named paths + `!isAxiosError`-guard placement; post-2xx carve-out). Trimmed the Rationale to *why* only, stating the "already fired `onResponse`" invariant once and cross-referencing. No content dropped. |
| engineer-r2-f1 | Fix | Same defect, Clarity axis — folds into the same restructure. The four fused arguments now split along their natural seams: honest-type and retried-attempt cost stay in the Rationale; wire-status, the non-dispatched gate, and the post-2xx carve-out lead as scannable Decision-block rules; the grant fire-`onResponse`-before-`safeParse` ordering kept as a one-line Rationale pointer. Placement rule now leads its own bullet, no longer buried. |
| engineer-r2-f2 | Fix | In-scope duplication removal. Decision 4 is now the single authoritative source; Non-Goals (`:32`) and the two Success-Criteria bullets (`:245–246`) reduced to short "(see Decision 4)" pointers with the re-derived mechanism prose cut. Verification (`:254`) retains its concrete test-assertion wording for traceability, as the triage directs. |
