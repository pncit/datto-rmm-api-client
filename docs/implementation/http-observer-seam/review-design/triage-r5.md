# Mediator — Round Triage r5 (design stage)

Reviewers assimilated this round: `architect-r3`, `design-auditor-r3`,
`engineer-r3`.

`design-auditor-r3` raises **no new finding** and marks its last Open item
(`design-auditor-r2-f1`) **Closed/ratified** — Decision 4 selects the terminal
event by HTTP status of the physical response, cross-checked live against
`auth-manager.ts:166–178`. Its whole lineage (r1 f1–f5, r2-f1) is Closed → no
route rows.

Both new reviewers first re-verified their prior-round work: `architect-r3` and
`engineer-r3` confirm **Cluster J** (the r4 Decision 4 restructure carrying
architect-r2-f1 + engineer-r2-f1/f2) landed faithfully — all four load-bearing
sub-rules survive (honest-type; wire-status for dispatched; non-dispatched
stash-gate + the two named paths + `!isAxiosError`-guard placement; post-2xx
carve-out incl. grant malformed-token; grant `onResponse`-before-`safeParse`),
and the satellite reductions (Non-Goals/Success-Criteria → pointers) held. The
r4 chain-watch's "guard against silent rule loss" is therefore **discharged**:
architect-r2-f1, engineer-r2-f1, engineer-r2-f2 are Resolved, not re-opened — no
route rows for them.

That leaves **two Open findings this round**, both new, neither a Requirements/
Research gap, neither High/Critical/Blocker: `engineer-r3-f1` (Medium,
Completeness) and `architect-r3-f1` (Low, PublicAPI). They land on **two
independent loci** and do not cluster together. This is the **design stage**: the
artifact under review *is* the design, so every prose remedy is a direct edit to
`design.md` — no upstream doc to amend, hence both routes are **untagged**
`Remediate` (never `Design Change:`/`Plan Change:`).

I re-derived each finding against the live text and source before routing:

- **engineer-r3-f1 — capture-and-stash is narrated as a side-effect of the
  consumer's `onRequest`.** Confirmed. Decision 5 (`design.md:187`) states "At the
  moment it fires, `onRequest` **captures** the method, URL, headers, and body and
  **stashes** …", and Decision 4 rule 2 (`:174`) gates the shared-instance
  `onError` on "an attempt that **fired `onRequest`** — i.e. whose per-attempt
  stash exists." Yet the three callbacks are **independently optional** (R1 `:41`;
  interface `:131–133` each `?`). Decision 2 (`:152`) already models the
  capture-and-stash payload assembler as a **client-owned internal primitive** in
  `observer.ts`, distinct from callback invocation — so the mechanism is correct,
  but the Decision-5/Decision-4 prose conflates the client's dispatch-point
  capture with the consumer's `onRequest` callback. For an `onError`-only (or
  `onResponse`-only) consumer, no `onRequest` callback exists; a Planner reading
  the prose literally could gate capture-and-stash on callback presence
  (`if (observer.onRequest) { capture; stash }`), which either populates the
  terminal event with empty request fields / no `durationMs`, or — under rule 2's
  literal "stash exists" gate — suppresses the shared-instance `onError`
  altogether (no stash ⇒ treated as non-dispatched). Genuine under-specification;
  content is right, the framing must decouple the client-internal stash from which
  callbacks the consumer supplied. **Remediate.**

- **architect-r3-f1 — `DattoHttpHeaders` alias vs. the enumerated four-type export
  set.** Confirmed. `DattoHttpHeaders` is defined as a named alias (`:98`) and
  referenced by name in every public event field (`:103/110/113/120/122/125`), but
  the export commitment enumerates exactly **four** public types —
  `DattoHttpObserver` + the three event types (`:95`, `:240`, `:257`) — omitting
  the alias. Key Concepts (`:89`) uses the inline `Record<string, string | string[]
  | undefined>` form while the payload block uses the alias, so the intended public
  surface is ambiguous: either the alias is part of the published contract (and
  belongs in the export set / count) or it is internal (and the event fields should
  inline the `Record<…>`). Same export-completeness class as the resolved
  architect-r1-f1 (named-but-unexported payloads), one level down. Low, correct,
  directly applicable — pick one form and reconcile the three sites. **Remediate.**

