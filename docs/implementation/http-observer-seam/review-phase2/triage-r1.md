## mediator — round-1 triage (Mode C)

Stage: **implementation, Phase 2** ("Instrument the shared axios instance"). Artifact of record is
`plan.md`; upstream docs are `plan.md` and `design.md`. Scope verified via `git diff faf57e9`
(`src/http/http-client.ts`, `src/client/datto-rmm-client.ts`, `tests/unit/http/http-client.test.ts`).

Five reviewers reported. `implementation-auditor-r1` and `project-lead-r1` raised **no** findings
(both verified the pinned mechanisms and R2/R4/R5/R6/R7/R8/R9 coverage independently — I concur with
their traces). Four open findings remain, from `architect`, `engineer` (×2), and `typescript-cop`.
I interrogated each against the working tree.

### Route table

| ID | Route | Detail |
|----|-------|--------|
| engineer-r1-f1 | Human | **Verified valid, High.** Observer `url` is `` `${requestConfig.baseURL ?? ""}${requestConfig.url ?? ""}` `` (`http-client.ts:384`), dropping `requestConfig.params`. At interceptor time axios has not yet serialized `params` into the query string, so every filtered list GET (generated endpoints pass `params:` — confirmed across `src/generated/endpoints/**`) and `paginate`'s **first** page (`base-resource.ts:549-550` passes the cursor via `params:`) is observed with its entire query string missing — violating the `DattoHttpRequestEvent.url` "exactly as dispatched" contract (`http-observer.ts:21`). The remedy (`instance.getUri(requestConfig)`, `getUri` confirmed on the AxiosInstance type) **overrides a pinned design + plan decision** (design.md:191 and plan.md:306/325 both explicitly pin `${baseURL}${url}`, blessed by the prior architect-r1-f2 ruling + a design amendment). High severity + overriding a settled ruling that spans the published contract exceeds my Medium/Low authority → human. Dossier below. |
| engineer-r1-f2 | Human | Same root cause / same-mechanism family as f1 (naive concatenation vs axios `combineURLs`/`buildFullPath`: `//` on slash mismatch, and `baseURL`+absolute-`url` addresses). Author states it is **subsumed** by f1's `getUri` fix. Folded into the f1 dossier; the human's ruling on f1 disposes of it. Not separately ruled because it is entangled with the High f1 decision. |
| architect-r1-f1 | Remediate | Verified coverage gap: the observer `describe` block (`http-client.test.ts:490+`) has **no** test exercising the 401/`onUnauthorized` transparent-retry path with an observer (the 401 tests at :385-419 are in a non-observer block). Low, within authority, clear additive test. Cluster B below. |
| typescript-cop-r1-f1 | Remediate | Verified: the two new event-capture arrays widen the tuple's second element to `unknown` and recover it with four unchecked `as DattoHttp*Event` casts. Low, test-only, mechanical. Cluster B below. |

No `Challenge` rows: f1 is verified against the code (not questionable), and f2/architect-r1-f1/
typescript-cop-r1-f1 are all sound. No finding is left settled-yet-reopened.

---

### Remediation plan (Remediate rows only — root-cause-first)

Both Remediate findings live in the single new test file and are best executed in one pass over it.

**Cluster B — observer test-suite hardening** (`tests/unit/http/http-client.test.ts`, observer
`describe` at :490+). Root theme: the new observer tests under-cover one firing branch and lean on
`unknown`+`as` for event typing. One reviser pass fixes both, and the two interact — the new 401
test should be written using the tightened tuple type, not add another `as` cast.

- **architect-r1-f1 — add the 401 transparent-retry sequence test.** Instrument a client with an
  `onUnauthorized` hook + an observer; `nock` a `401` then `200`; assert the event sequence is
  `onRequest`, `onError(statusCode:401)`, `onRequest`, `onResponse(statusCode:200)`. This pins that
  a silently-recovered 401 still emits exactly one terminal `onError` before the retry (a
  load-bearing R2 consequence a compliance consumer sees every token-refresh cycle) and guards the
  `fireError`-above-the-401-branch placement against future refactors.
- **typescript-cop-r1-f1 — remove the `unknown` widening + `as` casts.** Type the capture arrays as
  a discriminated-union tuple, e.g.
  `Array<["request", DattoHttpRequestEvent] | ["response", DattoHttpResponseEvent] | ["error", DattoHttpErrorEvent]>`,
  so indexing narrows via the discriminant. The `onRequest`/`onResponse`/`onError` callbacks already
  receive precisely-typed events at the push site, so no information is lost.
- **Scope:** test file only — no production change, no snapshot/contract change.
- **Verification:** `npm test` (new 401-sequence assertion green; existing observer tests
  unchanged) and `npm run typecheck` (zero `as DattoHttp*Event` casts remain in the file).

*(engineer-r1-f1 / -f2 are NOT in this plan — they route to the human; no code should change on the
URL composition until the human rules, since the fix cascades into design.md and plan.md.)*

---

### Chain watch

