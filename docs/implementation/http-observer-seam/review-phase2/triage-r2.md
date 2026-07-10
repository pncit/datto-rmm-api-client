## mediator — round-1 triage, DELTA r2 (Mode C, re-assessment-only)

New outcome since `triage-r1.md`: the **human ruled Option (A)** on `engineer-r1-f1` — adopt
`instance.getUri(requestConfig)` in the interceptor; amend `design.md:191` and `plan.md:306/325` to
specify the `getUri`/serialized-params composition; add the `params` + paginated-first-page tests.
This settles f1 and, by the subsumption noted in r1, f2 — both are settled ground, carried by the
human ruling, and are **not** re-routed here (no new Ruled/Human row is recorded in this delta):

- **engineer-r1-f1** — settled by the human (Option A): adopt `instance.getUri(requestConfig)`; amend
  design.md:191 + plan.md:306/325; add the `params` + paginated-first-page tests. Not re-assessed.
- **engineer-r1-f2** — settled: subsumed by f1 per r1; the Option (A) `getUri` fix closes it
  (delegates `combineURLs`/`buildFullPath` + absolute-URL detection to axios). Not re-assessed.

No amendment has landed yet (verified: only `pipeline-run.json` differs in the tree; plan.md:306/325,
design.md:191, and `http-client.ts:384` still carry `` `${baseURL}${url}` ``), so the reviser will
enact both the code fix and the upstream-doc edits.

This delta re-assesses **only** the two `Remediate` rows the ruling touches (both live in the same
test file the ruling now also modifies). There were no `Challenge` rows in r1 to restate.

### Route table (delta)

| ID | Route | Detail |
|----|-------|--------|
| architect-r1-f1 | Remediate | **Survives, approach revised (not mooted).** Still add the 401 transparent-retry sequence test — the ruling touches URL composition, not the 401-branch firing order, so this coverage gap is untouched. Revision: it must now be written **in the same reviser pass** as the ruling-mandated `params`/paginated-first-page tests, on the tightened tuple type from typescript-cop-r1-f1 (below), so the new 401 test adds **no** fresh `as` cast. Assertions unchanged: `onRequest`, `onError(statusCode:401)`, `onRequest`, `onResponse(statusCode:200)`. Cluster B. |
| typescript-cop-r1-f1 | Remediate | **Survives, scope widened (not mooted).** Still replace the `unknown`-widened capture arrays + four `as DattoHttp*Event` casts with the discriminated-union tuple `Array<["request", DattoHttpRequestEvent] \| ["response", DattoHttpResponseEvent] \| ["error", DattoHttpErrorEvent]>`. Revision: the ruling adds new `params`/paginated-first-page tests to this same file, so the tightened tuple type must cover **those** capture arrays too — the reviser must not introduce fresh `as` casts while writing the ruling's tests. Cluster B. |

### Revised remediation (Remediate rows only)

**Cluster B — observer test-suite hardening** (`tests/unit/http/http-client.test.ts`, observer
`describe` at :490+) now folds into a **single reviser pass** with the ruling's mandated tests,
since all three bodies of work land in the one file:

1. Enact the ruling's production change (`getUri`) + its `params`/paginated-first-page tests.
2. Apply typescript-cop-r1-f1's discriminated-union tuple type to **every** observer-event capture
   array in the file — the pre-existing two plus any the ruling's new tests introduce — removing all
   `as DattoHttp*Event` casts and the `unknown` widening.
3. Add architect-r1-f1's 401 transparent-retry sequence test on that tightened type.
- **Verification:** `npm test` (ruling's `params`/paginated + new 401-sequence assertions green,
  existing observer tests unchanged) and `npm run typecheck` (zero `as DattoHttp*Event` casts remain).

### Chain watch (delta)

- The r1 chain-watch flags now go **live**: with Option (A) adopted, the design.md:102 contract
  comment (`"exactly as dispatched"`) is **kept**, and the design.md:191 / plan.md:306,325
  composition prose must be amended to match the interceptor's `getUri` form — the reviser's mandated
  edits. Confirm the two are reconciled so a Phase 3 reviewer does not re-litigate.
- **Phase 3 (grant instrumentation) inherits the divergence.** The grant site composes
  `` `${apiUrl}${GRANT_PATH}` `` manually at `performRefresh` (plan.md:395/415, design.md:190), not
  via the interceptor, so it does **not** pick up `getUri` automatically. It carries no query
  `params`, so the params defect never reaches it — but the shared instance now resolves URLs through
  axios while the grant resolves them by hand. Phase 3 must either give the grant site matching
  treatment or record an explicit carve-out. Flag for the Phase 3 reviser.
