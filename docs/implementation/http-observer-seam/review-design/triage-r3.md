# Mediator — Round Triage r3 (design stage)

Reviewers assimilated this round: `design-auditor-r3`, `architect-r1` (first
turn), `engineer-r1` (first turn).

`design-auditor-r3` raises **no new finding** and marks `design-auditor-r2-f1`
**Closed/ratified** (Decision 4 now selects the terminal event by HTTP status of
the physical response; verified live at design.md:161–165, 32, 233, 240 against
auth-manager.ts:166–178). All six of its prior findings (r1 f1–f5, r2-f1) are
Closed — no route rows.

Two new reviewers bring **six open findings** (architect f1–f3, engineer f1–f3),
all Medium/Low, none a Requirements/Research gap. This is the **design stage**:
the artifact under review *is* the design, so every prose remedy is a direct edit
to `design.md` — no upstream doc to amend, hence every route below is an
**untagged** `Remediate` (never `Design Change:`/`Plan Change:`).

I re-derived each finding's mechanism against source before routing:
- Interceptor registration order — `createHttpClient` registers rate-limit at
  http-client.ts:350; observer registered *first* → runs *last* under LIFO;
  `AuthManager.attachTo` registers Bearer later (auth-manager.ts:85–89). So both
  the rate-limiter `acquire()` and the Bearer `getToken()` throw run **before**
  the observer's `onRequest`.
- Response interceptor slots — fulfilled handler is the identity
  `(response) => response` (http-client.ts:359); rejected handler is
  `handleResponseError`, whose `!axios.isAxiosError` guard **rethrows** a
  Bearer-interceptor `DattoApiError` (http-client.ts:253–255, documented
  :238–244).
- Retry re-dispatch reuses the **same config object** (`instance.request(config)`
  with `RETRY_COUNT_KEY` mutated in place at :308/:325).
- Grant site — `performRefresh` posts the urlencoded string and maps every
  failure to `DattoApiError` (auth-manager.ts:134–178); it is the second
  instrumentation site, carrying none of the shared instance's interceptors.
- Payload interface — the three callbacks use **inline anonymous** object types
  (design.md:97–125); no named payload types exist, yet Success Criteria
  (:224) promises "`DattoHttpObserver` **and its payload types** are exported."
- R7 (:47) says the return value is "ignored (never awaited)"; Risks row 5
  (:260) and the Overview (:82) promise a returned-promise rejection is "caught
  and swallowed" — a genuine internal tension.

Every finding checks out; each recommendation is sound and directly applicable,
so all route **Remediate**. No Challenge (none is wrong), no Ruled (none needs a
binding correction/redirection over the reviewer — the reviser applies each
directly), no Human (all Medium/Low, none a gap, none High/Critical/Blocker).

## Route table

| ID | Route | Detail |
|----|-------|--------|
| architect-r1-f1 | Remediate | Cluster E. Verified: callback payloads are inline anonymous types (design.md:97–125); no named payload types exist, so Success Criteria :224 ("`DattoHttpObserver` and its payload types are exported") is unachievable as drawn. Name + export the three event types. |
| architect-r1-f2 | Remediate | Cluster F. Verified: Decision 2 instruments two independent sites (shared-instance interceptor + `performRefresh`) that must reproduce identical header-normalization / capture-and-stash / swallow-wrapper behavior with no named shared implementation → drift risk. Name a single internal helper both consume. |
| architect-r1-f3 | Remediate | Cluster H. Verified: retries reuse the same `config` object (http-client.ts:308/325); correctness holds only because the interceptor re-fires and overwrites the stash. Decision 5 doesn't state the unconditional per-pass-overwrite invariant. Pin it (one sentence). |
| engineer-r1-f1 | Remediate | Cluster G. Verified: Decision 4's "the one code path" (:165) understates — the Bearer interceptor's grant-failure `DattoApiError` (auth-manager.ts:85–89) is a *second* non-dispatched failure rethrown by `handleResponseError` (:253–255) that never fired `onRequest`. Restate the `onError` gate as a mechanism (fires only for an attempt that fired `onRequest`), place it after the `!isAxiosError` guard, name both non-dispatched paths. |
| engineer-r1-f2 | Remediate | Cluster G. Verified: design pins `onRequest` (runs last) and `onError` (in `handleResponseError`) but never locates `onResponse`; its only viable home is the identity fulfilled handler (http-client.ts:359). State it fires there, reading the per-attempt stash, symmetric to `onError`. |
| engineer-r1-f3 | Remediate | Cluster I. Verified: R7 "return value is ignored (never awaited)" (:47) contradicts the swallow guarantee in Risks row 5 (:260) / Overview (:82). Tighten R7: not awaited, but a thenable return gets a `.catch` that logs once at `warn` and swallows. |

## Remediation plan (root-cause-first)

