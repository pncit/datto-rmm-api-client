## triage — round 1

Phase 4 is the close-out phase: no `src/**` change belongs to it (confirmed via `git status` —
only `README.md` modified plus the untracked `tests/integration/http-observer.test.ts`; every
`src/**` diff is Phases 1–3). So every finding lands on one of three surfaces: the new integration
suite, the README observer/upgrade sections, or the Phase-4 notes. `implementation-auditor-r1`
raised no findings. No prior triage turns and no rulings exist in this loop, so no already-settled
rows to suppress. Every open finding resolves to a concrete, mandated remediation — nothing here is
a judgment dispute (no `Ruled`), a suspected duplicate needing a reviewer's defense (no
`Challenge`), or a decision only the human can supply (no `Human`).

| ID | Route | Detail |
|----|-------|--------|
| typescript-cop-r1-f1 | Remediate | (see Cluster 1 below) |
| engineer-r1-f2 | Remediate | (see Cluster 1 below) |
| typescript-cop-r1-f2 | Remediate | (see Cluster 1 below) |
| typescript-cop-r1-f3 | Remediate | (see Cluster 1 below) |
| project-lead-r1-f1 | Remediate | (see Cluster 2 below) |
| engineer-r1-f3 | Remediate | (see Cluster 2 below) |
| engineer-r1-f1 | Remediate | (see Cluster 3 below) |
| architect-r1-f2 | Remediate | (see Cluster 3 below) |
| architect-r1-f1 | Remediate | (see Cluster 4 below) |
| project-lead-r1-f2 | Remediate | (see Cluster 5 below) |