- **Phase 3 (grant instrumentation) inherits the URL decision.** The grant path composes its own
  `` `${apiUrl}${GRANT_PATH}` `` at the `performRefresh` dispatch point (plan.md:395/415), not via
  the interceptor, and carries **no** query `params` — so the params defect does **not** reach the
  grant. But if the human rules to adopt `getUri`/serialized-params for f1, the "absolute resolved
  URL (architect-r1-f2)" decision must be re-derived **consistently** across both sites, and the
  grant site (manual composition) will need matching treatment or an explicit carve-out. Flag for
  the Phase 3 reviser.
- **The architect-r1-f2 ruling is partially undercut.** That ruling settled *relative-vs-absolute*
  (host inclusion) only; it never considered query-string fidelity. Whatever the human decides on
  f1, the design.md:102 contract comment (`"exactly as dispatched, e.g. ${apiUrl}${path}"`) and the
  design.md:191 / plan.md:306,325 composition prose must be reconciled with it — otherwise a Phase 3
  reviewer will re-litigate the same tension.
- **Cluster B is self-contained** (test file only) and creates no downstream obligations.

---

### Dossier — engineer-r1-f1 (Human)  ·  covers engineer-r1-f2 (subsumed)

**Finding.** The observer request interceptor composes the observed `url` as
`` `${requestConfig.baseURL ?? ""}${requestConfig.url ?? ""}` `` (`src/http/http-client.ts:384`).
Axios serializes `requestConfig.params` into the query string **after** request interceptors run, so
the observer captures the URL **before** the query string exists. Every request that carries
`params` is therefore observed with its entire query string omitted.

**Repro / blast radius (verified in-tree).**
- Generated endpoints pass filters via `params:` (e.g. `src/generated/endpoints/-v2-device/-v2-device.ts:99`,
  and dozens more) → every filtered list GET is observed without its filter query.
- `BaseResource.paginate` passes the **first** page's cursor via `params:`
  (`src/client/resources/base-resource.ts:549-550`); only *subsequent* pages inline
  `pathname + search` into `url` via `resolveNextPageUrl` → the first page of every walk loses its
  query.
- No test in the observer block (`tests/unit/http/http-client.test.ts:490+`) fires a request with
  `params`, so the gap is uncaught.

**Contract impact.** `DattoHttpRequestEvent.url` is documented "The absolute resolved request URL
(`baseURL` + path) exactly as dispatched" (`src/http/http-observer.ts:21`; design.md:102). "Exactly
as dispatched" is violated for any `params`-bearing call — the core audit/compliance purpose of the
seam (record every outbound exchange faithfully) is undercut.

**engineer-r1-f2 (subsumed).** The same concatenation also diverges from axios's own
`combineURLs`/`buildFullPath`: (a) `baseURL` trailing-slash + leading-slash `url` yields a `//` the
wire never sees; (b) an absolute `url` (which axios dispatches ignoring `baseURL`) is observed as
`baseURL + absoluteUrl`, a nonexistent address. Production callers normalize via `resolveNextPageUrl`
today, so these are latent, but the interceptor is generic to any caller on the shared instance. The
proposed f1 fix resolves both.

**Proposed remedy (author's).** Replace the manual concatenation with `instance.getUri(requestConfig)`
— `instance` is in the interceptor closure (`http-client.ts:364/379`), and `getUri` is confirmed on
the `AxiosInstance` type (`node_modules/axios/index.d.ts:630`); it runs `buildFullPath(baseURL, url)`
and appends the serialized `params`, producing the true dispatched URL and delegating absolute-URL
detection to axios. Add a `params`-bearing GET test (and a paginated-first-page assertion) to lock
fidelity.

**Why this needs a human ruling (not a mediator rule).**
1. **Severity.** f1 is **High**; my authority is Medium/Low non-gap only.
2. **It overrides a settled, pinned decision.** The naive composition is not an implementation
   accident — it is explicitly pinned in **design.md:191** and **plan.md:306 & 325**, each tagged to
   the prior **architect-r1-f2** ruling, which was itself enacted via a design amendment
   (commit `17325eb`) and passed design-auditor review. Correcting it requires **amending both the
   design and the plan** (a `Design Change:` + `Plan Change:`), and reconciling the design.md:102
   contract comment. That cascade across a prior ruling and the published contract is the human's
   call.
3. **A legitimate alternative exists.** The human may instead judge the params-drop acceptable for
   the seam's purpose and **narrow the contract wording** (drop "exactly as dispatched", keep
   `baseURL + path`) rather than change code — a scope/contract trade the mediator should not decide
   unilaterally.

**Decision requested.** Choose one, and authorize the corresponding upstream-doc edits:
- **(A) Fix to full fidelity** — adopt `instance.getUri(requestConfig)` in the interceptor; amend
  design.md:191 and plan.md:306/325 to specify the `getUri`/serialized-params composition; add the
  `params` + paginated-first-page tests. Closes f1 and f2. (Recommended — it is the only option that
  honours the current "exactly as dispatched" contract and the audit purpose.)
- **(B) Accept the limitation** — keep `${baseURL}${url}`; amend the contract (design.md:102,
  `http-observer.ts:21`) to drop "exactly as dispatched" and state the observed URL is the
  pre-serialization `baseURL + path` without query string. Closes f1 as won't-fix; f2 remains a
  latent robustness note.
