## engineer — round 3 (design review)

Third engineer turn. My r1 findings (f1–f3) and r2 findings (f1–f2) all landed and I
re-verified each against the live text — none re-opened:

- **engineer-r2-f1 / architect-r2-f1 (Resolved).** Decision 4's terminal-selection rules
  now live as a scannable three-item list in the **Decision** block (design.md:171–175):
  (1) dispatched → wire-status; (2) non-dispatched gate = "fires only for an attempt that
  fired `onRequest` … after `handleResponseError`'s `!axios.isAxiosError` rethrow guard" +
  the two named paths; (3) post-2xx carve-out. The Rationale (:177) is trimmed to *why*.
  The load-bearing gate rule is no longer buried.
- **engineer-r2-f2 (Resolved).** Non-Goals (:32) reduced to a "(see Decision 4)" pointer;
  Verification (:258) keeps its concrete test-assertion wording only. Decision 4 is now the
  single authoritative source for the grant/gate carve-outs.

I then re-read once and ran three axes over the *post-r4* text, honouring the triage
chain-watch (guard against silent rule loss in the restructure): (A) all four load-bearing
sub-rules survive the Decision-4 restructure — verified present (honest-type; wire-status for
dispatched; non-dispatched stash-gate + the two named paths + `!isAxiosError`-guard placement;
post-2xx carve-out incl. grant malformed-token; grant `onResponse`-before-`safeParse`); (B)
run-order [Bearer, rate-limit, observer-last] still correctly places `onRequest` post-auth /
post-`acquire()`; (C) the **optional-callback matrix** against the capture-and-stash mechanism —
this axis surfaced the one residual gap below. Selective, not exhaustive; the design is sound.

### Axis notes

- **(A)/(B) check out.** The r4 restructure is faithful — no sub-rule was dropped, and the
  gate now leads its own bullet (rule 2). Decision 5's stash-overwrite-on-every-pass rule
  (:189) still pins R2 retry fidelity.
- **(C) surfaced f1.** All three callbacks are *independently* optional (R1; the
  `DattoHttpObserver` interface at :130–134 marks each `?`), but the design describes the
  client-owned **capture-and-stash** as if it were a side-effect of the consumer's `onRequest`
  callback firing (":187 — At the moment it fires, `onRequest` **captures** … and **stashes**",
  and the rule-2 gate ":174 — an attempt that **fired `onRequest`** — i.e. whose per-attempt
  stash exists"). For an `onError`-only (or `onResponse`-only) consumer this equivalence breaks:
  the stash must still be written at dispatch or the terminal event has no `requestHeaders`/
  `requestBody`/`durationMs` to reuse and — worse — the rule-2 gate ("stash exists") would deny
  the terminal `onError` outright. Raised as f1.

## Findings

| ID | Severity | Status | Category | Where | Finding | Recommendation |
|----|----------|--------|----------|-------|---------|----------------|
| engineer-r3-f1 | Medium | Open | Completeness | Decision 5 (design.md:187, :191) · Decision 4 rule 2 (:174) · interface (:130–134) | The design ties the client-owned **capture-and-stash** to the consumer's `onRequest` callback ("At the moment it fires, `onRequest` **captures** … and **stashes**", :187) and states the shared-instance `onError` gate as "an attempt that **fired `onRequest`** — i.e. whose per-attempt stash exists" (:174). But `onRequest`, `onResponse`, `onError` are **independently optional** (R1; interface :130–134). A consumer that supplies **only** `onError` (or only `onResponse`) is a valid config for which nothing fires `onRequest` — yet the terminal event still needs the stashed `requestHeaders`/`requestBody`/dispatch-timestamp to populate its fields, and rule 2's gate ("stash exists") is what *permits* the terminal `onError` to fire at all. A Planner reading the stash as coupled to `onRequest` could write `if (observer.onRequest) { capture; stash; invoke }`, which for an `onError`-only consumer yields an `onError` with empty request fields / no `durationMs` **or** — under the literal gate — suppresses the shared-instance `onError` entirely (no stash ⇒ treated as non-dispatched). The capture-and-stash is a client-internal step that must run at every dispatch whenever `httpObserver` is present, decoupled from which callbacks the consumer provided. | State explicitly that the client **captures-and-stashes** the request payload + dispatch timestamp at the dispatch point **whenever `httpObserver` is present**, independent of which of the three callbacks the consumer supplied; the consumer's `onRequest` (if present) is *invoked* from that same point, but its presence/absence/`throw` does not affect whether the stash is written. Restate rule 2's gate in terms of **"the attempt reached dispatch (stash written)"** rather than "fired `onRequest`", or clarify that "fired `onRequest`" denotes the client's dispatch-point capture running, not the existence of a consumer callback. One sentence in Decision 5 (:187) plus a parenthetical on rule 2 (:174); no new section. |