### Cluster F — Two instrumentation sites, no named shared implementation (architect-r1-f2)
**Root cause.** Decision 2 deliberately instruments **two** layers — the shared
instance's request/response interceptors and the grant call site in
`performRefresh` — and Decision 5/6 attach three behaviors to *both*:
`AxiosHeaders`→plain-`Record` normalization (design.md:89), capture-and-stash
payload assembly (:175), and the invoke-and-swallow-with-`warn` wrapper (:82).
The design states each behavior in prose but names no shared implementation, so
the two sites can silently diverge (e.g. one normalizes a multi-value header
differently, or one path treats an async-callback rejection unlike the other).
This is the seam's structural spine; fixing it first gives the other clusters a
named home to reference.

**Scope of edit (design.md — direct edit):** State (in Decision 2 and/or Schema
and wiring) that a single **internal** helper — e.g. `src/http/observer.ts` —
provides the swallow-wrapper, the header normalizer, and the capture-and-stash
payload assembler, and that both the shared-instance interceptor and
`performRefresh` consume it, so the two instrumentation points cannot drift.
Keep it internal and out of the published types, like the `axios-augment.d.ts`
precedent already cited at :203.

**Verification.** No new test strictly required; note that the two sites' header
normalization and swallow behavior are exercised by the existing grant-vs-shared
fidelity and observer-throw-isolation criteria (:229–234). The plan should place
these three primitives in one module so the tests exercise one implementation.

### Cluster G — Shared-instance terminal-event firing sites under-specified (engineer-r1-f1, engineer-r1-f2)
**Root cause.** The design pins where `onRequest` fires (request interceptor
registered first → runs last) but treats the two *response-side* terminal events
asymmetrically and incompletely: (1) `onResponse` is never located — its only
viable home is the identity fulfilled response handler `(response) => response`
(http-client.ts:359), left to inference; and (2) `onError`'s gate is stated as an
enumeration ("keeps out the one code path… a rate-limiter `acquire()` rejection",
design.md:165), which misses the **second** non-dispatched failure: the Bearer
interceptor's `getToken()` can throw a `DattoApiError` on lazy grant/refresh
failure (auth-manager.ts:85–89) that axios routes into `handleResponseError`,
where the `!axios.isAxiosError` guard rethrows it (http-client.ts:253–255).
Because the observer interceptor runs *last*, that attempt never fired
`onRequest` — so it must not fire `onError`, or the shared instance would
double-report a grant failure already surfaced on the grant client's own
`onError`, breaking the "one observed attempt ⇒ one terminal event" invariant.
Both sub-findings are the same defect: the shared-instance terminal events are
not pinned to the concrete response-interceptor slots.

**Scope of edit (design.md — direct edit):**
- **Locate `onResponse`** (engineer-f2): state it fires from the shared
  instance's **fulfilled** response handler (the `(response) => response` slot),
  reading the per-attempt stash (request fields + dispatch timestamp) placed by
  `onRequest` — symmetric to `onError` firing inside the rejected handler. One
  sentence in Decision 2 or Schema-and-wiring; no new section.
- **Restate the `onError` gate as a mechanism** (engineer-f1): reword Decision 4
  so the shared-instance `onError` fires **only for an attempt that fired
  `onRequest`** (i.e. whose per-attempt stash exists) — equivalently, place the
  `onError` call **after** `handleResponseError`'s `!axios.isAxiosError` rethrow
  guard. Name the Bearer-interceptor grant-failure `DattoApiError` alongside the
  rate-limiter `acquire()` rejection as the **two** non-dispatched paths that
  must not fire `onError`; drop "the one code path."
- Keep this consistent with the r2-f1 tightening already live in Decision 4
  (terminal selection by HTTP status of the physical response): the new gate
  governs *non-dispatched* attempts (no response at all, no `onRequest`), while
  the status rule governs *dispatched* attempts — the two are complementary, not
  in tension.

**Verification.** Add Verification cases: (a) a lazy-refresh grant failure fires
`onError` exactly **once** — on the grant attempt — and never a second `onError`
on the shared instance; (b) a 2xx resource response fires `onResponse` from the
fulfilled handler carrying the stashed request fields and `durationMs`. Pair with
the existing terminal-selection matrix (:240).

### Cluster H — Stash overwrite invariant across retries unstated (architect-r1-f3)
**Root cause.** Retries re-issue via `instance.request(config)` reusing the
**same** config object (http-client.ts:308/325; `RETRY_COUNT_KEY` mutated in
place), so the observer's stash (payload + dispatch timestamp) from attempt N
persists on that object into attempt N+1. Correctness currently holds only
because the request interceptor re-fires and **overwrites** the stash before the
next terminal event reads it — an invariant Decision 5 never states, leaving a
footgun: a stash written conditionally ("only if absent") would make attempt
N+1's terminal event report attempt N's stale request fields/`durationMs`,
silently breaking R2 per-attempt fidelity. (This is the design-level pin of the
same hazard triage-r1/r2 flagged for plan/impl review.)

**Scope of edit (design.md — direct edit):** Add one sentence to Decision 5: the
stash is **unconditionally overwritten on every interceptor pass** (idempotent
re-capture), and terminal events read it before the next pass re-dispatches — so
a config object reused across retries never leaks a prior attempt's capture.

**Verification.** Covered by the existing R2 retry criterion (:225) plus the
stash-fidelity criterion (:229); ensure the retry test asserts attempt N+1's
terminal `requestBody`/`requestHeaders`/`durationMs` reflect attempt N+1, not N.

