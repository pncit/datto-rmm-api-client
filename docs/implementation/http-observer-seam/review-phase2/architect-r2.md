## architect — round 2

**In-progress review.** Only one finding of mine was live from round 1 (`architect-r1-f1`), which
the reviser marked `Fixed`. I re-verified the working tree rather than the digest.

**architect-r1-f1 — ratified → Closed.** The reviser added the 401 transparent-retry test to the
observer `describe` block (`tests/unit/http/http-client.test.ts:610-643`). It `nock`s a `401` then a
`200`, instruments a full observer plus an `onUnauthorized` hook, and asserts exactly the sequence I
called for: `events.map(([kind]) => kind)` equals `["request", "error", "request", "response"]`,
with `errorPayload(events[1]).statusCode === 401` and `responsePayload(events[3]).statusCode === 200`,
plus `onUnauthorized` called once. This pins the load-bearing R2 consequence — a silently-recovered
401 still emits exactly one terminal `onError` before the retry's `onResponse` — so a future refactor
of the 401 branch (`http-client.ts:292-303`) cannot drop or reorder that event without failing a
test. Written on the tightened `ObserverEvent` tuple with no fresh `as` cast, as the triage required.
Finding closed.

**Context — sibling fixes I relied on (not my findings, not carried by me).** The Option (A) ruling's
`instance.getUri(requestConfig)` composition is in place at `http-client.ts:388` with an explanatory
comment, and is exercised by the new `params` (`:690`) and paginate-first-page (`:712`) tests; the
`ObserverEvent` discriminated-union tuple (`:492-516`) replaces the prior `unknown`-widened arrays and
casts across every observer capture site including the ruling's new tests. These corroborate that
architect-r1-f1's fix landed cleanly and introduced no cast regression.

**New findings — none.** The round-2 delta is confined to the one-line `getUri` production change,
the test file, and upstream design.md/plan.md prose amendments. I re-examined the transport-layer
instrumentation for new architectural, boundary, data-flow, and coverage issues surfaced by these
changes and found none: ownership still sits in `http-client.ts`, no new cross-layer import or cycle,
the raw/unmasked `httpObserver` threading remains deliberate and documented, and the firing model
(observer registered first → runs last under LIFO; stash written only for dispatched attempts; one
terminal event per physical attempt) is unchanged and now more fully test-pinned.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | Low | Closed | Architecture | `tests/unit/http/http-client.test.ts:610-643`; behavior in `src/http/http-client.ts:292-303` | Ratified. The 401 transparent-retry observer test now exists and asserts the exact event sequence `request, error, request, response` with `statusCode` 401 then 200 and one `onUnauthorized` call, pinning that a silently-recovered 401 fires exactly one terminal `onError` before the retry's `onResponse`. The prior coverage gap is closed. | No further action — fix verified in the working tree. |
