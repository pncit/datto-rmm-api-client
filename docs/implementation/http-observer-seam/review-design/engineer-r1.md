## engineer — round 1 (design review)

First engineer turn. The `design-auditor` closed all of its findings (r1 f1–f5, r2-f1) across
three rounds and the reviser applied each; I did **not** re-open those. I read the design once,
then ran three independent axes against source — (A) shared-instance interceptor/terminal
mechanics, (B) observer-isolation under pre-dispatch failures, (C) the async-callback swallow
contract — grounding each against `src/http/http-client.ts` and `src/auth/auth-manager.ts`.
Selective, not exhaustive; the design is already tight, so these are the residual gaps worth a
tightening edit, not additions.

### Axis notes

- **Terminal-event routing on the shared instance is asymmetric and only partly pinned.** The
  design pins where `onRequest` fires (request interceptor registered *first* → runs *last* under
  LIFO) and where `onError` fires (inside `handleResponseError`, where the mapped `DattoApiError`
  exists). It never locates `onResponse`. In the code, `handleResponseError` is only the *rejected*
  handler; the fulfilled handler is the identity `(response) => response` (http-client.ts:359).
  `onResponse` therefore has exactly one viable home — that fulfilled handler — but the design
  leaves it to inference (f2).
- **Pre-dispatch failures reaching `handleResponseError` are under-enumerated.** Decision 4 names
  "*the one code path*" (rate-limiter `acquire()` rejection). The module doc at http-client.ts:238–244
  documents a **second**: `AuthManager.attachTo`'s Bearer request interceptor (auth-manager.ts:85–89)
  calls `getToken()`, which can trigger `performRefresh` and, on grant failure, **throw a
  `DattoApiError` from within the request interceptor** — axios delivers that rejection to
  `handleResponseError` too (rethrown by the `!axios.isAxiosError` guard at http-client.ts:253).
  That shared-instance attempt never dispatched and never fired `onRequest` (the observer interceptor
  runs *last*, after the Bearer interceptor that threw), so it must not fire `onError` — raised as f1.
- **Ordering cross-check (no finding).** Because the observer request interceptor runs last, any
  `AxiosError` that reaches `handleResponseError` implies `onRequest` already fired; and every
  request-interceptor throw (rate-limit reject, Bearer/grant `DattoApiError`) precedes it, so the
  "observed attempt" gate is coherent — *provided* the `onError` call is placed after the
  `isAxiosError` guard / gated on the stash (the substance of f1). Verified consistent.

## Findings

| ID | Severity | Status | Category | Where | Finding | Recommendation |
|----|----------|--------|----------|-------|---------|----------------|
| engineer-r1-f1 | Medium | Open | Feasibility | Decision 4 (¶ "keeps out the one code path…") / Current State | Decision 4 says the only pre-dispatch path that "never reaches `onError`" is a rate-limiter `acquire()` rejection — "**the one code path**." But `handleResponseError` receives a **second** non-dispatched failure: `AuthManager.attachTo`'s Bearer request interceptor (auth-manager.ts:85–89) can throw a `DattoApiError` on lazy grant/refresh failure, which axios routes into `handleResponseError` and the `!axios.isAxiosError` guard rethrows (documented at http-client.ts:238–244). That shared-instance attempt never dispatched and never fired `onRequest` (the observer interceptor runs last, after the Bearer interceptor that threw). A Planner reading "the one code path" could fire `onError` at the top of `handleResponseError` (or guard only the rate-limiter case) and thereby emit a **spurious shared-instance `onError`** that double-reports a grant failure already surfaced on the `grantClient`'s own `onError` — breaking the "one observed attempt ⇒ one terminal event" invariant. | Reword Decision 4 so the gate is stated as a mechanism rather than an enumeration: the shared-instance `onError` fires **only for an attempt that fired `onRequest`** (i.e. whose per-attempt stash exists), equivalently place the `onError` call **after** `handleResponseError`'s `!axios.isAxiosError` rethrow guard. Name the Bearer-interceptor grant-failure `DattoApiError` alongside the rate-limiter rejection as the two non-dispatched paths that must not fire `onError`. Add a Verification case: a lazy-refresh grant failure fires `onError` **once** (on the grant attempt), never a second `onError` on the shared instance. |
| engineer-r1-f2 | Low | Open | Completeness | Overview / Decision 2 / Schema and wiring | The design pins the firing site for `onRequest` (request interceptor registered *first* → runs *last*) and for `onError` (inside `handleResponseError`), but never locates `onResponse`. `handleResponseError` is only the response interceptor's *rejected* handler (http-client.ts:358–368); the fulfilled handler today is the identity `(response) => response`. A Planner is left to infer where the 2xx terminal event fires and how the stash/`durationMs` are read on the success path — the same class of under-specification that f1(closed) fixed for `onRequest`. | State that `onResponse` fires from the shared instance's **fulfilled response handler** (the `(response) => response` slot), reading the per-attempt stash (request fields + dispatch timestamp) placed by `onRequest`, symmetric to `onError` firing inside the rejected handler. One sentence in Decision 2 or Schema-and-wiring; no new section. |
| engineer-r1-f3 | Low | Open | Consistency | R7 / Risks row 5 | R7 says callbacks' "return value is **ignored** (never awaited)," while Risks row 5 promises "a returned promise's rejection is defensively **caught and swallowed** with a `warn`." These are in tension: a genuinely *ignored* returned promise is precisely the unhandled-rejection failure mode Risks row 5 exists to prevent — to swallow an accidentally-async callback's rejection the wrapper must attach a `.catch` to the returned thenable (without awaiting it). A Planner implementing R7 literally ("ignore the return value") would reintroduce the unhandled rejection. | Tighten R7: the return value is **not awaited**, but when it is thenable a `.catch` is attached that logs once at `warn` and swallows — so neither a synchronous `throw` nor an async rejection can propagate, and neither delays the request. Align the wording with Risks row 5 so "ignored" no longer contradicts the swallow guarantee. |