### Cluster E — Success Criteria promises exportable payload types that don't exist (architect-r1-f1)
**Root cause.** The three event payloads are defined as **inline anonymous**
object types embedded in each method signature (design.md:97–125), so there are
no named types to export — yet Success Criteria :224 commits that
"`DattoHttpObserver` **and its payload types** are exported from `src/index.ts`."
A consumer writing a callback as a standalone named function has no exported type
to annotate its parameter and must hand-duplicate the shape; the criterion is
unachievable as the interface is drawn.

**Scope of edit (design.md — direct edit):** Name the three payloads (e.g.
`DattoHttpRequestEvent` / `DattoHttpResponseEvent` / `DattoHttpErrorEvent`), have
`DattoHttpObserver` reference them by name in the Callback-payloads block, and
have Key Concepts (:87) / Schema-and-wiring / Success Criteria (:224) state they
are exported from `src/index.ts` / `public-types`. This tightens the existing
interface — it is not new public surface.

**Verification.** Already backed by the typecheck/`dist` gates (:239, :241);
extend them to confirm the three named payload types are present in the exported
surface and reference no axios type.

### Cluster I — R7 "ignored" contradicts the async-rejection swallow guarantee (engineer-r1-f3)
**Root cause.** R7 (:47) says the callback's return value is "ignored (never
awaited)," but Risks row 5 (:260) and the Overview (:82) promise a returned
promise's rejection is "caught and swallowed" with a `warn`. A genuinely
*ignored* returned promise is precisely the unhandled-rejection mode Risks row 5
exists to prevent; to swallow an accidentally-async callback's rejection the
wrapper must attach a `.catch` to the returned thenable (without awaiting it). A
Planner implementing R7 literally would reintroduce the unhandled rejection.

**Scope of edit (design.md — direct edit):** Tighten R7 (and align Risks row 5's
wording): the return value is **not awaited**, but when it is thenable a `.catch`
is attached that logs once at `warn` and swallows — so neither a synchronous
`throw` nor an async rejection can propagate or delay the request. Replace
"ignored" so it no longer contradicts the swallow guarantee. This is the R7 half
of the swallow-wrapper that Cluster F houses in the shared helper.

**Verification.** Covered by the existing observer-throw-isolation criterion
(:234); extend it to include an async callback returning a rejected promise —
request unaffected, one `warn` logged, no unhandled rejection.

**Suggested order.** F → G → H → E → I. F names the shared helper the other
mechanics reference (the swallow-wrapper for I, the normalizer/assembler for the
firing sites in G and the stash in H). G and H then pin the shared-instance
response-side mechanics onto concrete slots. E and I are independent prose/
interface tightening and can land in any order.

## Chain watch

- **Cluster G's `onError` gate vs. the r2-f1 status rule (Decision 4).** The new
  "fires only for an attempt that fired `onRequest`" gate governs *non-dispatched*
  attempts; the already-live "terminal event selected by HTTP status of the
  physical response" rule governs *dispatched* ones. Plan/impl review must keep
  both: place the shared-instance `onError` **after** the `!axios.isAxiosError`
  rethrow guard (so a Bearer/grant `DattoApiError` and a rate-limiter rejection
  never fire it) **and** off the wire status for dispatched attempts. A plan task
  that fires `onError` at the top of `handleResponseError` regresses both.
- **Cluster F is the spine for G/H/I.** Once the design names a single internal
  helper (swallow-wrapper + normalizer + capture-and-stash assembler), the plan
  must route both instrumentation sites through it — otherwise the onResponse/
  onError firing (G), the per-pass stash overwrite (H), and the async-swallow
  (I) can each drift between the shared instance and `performRefresh`. Plan-stage
  review should confirm one `observer.ts`-style module and two call sites, not
  two parallel implementations.
- **Cluster H is a binding implementation constraint.** "Unconditionally
  overwrite the stash per pass" must survive into the plan's retry task: the stash
  is refreshed on every interceptor pass (config reused across retries,
  http-client.ts:308/325), never written conditionally. This is the third round
  this hazard has surfaced (triage-r1/r2 chain watch) — the plan must carry an
  explicit task, and impl review a test that a retried attempt reports its own
  request fields/`durationMs`.
- **Cluster E propagates to the exit gates.** Named payload types must appear in
  `src/index.ts`/`public-types` and survive the `dist/index.d.ts` no-axios check
  (design.md:241); plan test matrix should assert the three names export and
  carry no axios type.
- **Cluster I propagates to the test matrix.** The plan's observer-isolation tests
  must include an async callback returning a rejected promise (swallowed, one
  `warn`, no unhandled rejection), not only a synchronous `throw`.
- No cross-reviewer conflict this round: `design-auditor-r3` raised nothing;
  architect and engineer findings are complementary (contract surface / structure
  vs. shared-instance response-side mechanics) and consistent with the Closed
  design-auditor lineage. No ruling was issued in any round, so there is no
  binding disposition for a reviewer to re-open.

## Human dossiers

None — no finding was routed to Human this round.