### Cluster 1: Integration suite papers over the discriminated union with `as` casts
**Members:** typescript-cop-r1-f1 and engineer-r1-f2 are the **same defect** (the `eventsOf` helper
at `tests/integration/http-observer.test.ts:66-68` is not a type-predicate filter, forcing an
`as …[]` cast at every call site — `:93`, `:101`, `:146`, `:149`, `:168`); one filed it Medium/
TypeHole, the other Low/Complexity — reconciled to **Medium**. typescript-cop-r1-f2 (`:199-205`,
casting `terminal[n]!.event` after a runtime `expect().toBe(kind)` that does not narrow) and
typescript-cop-r1-f3 (`:96`, `grantRequest!.body as string` on a deliberately-`unknown` field with
no runtime check) are the **same root cause** at two more sites: a cast standing in for a real
narrow, so a `kind` typo or a reordered `terminal` array or a changed body shape mis-asserts
silently instead of failing to compile. All verified against the file — `eventsOf` does use a plain
`(e) => e.kind === kind` predicate, and `DattoHttpRequestEvent.body` is genuinely `unknown` per
`src/http/http-observer.ts:29`.
**Root cause:** the suite substitutes `as` casts for the narrowing TypeScript would give it for
free on a discriminated union, defeating the very type checking the five published event types
exist to provide.
**Remediation approach:** one refactor pass, not three patches. (a) Make `eventsOf` generic on
`kind` with a type-predicate filter — `function eventsOf<K extends ObservedEvent["kind"]>(events:
ObservedEvent[], kind: K): Extract<ObservedEvent, { kind: K }>["event"][] { return
events.filter((e): e is Extract<ObservedEvent, { kind: K }> => e.kind === kind).map((e) =>
e.event); }` — then delete the five `as …[]` casts at the call sites. (b) At `:199-205`, replace
the `.event as …` casts with an `if (first!.kind !== "error") throw …` / `if (second!.kind !==
"response") throw …` narrow the compiler can follow. (c) At `:96`, guard the body shape — `if
(typeof grantRequest!.body !== "string") throw new Error("expected serialized urlencoded grant
body");` — then use the narrowed `grantRequest.body` with no cast.
**Scope boundary:** touches only `tests/integration/http-observer.test.ts`. Do not weaken any
assertion, change which scenarios are covered, or alter the `ObservedEvent`/`recordingObserver`
shapes. Do this cluster **first**: the Cluster 2 header assertions add new `eventsOf` call sites,
which should be written against the type-safe helper so they introduce no new casts.
**Verification:** `npx tsc --noEmit` (or the repo's typecheck script) and `npx vitest run
tests/integration/http-observer.test.ts` both pass; `grep -n " as Datto" tests/integration/http-observer.test.ts`
returns nothing (every event-shape cast is gone).

### Cluster 2: Integration suite never asserts request headers end-to-end
**Members:** project-lead-r1-f1 (**High**, Requirements — R9's bearer-token half is never asserted
against the real assembled client) and engineer-r1-f3 (Low, Documentation — Phase-4 notes §8 claims
the Basic-auth omission "holds even when observed through the fully assembled client," but no test
inspects the grant request event's headers). Both are the same gap: the suite asserts bodies,
statuses, and error identity but **never a header map**. Verified: no `it(...)` reads
`.headers`/`requestHeaders` anywhere in the file; the §8 claim at
`implementation-phase4-notes.md:190-194` is unbacked; and the account-request Bearer header is only
ever exercised through the *real* `authManager.attachTo` interceptor inside `DattoRmmClient`'s
constructor — the unit suite substitutes a mock, so this phase is the only place the real
observer-first/attachTo-later ordering composes.
**Root cause:** header behavior — the most security-relevant payload R9 promises — is unasserted at
the one layer that assembles the real interceptor stack.
**Remediation approach:** add two header assertions using the (now type-safe) `eventsOf`. (a) In the
first test ("observes the token grant end-to-end…"), capture the account-request `onRequest` event
(filter requests by `ACCOUNT_PATH`) and assert its `headers.Authorization` equals `` `Bearer
${access_token}` `` (i.e. `"Bearer tok-1"` from `stubGrant`), proving the real `attachTo` and
observer interceptors compose in the documented order — this is what closes the R9 gap and the
design Risk-table entry ("instrumentation ordering captures headers before the auth header is
attached"). (b) In the same grant test, assert the grant **request** event's `headers` carries no
`authorization`/`Authorization` key, locking in Phase 3's intentional Basic-auth omission
end-to-end; this makes the §8 notes claim true rather than requiring it be softened. (If the
reviser instead declines (b), §8 must be corrected to say the omission is covered only by Phase 3's
isolated `AuthManager` tests — but adding (b) is cheap and satisfies both the note and the finding.)
**Scope boundary:** `tests/integration/http-observer.test.ts` plus, if (b)'s note is corrected
rather than backed, `implementation-phase4-notes.md` §8. Header-key matching must tolerate
case/normalization as the observer delivers it (`DattoHttpHeaders` is `Record<string, …>`); check
the normalized shape rather than assuming a fixed case.
**Verification:** `npx vitest run tests/integration/http-observer.test.ts` passes; deliberately
break the ordering assumption locally (e.g. assert `"Bearer wrong"`) and confirm the new bearer
assertion **fails** — a reviewer-grade check that the assertion actually exercises the real
composed header, not a tautology. Confirm the grant-request header assertion fails if you inject an
`authorization` key into the stub, proving it would catch a regression.

### Cluster 3: README terminal-event bullets hide the request-field rename
**Members:** engineer-r1-f1 (**Medium**) and architect-r1-f2 (Low) are the **same defect** at the
same location (`README.md:409-412`, the `onResponse`/`onError` bullets) — reconciled to **Medium**.
The bullets say the terminal events are "**adding** `statusCode`, `responseHeaders`, …", implying
the `onRequest` fields carry over unchanged; they do not. Verified against
`src/http/http-observer.ts:38-41,58-61`: `DattoHttpResponseEvent`/`DattoHttpErrorEvent` **rename**
the request-side fields to `requestHeaders`/`requestBody` (vs. `headers`/`body` on
`DattoHttpRequestEvent`), also carry `method`/`url`, and both carry `durationMs` (the README names
`durationMs` only on `onResponse`, never on `onError`). A consumer following the bullets would write
`e.headers`/`e.body` on a terminal event and get `undefined`.
**Root cause:** the "adding" framing describes the delta from the request event but never states the
request fields are renamed, not inherited.
**Remediation approach:** rewrite the two bullets to state that terminal events carry `method`,
`url`, `requestHeaders`, `requestBody` (the request-side fields, **renamed** from `headers`/`body`)
alongside the response/error-specific fields, and that `onError` also carries `durationMs`. Drop or
qualify the "adding" wording so the rename is explicit.
**Scope boundary:** `README.md` observer section only; do not restructure the section or touch the
per-attempt parenthetical beyond what the rename requires. Keep the field names verbatim-matching
the exported types.
**Verification:** every field name in the two bullets appears on the corresponding interface in
`src/http/http-observer.ts`; no bullet references `headers`/`body` (unrenamed) on a terminal event.

### Cluster 4: README/JSDoc raw-credential enumeration omits the API secret
**Member:** architect-r1-f1 (Medium, Security). Verified: the bold warning at `README.md:401-402`
enumerates "the `Authorization: Bearer` token … and the API key in the OAuth token grant's request
body" but omits the **API secret** — which `src/auth/auth-manager.ts:148` sends as `password:
this.config.apiSecret`, and the new test asserts at `:99` (`password === "test-secret"`). The API
secret is the most sensitive of the three credentials, and it is the one missing from the
allowlist a compliance reader anchors on. The mirror JSDoc at `src/http/http-observer.ts:87-88`
has the identical omission.
**Root cause:** the enumeration lists username-equivalent (`apiKey`) but not the password-equivalent
(`apiSecret`) delivered in the same grant body.
**Remediation approach:** add the API secret to both enumerations — e.g. "…the API key **and API
secret** in the OAuth token grant's request body" in `README.md`, and align the matching warning in
`src/http/http-observer.ts:87-88`. (Editing the JSDoc is a Phase-1 file, but it is a one-line
doc-comment alignment the auditor should accept as intent-preserving; the README fix is the in-scope
core.)
**Scope boundary:** the two warning strings only — README warning paragraph and the http-observer
JSDoc block. No behavioral change.
**Verification:** both warnings name bearer token, API key, **and** API secret; the enumeration
matches the three credentials the grant body/headers actually carry per `auth-manager.ts`.

### Cluster 5: README upgrade note gives 0.1.x axios-injectors no pointer to the replacement
**Member:** project-lead-r1-f2 (Medium, BehaviorIntent). Verified: `README.md:561` ("There is no
`axiosInstance` config option") sits in "Upgrading from 0.1.x" item 4 with no cross-reference to the
new observer section — yet the feature's stated premise is to restore exactly the
axios-injection-for-observability capability that migrating reader lost. The reader this feature
exists for hits this line and is handed a dead end.
**Root cause:** the migration note removes the old capability without pointing at its supported
replacement.
**Remediation approach:** add a one-line cross-reference in (or immediately after) item 4 pointing
to [Observing HTTP exchanges](#observing-http-exchanges-httpobserver) as the supported replacement
for the axios-injection observability use case.
**Scope boundary:** `README.md` "Upgrading from 0.1.x" item 4 only; the anchor already exists
(`#observing-http-exchanges-httpobserver`, confirmed at `README.md:380`).
**Verification:** item 4 links to the observer section; the anchor resolves (matches the section
heading slug).

### Chain watch
None this round. This is the first review round of Phase 4, and the integration suite is new this
phase, so no mechanism has churned across two-or-more consecutive rounds. Worth noting for the next
round only: Clusters 1 and 2 both reshape the same new test file — if a follow-up round surfaces
further type-safety or coverage findings in `http-observer.test.ts`, that would be the start of a
churn pattern to remediate holistically rather than spot-patch.
