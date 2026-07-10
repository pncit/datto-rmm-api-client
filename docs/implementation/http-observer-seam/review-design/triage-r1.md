# Mediator — Round Triage r1 (design stage)

Reviewers assimilated: `design-auditor-r1`. One reviewer, five open findings
(f1–f5), all Medium/Low, none a Requirements/Research gap. No prior rulings
(`pipeline-run.json` `rulings: {}`). The artifact under review is the design
itself, so every prose remedy the reviser applies is a direct edit to
`design.md` (no upstream doc to amend). I verified each finding's mechanism
against `src/http/http-client.ts` and `src/auth/auth-manager.ts` before routing.

## Route table

| ID | Route | Detail |
|----|-------|--------|
| design-auditor-r1-f1 | Remediate | Cluster A. Verified: rate-limit request interceptor is registered inside `createHttpClient`; `AuthManager.attachTo` registers the Bearer interceptor *later* from a separate module; axios runs request interceptors LIFO. Post-auth/post-throttle observation is real but mechanism-dependent — pin it in Decision 5 + Schema/wiring. |
| design-auditor-r1-f2 | Remediate | Cluster A. Verified: axios reassigns `config.data` to the serialized payload (transformRequest runs after request interceptors) and normalizes `config.headers` to `AxiosHeaders`; re-reading `response.config` at the terminal event loses the object/pre-normalization form. Capture-and-stash at `onRequest` is the fix. |
| design-auditor-r1-f3 | Remediate | Cluster B. R5 is internally contradictory (JSON "object/parsed form" vs "never pre-parsed away from the wire form"). Resolution is already implied elsewhere (payload comment + Key Concepts: "the request object for JSON") — make R5 consistent with it. |
| design-auditor-r1-f4 | Remediate | Cluster C. Decision 5 guarantees `durationMs` excludes throttle wait but no Success Criterion / Verification asserts it. Add one. |
| design-auditor-r1-f5 | Remediate | Cluster B. Verified: `performRefresh` passes `auth:{username,password}`; axios applies the Basic header internally so it never enters a captured header map. Caveat lives only in Risks row 2; the contract text (Decision 5 / payload) overclaims. Relocate/duplicate the caveat to the contract. |

All five valid, all folded into the remediation plan below. No Challenge (none
is wrong), no Ruled (none needs a binding disposition over the reviewer — the
recommendations are sound and the reviser should apply them directly), no Human
(no High/Critical/Blocker, no Requirements/Research gap).

## Remediation plan (root-cause-first)

### Cluster A — Under-specified capture mechanism on the shared instance (f1, f2)
**Root cause.** The design states the *properties* of the observation point
(fires after auth + after throttle; request fields at wire fidelity) but never
specifies the *mechanism* that makes those properties true. Two mechanics decide
it, both currently unstated: (1) request-interceptor registration order, and
(2) capturing request fields at `onRequest` rather than re-reading them off
`response.config` at the terminal event. A Planner reading only the current
Decision 2 / Decision 5 / Schema-and-wiring prose could easily register the
observer interceptor last (→ runs first, before auth) and read request fields
back off `response.config` (→ serialized body, normalized headers).

**Scope of edit (design.md):**
- In Decision 5 (and the Schema-and-wiring paragraph that already invokes the
  `rateDescriptor` augment precedent), pin the shared-instance mechanism: the
  observer's request interceptor is registered **first** inside
  `createHttpClient` so that under axios LIFO ordering it executes **last** —
  after the rate-limit interceptor and after `AuthManager.attachTo`'s
  later-registered Bearer interceptor. State explicitly that this is what makes
  "post-auth, post-throttle" true, since the auth interceptor is attached by a
  different module after the instance is built.
- State that `onRequest` **captures** method/url/headers/body and **stashes**
  that captured payload (alongside the dispatch timestamp) on the per-attempt
  internal request state, and that `onResponse`/`onError` reuse the stashed
  payload for their `request*` fields rather than re-reading `response.config`.
  Tie this to the existing `axios-augment.d.ts` `rateDescriptor` precedent
  already cited for the timestamp.
- Note the grant path (bare `grantClient`, no interceptors) captures at its own
  dispatch point in `performRefresh`, consistent with Decision 2's
  instrument-both-layers stance — so the same capture-and-stash rule applies
  there without an interceptor.

**Verification.** Aligns with existing Risk-row-3 test intent: a test asserting
the observed shared-instance request carries `Authorization: Bearer`, plus a
test asserting the terminal event's `requestBody`/`requestHeaders` are identical
to what `onRequest` observed for the same attempt (object identity / same form,
not the serialized/normalized `response.config` values). Add these to the
Verification list.

