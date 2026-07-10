## engineer — round 4 (design review)

Fourth engineer turn. My r1 (f1–f3), r2 (f1–f2), and r3 (f1) findings all landed across
the reviser rounds; I re-verified each against the live text this round — none re-opened.

- **engineer-r3-f1 (Resolved).** Decision 5 (design.md:187) now states the client
  **captures-and-stashes** the request payload + dispatch timestamp at the dispatch point
  "**independent of which of the three callbacks the consumer supplied**," names it "a
  client-internal step … not a side-effect of a consumer callback," and calls out the
  `onError`-only / `onResponse`-only consumer explicitly. Decision 4 rule 2 (:174) is
  reworded to gate the shared-instance `onError` on "an attempt that **reached dispatch** —
  i.e. whose per-attempt stash was written," no longer on "fired `onRequest`." The
  Cluster-J sub-rules (both named non-dispatched paths, the `!axios.isAxiosError`-guard
  placement, wire-status/post-2xx carve-outs) survive the reword untouched — only the gate's
  *expression* changed, per the triage chain-watch. A Success Criterion (:252) and a
  `npm test` assertion (:259) now carry the `onError`-only case into the plan.
- **engineer-r2-f1/f2, r1-f1/f2/f3 (Resolved, not re-opened).** Decision 4's rationale
  remains the single authoritative source; Non-Goals / Success-Criteria stay as pointers.

I then re-read once and ran three axes over the post-r5 text, honouring the triage
chain-watch (guard the reworded rule-2 gate against behavioral drift): (A) **rule-2 gate
content-equivalence** — the phrasing changed from "fired `onRequest`" to "reached dispatch
(stash written)" but the two genuinely non-dispatched paths, the guard placement, and the
wire-status selection are byte-for-byte the same behavior; verified equivalent. (B)
**capture-point feasibility, grounded in source** — I checked the specific claim at :187
that `onRequest` observes "after the auth/User-Agent/Content-Type headers are attached."
Grounded against `http-client.ts:341–348`: `Content-Type: application/json` and
`User-Agent` are set as **axios.create instance defaults**, so they are merged into the
config the observer request interceptor (registered first → runs last under LIFO, ahead of
the rate-limit interceptor at :350) reads — the captured header map does include them, and
the Bearer header (attached by the earlier-running `attachTo` interceptor) is present too.
The claim holds; no finding. (C) **export-count consistency for the r5 Option-A alias
export** — `DattoHttpHeaders` is now enumerated as the fifth public type at all three sites
(:95, :240, :258) and referenced in Key Concepts (:87, :89); grepped for any stray "four"
count — none survives. Consistent.

### Axis notes

- **(A) rule-2 reword is content-preserving.** Decision 4 (:171–177) still selects the
  terminal event by wire status for dispatched attempts, still excludes exactly the
  rate-limiter `acquire()` rejection and the Bearer-interceptor grant-failure `DattoApiError`
  as non-dispatched, still places `onError` after the `!axios.isAxiosError` guard, still
  carves out post-2xx failures incl. the grant malformed-token case. The r3-f1 remediation
  touched only the gate's wording — the invariant "one dispatched attempt ⇒ one terminal
  event" is intact.
- **(B) capture-point claim verified against source.** The one claim that could have been an
  axios-lifecycle trap (Content-Type on a JSON write is normally set during `transformRequest`,
  which runs *after* request interceptors) is safe here because the client sets Content-Type
  as an instance default, present in merged config at interceptor time. No finding.
- **(C) alias export is internally consistent.** Option A applied cleanly; the "five" count
  and the alias reference are reconciled across payload block, Key Concepts, Success Criteria,
  and Verification.

No new findings this round. The design is converged and, on the axes I own (feasibility,
correctness of the terminal-selection/stash mechanics, and prose economy), sound and
implementable as written. Selective, not exhaustive.

## Findings

| ID | Severity | Status | Category | Where | Finding | Recommendation |
|----|----------|--------|----------|-------|---------|----------------|
| — | — | — | — | — | No new findings. Prior engineer findings (r1 f1–f3, r2 f1–f2, r3 f1) all Resolved and re-verified against the live text; not re-opened. | None — no action required. |
