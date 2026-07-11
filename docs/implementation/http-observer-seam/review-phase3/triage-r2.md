## triage — round 1, delta 2 (re-assessment only)

Two Cluster-B outcomes landed after the initial triage turn: **architect-r1-f1**'s design change was
ratified and applied (commit `67a6060` amended design.md Decision 5 — the `url` field comment L99, the
capture-and-stash prose L191, and the acceptance bullet L249 — to mandate composing the grant URL via
`this.grantClient.getUri({ url: GRANT_PATH })`); **engineer-r1-f2**'s separately-requested design
change was reviewed and **declined as unnecessary** (design.md is already correct). This delta
re-assesses only what those two outcomes touch. Both remain **settled rulings from triage-r1** and are
carried unchanged — this delta neither re-routes nor restates them as route rows (a delta records no
`Ruled` row); their now-final outcomes are recorded as prose in Cluster B below. No `Challenge` rows
existed in the initial turn, so none to restate. The three surviving Remediate clusters (A / C / D) are
unaffected and are restated verbatim in the route table.

| ID | Route | Detail |
|----|-------|--------|
| architect-r1-f2 | Remediate | (Cluster A — unaffected, restated) |
| engineer-r1-f1 | Remediate | (Cluster A — unaffected, restated) |
| architect-r1-f3 | Remediate | (Cluster C — unaffected, restated) |
| engineer-r1-f3 | Remediate | (Cluster C — unaffected, restated) |
| typescript-cop-r1-f1 | Remediate | (Cluster D — unaffected, restated) |

### Cluster B: grant-URL composition — now settled ground (delta, prose only)
**Status change.** In the initial turn both members were routed `Ruled — Design Change` pending the
amendment loop; they remain governed by those triage-r1 rulings and are **not** re-routed here. That
loop has now closed: the amendment is **applied** (commit `67a6060`). The two outcomes are coherent,
not contradictory — they concern the same single code defect at `auth-manager.ts:162`
(` `${this.config.apiUrl}${GRANT_PATH}` `):
- **architect-r1-f1 → amended.** design.md Decision 5 now pins the `getUri` composition, so the code
  fix is no longer "drift from the design" — it *is* the ratified design.
- **engineer-r1-f2 → declined as redundant.** By the time this was ruled, the design was already
  correct (amended per f1), so a *second* design edit requesting the same normalization was
  unnecessary. The declination rejects the duplicate design change, **not** the code fix.

**Net for the reviser:** exactly **one** code change closes both — in `performRefresh`, replace the
manual concatenation with `this.grantClient.getUri({ url: GRANT_PATH })` (the grant client is built
with `baseURL: config.apiUrl` at `auth-manager.ts:80`, so `getUri` runs axios's own
`buildFullPath`/`combineURLs` and yields the single-slash absolute URL axios dispatches). Do **not**
issue a further design amendment and do **not** treat f2 as a separate remediation. The scope boundary
and verification from the initial turn's Cluster B stand unchanged (touch only the `url:` value handed
to `captureRequest`; add/extend a grant test built with a **trailing-slash** `apiUrl` asserting the
observed `requestEvent.url` has no `//`; existing slash-free `BASE_URL` assertions at test L345 must
still pass).

### Cluster A: Content-Type literal duplicated — unaffected (restated)
Members architect-r1-f2 and engineer-r1-f1. `"application/x-www-form-urlencoded"` is still written
twice — the `grantClient` default header (`auth-manager.ts:82`) and the `captureRequest` headers
(`auth-manager.ts:163`) — confirmed present in the working tree. The Cluster-B outcomes do not touch
the header value, so this row survives unchanged: hoist one module-level constant beside `GRANT_PATH`
(e.g. `const GRANT_CONTENT_TYPE = "application/x-www-form-urlencoded";`) and reference it from both the
`axios.create({ headers })` call and the `captureRequest({ headers })` call. Scope: header value only.
Verification: `npm test`; grep confirms the literal appears exactly once in `auth-manager.ts`.

### Cluster C: observer-invariant test gaps — unaffected (restated)
Members architect-r1-f3 (single-flight fires events once, not per caller) and engineer-r1-f3
(error-path terminal exclusivity). Test-only, independent of the grant-URL composition. Restated
unchanged: add a concurrency test firing several simultaneous `getToken()` calls under one shared
observer asserting collected kinds are exactly `["request","response"]`; and, in the 401 test (mirror
in the transport-failure test), register all three callbacks and assert kinds are exactly
`["request","error"]`. Scope: `tests/unit/auth/auth-manager.test.ts` only. Verification: `npm test`
green; the concurrency test must fail if a `fire*` call is moved out of `performRefresh`, and the
error-path test must fail if `fireResponse` is added to the `catch`.

### Cluster D: unsafe `as string` cast in the grant test — unaffected (restated)
Member typescript-cop-r1-f1. Test-only, independent. Restated unchanged: replace
`new URLSearchParams(requestEvent.body as string)` (test L348) with a compiler-visible narrowing
(`if (typeof requestEvent.body !== "string") throw new Error("expected string body");` then use
`requestEvent.body` directly). Scope: the one call site, test file only. Verification:
`npm run typecheck` / `tsc --noEmit` and `npm test` pass with no `as` cast on `requestEvent.body`.

### Ordering (revised)
Cluster B is now a settled, one-line code change that lands in the **same** `captureRequest` block as
Cluster A's header constant — apply both to that block in a single pass (B's `url:` line + A's
`headers:` line), then C and D (test-only, independent, any order).

### Chain watch
The "manual concat vs `getUri` URL fidelity" theme — which first surfaced in the plan/design loop
(design.md Decision 5 cites `engineer-r1-f1/f2`) and re-emerged here on the grant site — is now closed
at its root: the applied design amendment makes the grant path resolve its URL exactly as the shared
instance does. It should not recur as another spot patch. No two-round mechanism churn to flag.

_No `Human` rows — no dossiers this delta._
