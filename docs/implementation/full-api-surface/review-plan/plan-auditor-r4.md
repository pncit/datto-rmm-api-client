## plan-auditor — round 4

Re-verified the two round-3 `Open` findings against the current `full-api-surface/plan.md` by direct
reading (not on the reviser's word). Both are genuinely fixed. The round-1 (7) and round-2 (4)
findings were ratified Closed in earlier rounds and are **not** re-listed here (carry-forward
discipline). Then hunted for new issues; one new Low raised — a dangling reference.

Re-verification notes on the round-3 fixes:
- **r3-f1** — Phase 6 Step 2 prose now **requires** `paginate` to "attach an explicit
  `{ kind: 'read' }` `RateDescriptor` on each page's axios config (via the same `rateDescriptor`
  property the `http*` primitives use)" (line 391), and the example replaces the placeholder comment
  with the real attach: `this.axios.get(url, { params: p, rateDescriptor: { kind: 'read' } })`
  (line 410). Phase 5 Step 3 now defines the interceptor's behavior when no descriptor is present —
  "defaults to `{ kind: 'read' }` … an untagged request is never sent unthrottled and `acquire` is
  never called with `undefined`" (line 337). The `paginate.test.ts` case asserts `limiter.acquire`
  is called with `{ kind: 'read' }` per page fetched (line 423). The highest-volume read path can no
  longer bypass the limiter; R11 holds.
- **r3-f2** — the blanket-`ip-block` labeling is narrowed. Phase 3 Step 1 types
  `code?: 'ip-block' | 'forbidden'` on `DattoApiError` (line 218). Phase 5 Step 3 + example classify
  `'ip-block'` **only** when the 403 carries a rate/block indicator via the documented
  `isRateLimitBlock(response)` predicate (Retry-After header or a rate-limit/block message in the
  body), otherwise `'forbidden'`; both are surfaced without retry with the raw `response`
  body/headers always attached so consumers can disambiguate (lines 337, 355–361). The Phase 5
  http-client test covers both branches (line 366), Phase 10 README documents the ip-block/forbidden
  distinction (line 591), and the wire-marker confirmation is listed under Deferred Validation
  (line 623). R12 satisfied without mislabeling ordinary authorization failures.

## Findings

| ID | Severity | Status | Category | Finding | Recommendation / update |
|----|----------|--------|----------|---------|-------------------------|
| plan-auditor-r3-f1 | Medium | Closed | Consistency | — | ratified: Phase 6 Step 2 now requires `paginate` to attach an explicit `{ kind: 'read' }` `RateDescriptor` per page (prose line 391 + example line 410); Phase 5 Step 3 defaults an absent descriptor to `{ kind: 'read' }` (line 337); `paginate.test.ts` asserts the read window is consumed once per page (line 423). The primary paginated read path no longer bypasses the limiter. |
| plan-auditor-r3-f2 | Low | Closed | DesignAlignment | — | ratified: 403 classification narrowed to `code?: 'ip-block' \| 'forbidden'` (Phase 3 Step 1 line 218) via the `isRateLimitBlock(response)` predicate (Phase 5 Step 3 + example, lines 337/355–361); both surfaced without retry with the raw `response` attached; Phase 5 test covers both branches (line 366), README documents the distinction (line 591), wire-marker confirmation deferred (line 623). |
| plan-auditor-r4-f1 | Low | Open | Consistency | Phase 9 Step 2's "No automated secret detector/scanner" rationale (line 549) cites `review-plan/mediator-hardstop-r1.md` as evidence that an earlier secret-scanner attempt "drove the plan-review loop through seven non-converging rounds." That file does not exist in the review directory (only `plan-auditor-r1..r3.md` and `reviser-r1..r3.md` are present). The plan thus cites a missing artifact as support for a design decision — a reader or implementor who follows the pointer to understand *why* the scanner was rejected finds nothing, weakening the stated justification. | Either restore/commit the referenced `mediator-hardstop-r1.md` if it is meant to be a durable record, or reword line 549 to drop the specific dangling file citation (keep the substantive rationale — key-based sanitizer + commit-time review + benign existing fixtures — which stands on its own without the missing reference). |