### Cluster B — Body-form and header-fidelity contract stated inconsistently (f3, f5)
**Root cause.** The wire-fidelity contract is spread across R5, Decision 5, the
payload comment, Key Concepts, and Risks, and the statements disagree:
R5's "never pre-parsed away from the wire form" contradicts its own "object for
JSON" (f3), and Decision 5 claims the observer sees "the final on-the-wire
headers (including the bearer token)" without the grant's Basic-header exception
that only Risks row 2 records (f5). Both are the same defect: the contract text
overstates "wire form" uniformly instead of the two-case reality (form/urlencoded
= serialized string; JSON = pre-serialization object; grant Basic header absent).

**Scope of edit (design.md):**
- Reword R5 so the two body cases are unambiguous and non-contradictory: JSON
  request bodies are delivered as the **pre-serialization object** (the
  developer-facing form, explicitly *not* the literal wire bytes);
  form/urlencoded (the grant) is delivered as the **serialized string**. Drop or
  reword the "never pre-parsed away from the wire form" clause so it no longer
  contradicts the JSON case. Keep "never pre-redacted." Confirm consistency with
  the `onRequest.body` comment and the Key Concepts "Wire fidelity" bullet
  (which already say "request object for JSON"), so all three agree.
- Move (or duplicate) the grant Basic-header caveat from Risks row 2 into where
  the header contract is *defined* (Decision 5 / payload doc): `Authorization:
  Bearer` is present on shared-instance requests; the grant's `Authorization:
  Basic` (`public-client:public`, non-secret, applied by axios from the
  per-request `auth:` option) is **absent by design** from the captured header
  map, and the API key rides in the captured body instead. Risks row 2 can stay
  as the risk record but the contract must state it directly.

**Verification.** The existing Success Criteria already assert grant body =
serialized urlencoded string and JSON write body = request object; keep those and
ensure R5's new wording matches them. No new test strictly required beyond a note
that the grant terminal event's captured headers do not include `Authorization`.

### Cluster C — Stated `durationMs` guarantee lacks verification (f4)
**Root cause.** Decision 5 promises `durationMs` = dispatch→response, *excluding*
rate-limiter throttle wait — a behavioral guarantee with no Success Criterion or
Verification entry backing it.

**Scope of edit (design.md):** Add a Success Criterion and a matching
Verification bullet: with an injected throttle delay before dispatch, assert the
throttle wait is **not** folded into `durationMs` (i.e., `durationMs` starts at
the post-acquire dispatch point). This dovetails with Cluster A's stash of the
dispatch timestamp — the timestamp must be taken *after* `rateLimiter.acquire`.

**Suggested order.** A → B → C. A pins the capture point (where the timestamp is
taken and where request fields are stashed); C's throttle-exclusion test depends
on A's "timestamp taken after acquire" mechanism; B is independent prose
tightening but reads more cleanly once A has fixed the capture semantics.

## Chain watch

- **Cluster A is a binding implementation constraint, not just prose.** Once the
  design pins "register the observer request-interceptor first → runs last" and
  "capture-and-stash at `onRequest`," the downstream plan and implementation must
  honor both. Plan-stage review should confirm a task exists for the interceptor
  registration order in `createHttpClient` and for the per-attempt stash (reusing
  the `axios-augment.d.ts` internal-state pattern), and that the retry path
  (`handleResponseError` re-invoking `instance.request(config)`) re-runs the
  instrumented interceptor so each retried attempt re-captures and re-stashes.
- **Cluster A vs. R2 per-attempt fidelity.** The stash lives on the per-attempt
  request config; since retries reuse the same `config` object (`RETRY_COUNT_KEY`
  is mutated in place), the plan must ensure the stashed timestamp/payload is
  refreshed on each pass, not carried stale from the prior attempt — otherwise
  `durationMs` (Cluster C) and the per-attempt request fields regress.
- **Cluster C depends on Cluster A.** The throttle-exclusion test only passes if
  the dispatch timestamp is captured after `rateLimiter.acquire`. Keep these two
  edits mutually consistent; a plan task that stamps the timestamp in the wrong
  interceptor order breaks the C verification.
- **Cluster B (grant Basic-header caveat)** should propagate into the plan's test
  matrix for the grant exchange (assert `Authorization` absent, API key present
  in captured body) so the contract and tests do not drift.
- No cross-reviewer conflicts to watch (single reviewer this round). No ruling
  was issued, so nothing to guard against a reviewer re-opening.

## Human dossiers

None — no finding was routed to Human this round.
