## reviser — round 4

Addressed the single `Open` finding from `plan-auditor-r4.md`. Also recorded the human ruling that
Phase 9's secret-scanner was rightly removed (it was a bad idea to begin with) — the plan already
reflects that removal, and this round only cleans up the now-dangling justification pointer.

| ID | Disposition | Rationale |
|----|-------------|-----------|
| plan-auditor-r4-f1 | Fixed | Phase 9 Step 2 (line 549) no longer cites the missing `review-plan/mediator-hardstop-r1.md`. Reworded the "No automated secret detector/scanner" rationale to drop the dangling file reference while keeping the substantive, self-standing justification: the heuristic is unreliable (false-positives on the OpenAPI prose / OAuth structural keys, false-negatives on novel shapes) so a content-scanning gate adds churn without a dependable guarantee, and the at-rest protection instead rests on the deterministic key-based sanitizer, commit-time human review, and the benign existing fixtures. Human ruling recorded: the Phase 9 secret-scanner was correctly removed as a bad idea, which the plan already reflects. |