Both recommendations are sound and directly applicable by the reviser as
`design.md` edits → both **Remediate**. No Challenge (neither is wrong; both are
first turns on their locus, so the once-only challenge budget is untouched and
there is no reason to spend it). No Ruled (neither needs a binding correction or
redirection over the reviewer — the reviser applies each directly, and the two
findings do not conflict with each other or with any prior ruling; no ruling was
issued in any round of this loop). No Human (both Medium/Low, neither a gap).

## Route table

| ID | Route | Detail |
|----|-------|--------|
| engineer-r3-f1 | Remediate | Cluster K. Verified: Decision 5 (`design.md:187`) narrates capture-and-stash as `onRequest`'s action and Decision 4 rule 2 (`:174`) gates the shared-instance `onError` on "fired `onRequest` … stash exists," but the three callbacks are independently optional (R1 `:41`; interface `:131–133`). Decision 2 (`:152`) already scopes capture-and-stash as a client-owned internal primitive, so the mechanism is right; the prose must state the stash is written at the dispatch point **whenever `httpObserver` is present**, decoupled from which callbacks the consumer supplied, and restate rule 2's gate in terms of "the attempt reached dispatch (stash written)" rather than "fired `onRequest`" (or clarify that "fired `onRequest`" denotes the client's dispatch-point capture running, not a consumer callback). One sentence in Decision 5 + a parenthetical on rule 2; no new section. |
| architect-r3-f1 | Remediate | Cluster L. Verified: `DattoHttpHeaders` (`:98`) is referenced by name in every public event field but is absent from the enumerated four-type export set (`:95`, `:240`, `:257`); Key Concepts (`:89`) uses the inline `Record<…>` form, so the surface is ambiguous. Pick one and reconcile all three sites: either add `DattoHttpHeaders` to the exported set (making the count "five" at `:95`/`:240`/`:257`) so a consumer can annotate a header helper, or drop the alias and inline `Record<string, string \| string[] \| undefined>` in the event fields and align Key Concepts (`:89`). Tightening the existing surface, not new capability. |

## Remediation plan (root-cause-first)

### Cluster K — Capture-and-stash prose couples a client-internal step to the consumer's `onRequest` callback (engineer-r3-f1)
**Root cause.** Decision 5 was written from the happy-path mental model where the
consumer supplies `onRequest`, so it describes the client's dispatch-point
capture-and-stash *as* `onRequest`'s action (`:187`) and Decision 4 rule 2 phrases
the non-dispatched gate as "fired `onRequest`" (`:174`). But the seam's own
contract makes all three callbacks independently optional (R1 `:41`; interface
`:131–133`), and Decision 2 (`:152`) already places capture-and-stash in the
client-owned `observer.ts` helper — i.e. it is a client-internal step, not a
consumer side-effect. The two sub-symptoms (empty terminal request fields for an
`onError`-only consumer; the rule-2 gate suppressing that consumer's `onError`
entirely) are one root cause: the prose never says the stash is written at
dispatch **regardless of which callbacks the consumer provided**.

**Scope of edit (design.md — direct edit, this is the design stage):**
- **Decision 5 (`:187`).** State that whenever `httpObserver` is present, the
  client **captures-and-stashes** the request payload + dispatch timestamp at the
  dispatch point — independent of which of the three callbacks the consumer
  supplied. The consumer's `onRequest` (if present) is *invoked* from that same
  point, but its presence/absence/`throw` does not affect whether the stash is
  written. Keep the grant-path parallel at `:191` consistent (the grant already
  captures at its own dispatch point inside `performRefresh`).
- **Decision 4 rule 2 (`:174`).** Restate the shared-instance `onError` gate in
  terms of **"the attempt reached dispatch (stash written)"** rather than "fired
  `onRequest`," or add a parenthetical clarifying that "fired `onRequest`" denotes
  the client's dispatch-point capture running (which always happens for a
  dispatched attempt when `httpObserver` is present), not the existence of a
  consumer `onRequest` callback. The two genuinely non-dispatched paths
  (rate-limiter `acquire()` rejection; Bearer-interceptor grant-failure
  `DattoApiError`) remain the only stash-absent cases — that content is unchanged.

