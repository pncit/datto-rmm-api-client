# Mediator — Round Triage r4 (design stage)

Reviewers assimilated this round: `architect-r2`, `engineer-r2`. `design-auditor`
did not turn again (its lineage r1 f1–f5 + r2-f1 was Closed at r3; it raised
nothing new). The reviser (`reviser-r3`) applied all six r3-Open findings
(architect f1–f3, engineer f1–f3) as direct edits, and both new reviewers
re-verified their own r1 findings against the revised text and mark every one
**Resolved** — no route rows for those (architect-r1-f1/f2/f3, engineer-r1-f1/f2/f3
are settled, not re-opened).

That leaves **three Open findings this round**, all Low, none a Requirements/
Research gap, none High/Critical/Blocker: `architect-r2-f1`, `engineer-r2-f1`,
`engineer-r2-f2`. All three land on a **single locus** — Decision 4 and the
sites that restate its grant/gate carve-outs — and all three are explicitly
*tightening, not correctness* (every reviewer affirms the content is right). This
is the **design stage**: the artifact under review *is* the design, so every
prose remedy is a direct edit to `design.md` with no upstream doc to amend, hence
every route below is an **untagged** `Remediate` (never `Design Change:`/
`Plan Change:`).

I re-derived each finding against the live text before routing:
- **Decision 4's Rationale (`design.md:173`) is one ~600-word single paragraph.**
  Confirmed: it fuses four distinct arguments into one block — (1) why the
  concrete `DattoApiError` type is honest; (2) the wire-status selection rule for
  *dispatched* attempts; (3) the grant fire-`onResponse`-before-`safeParse`
  ordering; (4) the non-dispatched gate ("fires only for an attempt that fired
  `onRequest`" → placed after `handleResponseError`'s `!axios.isAxiosError`
  guard) naming the two non-dispatched paths (rate-limiter `acquire()` rejection;
  Bearer-interceptor grant-failure `DattoApiError`), plus the complementarity
  note and the retried-attempt cost. The load-bearing gate rule is buried
  mid-paragraph behind the restated post-2xx material — the same
  under-specification risk the r3 remediation set out to remove.
  (architect-r2-f1, engineer-r2-f1 — the **same** defect, seen from Architecture
  and Clarity axes respectively.)
- **The grant carve-outs are restated across four sites.** Confirmed: the
  malformed-2xx-token case appears at Non-Goals (`:32`, already carrying a
  "(see Decision 4)" cross-ref), the Decision block (`:171`), and the Rationale
  (`:173`) — three near-verbatim narrations — plus a Success-Criteria bullet
  (`:245`) and a Verification assertion (`:254`); the lazy-refresh Bearer-failure
  case appears at `:171/:173`, `:246`, `:254`. Beyond requirements-traceability
  value this raises the drift cost of any future rule change (must be chased
  across sites). (engineer-r2-f2.)

architect-r2-f1 and engineer-r2-f1 are the **same finding** (split the Decision 4
rationale so the gate rule is scannable); engineer-r2-f2 is the **same-mechanism
family member** (reduce the cross-site restatements to pointers). All three are
one prose-economy cluster on Decision 4 (Cluster J). Every recommendation is
sound and directly applicable by the reviser as a `design.md` edit → all
**Remediate**. No Challenge (none is wrong; the two f1s corroborate). No Ruled
(the recommendations need no binding correction/redirection over the reviewers —
they agree with each other and with the source, and the reviser applies them
directly; nothing to overrule). No Human (all Low, none a gap).

## Route table

| ID | Route | Detail |
|----|-------|--------|
| architect-r2-f1 | Remediate | Cluster J. Verified: Decision 4 Rationale (`design.md:173`) is one dense paragraph carrying the doc's densest mechanism (the two complementary gates) while re-arguing the post-2xx carve-out already owned by the Decision block (`:171`) and Non-Goals (`:32`); the load-bearing gate rule (shared-instance `onError` fires only after the `!isAxiosError` guard, i.e. only for an attempt with a stash) is buried mid-paragraph. Content is correct — restructure only. Move the gate rule into the **Decision** block (or a short bulleted list); trim the Rationale to *why* the gate is honest; state the "already fired `onResponse`" invariant once and cross-reference. |
| engineer-r2-f1 | Remediate | Cluster J. Same defect as architect-r2-f1 from the Clarity axis: the ~600-word Rationale (`:173`) fuses four distinct arguments; the placement rule ("fires only for an attempt that fired `onRequest`" → after the `!isAxiosError` guard) is buried behind two clauses, so a Planner skimming for the actual placement can miss it. Split along the four natural seams, leading each sub-point with its rule. No content added or removed. Folds into the same restructure. |
| engineer-r2-f2 | Remediate | Cluster J. Verified: the two grant carve-outs are restated near-verbatim across Non-Goals (`:32`), Decision 4 (`:171`, `:173`), Success Criteria (`:245–246`), and Verification (`:254`) — the malformed-2xx narrative appears three times in prose. Keep the **authoritative** statement in Decision 4 (Decision block + trimmed Rationale); reduce Non-Goals / Success-Criteria to short cross-referencing pointers; Verification retains its concrete *test-assertion* wording (traceability), but not the re-derived prose *explanation*. |

## Remediation plan (root-cause-first)

