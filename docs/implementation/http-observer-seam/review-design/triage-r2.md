# Mediator — Round Triage r2 (design stage)

Reviewers assimilated: `design-auditor-r2` (sole reviewer). The auditor read its
r1 turn, the reviser's r1 dispositions, and triage-r1, then re-verified all five
r1 findings against the current `design.md` and the source. It marks **f1–f5
Closed/ratified** and raises **one new finding**, `design-auditor-r2-f1`
(Medium, Open, DesignDecision). Only that one finding is open this round.

Settled-and-ratified (no route row needed): `design-auditor-r1-f1..f5` — all
routed `Remediate` in r1, all fixed by the reviser, all now Closed by the
auditor. I spot-confirmed the fixes are live in `design.md` (Decision 5 ¶
interceptor-order + capture-and-stash at :173/:175; R5 two-case rewrite at :45;
Success Criteria at :229–231; grant Basic-header caveat at :179/:100).

The artifact under review is the design itself, so the one open finding's prose
remedy is a direct edit to `design.md` — no upstream doc to amend, hence an
untagged route (never `Design Change:` on the design stage).

## Route table

| ID | Route | Detail |
|----|-------|--------|
| design-auditor-r2-f1 | Remediate | Cluster D. Verified against `src/auth/auth-manager.ts:134–178`: after a **2xx** grant POST, `performRefresh` runs `tokenResponseSchema.safeParse(response.data)` and, on a malformed body, throws a `DattoApiError` with `statusCode: response.status` (the 2xx) — **not** a `DattoValidationError`, and not covered by Decision 4's `BaseResource`/`DattoValidationError` carve-out. Under the terminal-event invariant (Key Concepts: exactly one of `onResponse`/`onError` per attempt, selected by HTTP status) this 2xx attempt must fire `onResponse` with the raw token-response body, and the post-2xx `DattoApiError` must **not** fire `onError`. Real gap: a Planner wrapping the whole `performRefresh` `try` and firing `onError` from any throw would make a malformed-2xx grant emit `onError` (or a double terminal). Medium, non-gap DesignDecision, recommendation sound → Remediate. |

One open finding, valid, folded into the plan below. No Challenge (the finding
is correct and its mechanism checks out). No Ruled (the recommendation needs no
binding correction or redirection — the reviser applies it directly). No Human
(Medium, not a Requirements/Research gap, not High/Critical/Blocker).

## Remediation plan (root-cause-first)

### Cluster D — Post-2xx grant failure not mapped onto the terminal-event rule (design-auditor-r2-f1)
**Root cause.** Decision 4 defines the terminal-event selection ("`onResponse`
for 2xx, `onError` for everything else — one terminal event per attempt") and
enumerates exactly one post-exchange, non-firing failure: `DattoValidationError`
raised in `BaseResource` after a successful 2xx. But the grant path has a
second, structurally identical post-2xx failure that Decision 4 never names: the
malformed-token `DattoApiError` thrown by `performRefresh` *after* a 2xx token
POST. Because it is a `DattoApiError` (not a `DattoValidationError`) and lives in
`AuthManager` (not `BaseResource`), it falls outside the stated carve-out, so the
design does not say which terminal event that attempt fires — and the naive
`performRefresh` instrumentation (wrap the whole method's `try`, fire `onError`
on any throw) would fire `onError` on a 2xx attempt, breaking the invariant.

**Scope of edit (design.md — direct edit, this is the design stage):**
- **Tighten Decision 4** (do not add a new section, per the reviewer): state that
  each attempt's terminal event is selected by the **HTTP status of the physical
  response**, not by whether the surrounding method (`performRefresh`,
  `BaseResource.paginate`) later throws. Add the grant's post-2xx malformed-token
  `DattoApiError` as a second, explicitly-named instance of the same carve-out
  already granted to `DattoValidationError`: a 2xx grant with a malformed token
  body fires `onResponse` (carrying the raw 2xx token-response body), and the
  subsequent `DattoApiError` is **not** an `onError`.
- Keep the framing consistent with Key Concepts' "Terminal event" bullet and
  Decision 3 (one terminal per attempt, selected on 2xx-vs-not) so all three
  agree that selection is by wire status, not by control-flow throw.
- **Non-Goals:** add the grant malformed-2xx case to the "Observing non-HTTP
  failures" bullet (design.md:32) alongside the existing `DattoValidationError`
  and pagination-guard exclusions, so the non-firing set is stated in one place.
- This dovetails with Decision 5's existing rule that the grant path
  captures-and-stashes at its own dispatch point in `performRefresh`: the
  instrumentation there must fire `onResponse` off the resolved 2xx **before**
  `safeParse` runs, so the post-parse throw cannot re-enter a terminal event.

**Verification.** Add a Verification/test-matrix entry: a grant POST that returns
2xx with a **malformed** token body fires exactly one terminal event —
`onResponse` with the raw response body — and does **not** fire `onError`, even
though `performRefresh` throws a `DattoApiError`. Pair it with the existing
"grant invokes the observer" and "terminal event carries the stashed request
fields" criteria so the grant's success/terminal semantics are pinned end to end.

## Chain watch

- **Cluster D is a binding constraint on the grant instrumentation, not just
  prose.** Once the design says "grant terminal event selected by HTTP status of
  the token POST," the plan and implementation must instrument `performRefresh`
  so `onResponse` fires off the resolved 2xx **before** `tokenResponseSchema
  .safeParse`, and so the malformed-token `DattoApiError` branch (auth-manager.ts
  :166–178) is *not* wired to `onError`. Plan-stage review should confirm the
  grant task places the terminal-event call at the response boundary, not around
  the whole method body — otherwise a malformed-2xx grant regresses to `onError`
  or a double terminal (Key Concepts invariant break).
- **Interaction with the r1 grant carve-out (Cluster A/B lineage).** The grant
  captures-and-stashes at its own dispatch point (Decision 5, from r1 f2/f5).
  Cluster D adds that the *terminal* selection for that same attempt is
  status-driven; keep the two consistent — the stashed request payload is reused
  by whichever terminal event the 2xx-vs-not rule picks, and for a malformed-2xx
  grant that is `onResponse`.
- **Transport-failure vs. post-2xx symmetry.** The plan's grant test matrix now
  needs three grant outcomes distinguished: (a) non-2xx / no-response →
  `onError` with the mapped `DattoApiError`; (b) 2xx well-formed → `onResponse`;
  (c) 2xx malformed body → `onResponse` (raw body) and no `onError`. Ensure the
  plan does not collapse (c) into (a).
- No cross-reviewer conflict (single reviewer). The five r1 findings are Closed
  by the auditor and were `Remediate` (no ruling), so there is no ruling for a
  reviewer to re-open and nothing to guard on that axis this round.

## Human dossiers

None — no finding was routed to Human this round.