**Verification.** No mechanism change, so the existing terminal-selection and
stash-fidelity criteria (`:245`, `:251`) still hold. Add/extend a Verification
case so the plan carries it: an **`onError`-only** consumer (no `onRequest`
supplied) still receives a terminal `onError` on a dispatched non-2xx attempt with
populated `requestHeaders`/`requestBody`/`durationMs` from the stash — proving the
stash is written on the dispatch path, not gated on the `onRequest` callback.

### Cluster L — `DattoHttpHeaders` alias unreconciled with the export enumeration (architect-r3-f1)
**Root cause.** The header type was introduced as a convenience alias (`:98`) and
used by name in the public event signatures, but the export commitment was written
against the four "primary" types and never updated to say whether the alias is
public. Key Concepts independently uses the inline form (`:89`), leaving two
representations of the same type in one document with no stated intent.

**Scope of edit (design.md — direct edit):** Pick one form and apply it
consistently:
- *Option A (export the alias):* add `DattoHttpHeaders` to the exported set and
  update the "four" count to "five" everywhere it appears (`:95`, `:240`, `:257`),
  and make Key Concepts (`:89`) reference the alias — giving a consumer an
  importable name to annotate a standalone header helper.
- *Option B (inline it):* drop the alias and inline `Record<string, string |
  string[] | undefined>` in the six event fields, leaving the export set at four,
  and keep Key Concepts (`:89`) inline.

Either is acceptable; the reviser chooses, but must reconcile **all three** sites
(payload block, export enumeration/count, Key Concepts) to the choice so no
dangling alias leaks and the export count is internally consistent.

**Verification.** Backed by the existing typecheck / `dist/index.d.ts` no-axios
gates (`:257`, `:259`); if Option A is taken, extend the exported-surface
assertion to include `DattoHttpHeaders` (and update the "four named types" wording
in Success Criteria `:240` and Verification `:257`). If Option B, confirm no
`DattoHttpHeaders` symbol survives in the design or the exported surface.

**Suggested order.** K → L. K is the load-bearing correctness-of-framing edit
(touches Decisions 4 and 5, the seam's spine) and should land first; L is
self-contained surface tightening and can follow independently.

## Chain watch

- **Cluster K is a binding framing constraint the plan must carry.** The plan's
  capture-and-stash task must gate the stash on **`httpObserver` presence at
  dispatch**, never on the consumer's `onRequest` callback. Plan/impl review must
  confirm: (1) the `observer.ts` capture-and-stash primitive (Decision 2 `:152`)
  runs at every dispatch when `httpObserver` is set, before/independent of the
  `onRequest` *invocation*; (2) the shared-instance `onError` gate keys off
  "stash written / attempt dispatched," so an `onError`-only consumer still gets a
  populated terminal event; (3) the two genuinely non-dispatched paths
  (rate-limiter rejection, Bearer grant-failure) remain the only stash-absent
  cases. A plan task that writes the stash inside an `if (observer.onRequest)`
  branch regresses this and silently breaks the `onError`-only / `onResponse`-only
  consumer.
- **Cluster K must not disturb the Cluster J rules just ratified.** The rule-2
  reword touches the same Decision 4 bullet architect-r3/engineer-r3 confirmed
  faithful this round. The edit changes only the *gate's phrasing* ("fired
  `onRequest`" → "reached dispatch / stash written"); it must preserve the two
  named non-dispatched paths, the `!axios.isAxiosError`-guard placement, and the
  wire-status/post-2xx sub-rules. Diff Decision 4 before/after for rule-content
  equivalence — only the gate's *expression* may change, not its behavior.
- **Cluster L propagates to the exit gates.** Whichever option is chosen, the
  `dist/index.d.ts` no-axios check and the exported-surface count must be updated
  in lockstep — the plan's test matrix should assert the exact set of exported
  observer types (four or five) and that none references an axios type.
- **No cross-reviewer conflict this round.** `design-auditor-r3` raised nothing and
  ratified its last item; `engineer-r3-f1` (internal capture-and-stash mechanism)
  and `architect-r3-f1` (public header-type surface) are independent and
  non-contradictory. No ruling was issued in any round of this loop, so there is no
  binding disposition for a reviewer to re-open; the Closed design-auditor lineage
  and the Resolved architect/engineer r1/r2 findings are consistent with these two
  residual tightening findings — the design's substance is settled.

## Human dossiers

None — no finding was routed to Human this round.
</content>
</invoke>