### Cluster J — Decision 4 accreted its r3/r2 remediations as unstructured prose (architect-r2-f1, engineer-r2-f1, engineer-r2-f2)
**Root cause.** Three prior-round remediations were all folded **into Decision 4**
without restructuring it: the r2-f1 wire-status rule, the r3 Cluster-G
non-dispatched `onError` gate + two paths, and the r2-f1/Cluster-D grant
malformed-2xx carve-out. Each was correct and each was appended to the Decision's
Rationale, producing (a) a single ~600-word paragraph in which the *load-bearing
placement rule* is buried behind the post-2xx re-argument, and (b) the same
carve-outs narrated near-verbatim at four satellite sites (Non-Goals, Decision
block, Success Criteria, Verification). Both the f1 pair (density/burial) and f2
(cross-site duplication) are symptoms of the one root cause: Decision 4 grew by
accretion and was never re-shaped so its rules are scannable and single-sourced.
The content is verified correct in every round — this is purely a structural/
economy edit, no rule changes.

**Scope of edit (design.md — direct edit, this is the design stage):**
- **Surface the gate rule in the Decision block** (satisfies architect-r2-f1 +
  engineer-r2-f1). In Decision 4's **Decision** (`:171`), state the placement
  mechanism as a short, scannable rule — ideally a compact bulleted list:
  1. *dispatched* attempts → terminal event selected by the **HTTP wire status**
     (2xx → `onResponse`, else → `onError`), not by whether the surrounding
     method later throws;
  2. *non-dispatched* attempts → **no** terminal event: the shared-instance
     `onError` fires **only for an attempt that fired `onRequest`** (stash
     exists), realized by placing the `onError` call **after**
     `handleResponseError`'s `!axios.isAxiosError` rethrow guard; the two
     non-dispatched paths that must not fire it are the rate-limiter `acquire()`
     rejection and the Bearer-interceptor grant-failure `DattoApiError`;
  3. post-2xx failures (`DattoValidationError` in `BaseResource`; the grant's
     malformed-token `DattoApiError`) → **not** terminal: the attempt already
     fired `onResponse`.
- **Trim the Rationale to *why*** (satisfies engineer-r2-f1). Cut `:173` to the
  justifications only — why the concrete `DattoApiError` type is honest
  (structured artifact vs. `unknown`), why the retried-attempt `DattoApiError`
  construction cost is accepted, and a one-line pointer to the grant
  fire-`onResponse`-before-`safeParse` ordering — without re-deriving the
  post-2xx carve-out or restating the gate now living in the Decision block.
  State the "already fired `onResponse`" invariant **once** and cross-reference.
- **Reduce the satellite restatements to pointers** (satisfies engineer-r2-f2).
  Non-Goals (`:32`) already carries "(see Decision 4)" — shorten its narration to
  the pointer. Success Criteria (`:245–246`) may keep the concrete pass/fail
  assertions but drop the re-explained mechanism prose; Verification (`:254`)
  keeps its concrete *test-assertion* wording (traceability) but not the
  re-derived explanation. Decision 4 remains the single authoritative source.

**Verification.** No test changes — this is prose structure only, and the r3
Verification/Success-Criteria assertions (`:245–246`, `:254`) must survive
intact. The reviser (and plan-stage review) must confirm the restructure **drops
no rule**: all four sub-rules (honest-type, wire-status for dispatched,
non-dispatched gate + the two named paths + the `!isAxiosError`-guard placement,
post-2xx carve-out incl. the grant malformed-token case) remain present, and the
grant fire-`onResponse`-before-`safeParse` ordering constraint is still stated.
Diff Decision 4 before/after for rule-content equivalence; only prose location
and length may change.

## Chain watch

- **Cluster J is a structure-only edit — guard against silent rule loss.** The
  entire value of these three findings is *readability without content change*.
  The real risk is that trimming the ~600-word Rationale accidentally drops one
  of its four load-bearing sub-rules (most fragile: the `!axios.isAxiosError`
  guard *placement* and the *two* named non-dispatched paths — the exact
  substance of the resolved engineer-r1-f1 / r3 Cluster G). Plan-stage review must
  confirm the plan still carries: (1) observer request-interceptor registered
  first → runs last; (2) `onError` placed after the `!isAxiosError` guard, gated
  on stash-exists, never at the top of `handleResponseError`; (3) grant
  `onResponse` fired off the resolved 2xx **before** `safeParse`; (4) terminal
  selection by wire status, not control-flow throw. A restructure that reads
  cleaner but lets any of these slip regresses a rule this loop already spent
  three rounds pinning.
- **Single-source pointers must not become dangling.** Once Non-Goals / Success
  Criteria point to Decision 4 rather than re-narrating, the plan and impl review
  should treat **Decision 4 as the authoritative statement** of the grant/gate
  carve-outs and not re-expand them elsewhere — otherwise the drift cost f2
  removes reappears at a new site.
- **No cross-reviewer conflict this round.** architect-r2-f1 and engineer-r2-f1
  are the same finding from two axes and are mutually reinforcing; engineer-r2-f2
  is complementary (duplication vs. density) and non-contradictory. No ruling was
  issued in any round of this loop, so there is no binding disposition for a
  reviewer to re-open. The Closed design-auditor lineage and the Resolved
  architect/engineer r1 findings are consistent with these purely cosmetic
  residuals — the design's substance is settled; only Decision 4's presentation
  remains.

## Human dossiers

None — no finding was routed to Human this round.
