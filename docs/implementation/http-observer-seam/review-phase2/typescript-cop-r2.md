## typescript-cop — round 2

Re-scoped to the Phase 2 diff (`src/http/http-client.ts`, `src/client/datto-rmm-client.ts`,
`tests/unit/http/http-client.test.ts`) against the reviser's round-1 disposition.

Verified against the working tree: the observer request interceptor now composes `url` via
`instance.getUri(requestConfig)` (`src/http/http-client.ts:388`) rather than the prior naive
`${baseURL}${url}` concatenation, per the human's Option (A) ruling on `engineer-r1-f1`/`f2` — this
was an architecture/design finding, not mine, and is not re-litigated here. The 401-transparent-retry
test (`architect-r1-f1`) is present at `tests/unit/http/http-client.test.ts:610-643`, also not mine.

My own round-1 finding, `typescript-cop-r1-f1`, is verified fixed: the two `Array<[kind, unknown]>`
capture arrays and their four `as DattoHttp*Event` casts are gone, replaced by a module-level
discriminated-union tuple type (`ObserverEvent`, `tests/unit/http/http-client.test.ts:492-495`) and
three narrowing helpers (`requestPayload`/`responsePayload`/`errorPayload`, lines 497-516) that
recover the concrete payload type via `event[0] !== kind` control-flow narrowing rather than a cast.
The new `params`/paginated-first-page/401-sequence tests added in this round all use the same
tightened type — `grep -n "as DattoHttp" tests/unit/http/http-client.test.ts` returns nothing, and no
new `any`/unsafe casts were introduced anywhere in the round-2 diff (`http-client.ts`,
`datto-rmm-client.ts`, or the test file).

No new type-safety issues found in this round's changes.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|-----------------|
| typescript-cop-r1-f1 | Low | Closed | TypeHole | `tests/unit/http/http-client.test.ts` | Ratified: the `unknown`-widened tuple capture arrays and their `as DattoHttp*Event` casts were replaced with the discriminated-union `ObserverEvent` tuple type and narrowing helper functions; verified no `as DattoHttp*Event` remains anywhere in the file, including the round-2-added tests. | — |
