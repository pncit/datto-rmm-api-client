## triage — round 1

Phase 3 (instrument the OAuth grant/refresh path). Two reviewers (implementation-auditor,
project-lead) reported **no findings** — no rows below. The remaining five open findings collapse to
four clusters: two are duplicate pairs (URL fidelity; Content-Type duplication), two are single
test-quality items. All are Low severity, all verified against the working tree.

| ID | Route | Detail |
|----|-------|--------|
| architect-r1-f1 | Ruled | Design Change: compose the grant's observed `url` via `this.grantClient.getUri({ url: GRANT_PATH })` (axios's own `buildFullPath`/`combineURLs`), matching the shared instance — the current `` `${apiUrl}${GRANT_PATH}` `` diverges under a trailing-slash `apiUrl`. See Cluster B. |
| engineer-r1-f2 | Ruled | Design Change: same remedy as architect-r1-f1 — normalize the grant capture URL through the grant client's resolver instead of manual concatenation. See Cluster B. |
| architect-r1-f2 | Remediate | (see Cluster A below) |
| engineer-r1-f1 | Remediate | (see Cluster A below) |
| architect-r1-f3 | Remediate | (see Cluster C below) |
| engineer-r1-f3 | Remediate | (see Cluster C below) |
| typescript-cop-r1-f1 | Remediate | (see Cluster D below) |

### Cluster B: grant-URL manual concatenation diverges from the dispatched wire URL
**Members:** architect-r1-f1 and engineer-r1-f2 — the same defect (one framed Architecture, one
Complexity), same site.
**Root cause — and why this is a doc amendment, not a loose code fix.** `performRefresh`
(`src/auth/auth-manager.ts:162`) composes the observed `url` by hand: `` `${this.config.apiUrl}${GRANT_PATH}` ``.
`apiUrl` is validated by bare `z.url()` (`src/client/datto-client-config.ts:39-40`) with **no**
trailing-slash normalization, and `GRANT_PATH` is leading-slash (`"/auth/oauth/token"`,
`auth-manager.ts:43`). So for `apiUrl = "https://host/"` the capture yields
`https://host//auth/oauth/token` while axios's `grantClient.post(GRANT_PATH, …)` dispatches
`combineURLs("https://host/", "/auth/oauth/token") = https://host/auth/oauth/token`. The observed URL
therefore misreports the wire — the exact failure the shared instance avoids by composing via
`instance.getUri(requestConfig)` (`src/http/http-client.ts:388`). This is **pinned in design.md
Decision 5** (line 191: "The grant path composes `apiUrl + GRANT_PATH` (no query params ever attached
there, so no divergence)") — a rationale that reasons only about query-string omission and overlooks
baseURL slash-joining. Because a ratified design decision mandates the current form, a bare code fix
would read as drift from the design; the root remedy is to amend the design, which the plan and code
then follow — hence the tagged `Design Change:` ruling above, not a `Remediate`.
**Remediation approach (Ruled — Design Change, applied via the amendment loop then implemented):**
Amend design.md Decision 5 (and the mirroring lines 102 / 249) so the grant, like the shared
instance, composes its observed `url` through the client's own resolver
(`this.grantClient.getUri({ url: GRANT_PATH })`), which runs axios's `buildFullPath`/`combineURLs`
and yields exactly the dispatched, slash-normalized absolute URL. The plan's mirroring example
(plan.md L397 / L417 / L447) and the `captureRequest({ url: … })` call in `performRefresh` then
follow the amended design.
**Scope boundary:** touches only the `url:` value handed to `captureRequest` in `performRefresh`
(and the design/plan prose that pins it). Do **not** change what axios posts (`grantClient.post`
already normalizes correctly), the `body`/`headers` fields, or the shared-instance interceptor.
**Verification:** after the amendment is ratified and applied — `npm test`; add/extend a grant test
constructing the manager with a **trailing-slash** `apiUrl` and assert the observed
`requestEvent.url` equals the single-slash form axios dispatches (no `//`). Existing
`requestEvent.url` assertions built on a slash-free `BASE_URL` (test L345) must still pass unchanged.

### Cluster A: Content-Type literal duplicated across the wire header and the capture
**Members:** architect-r1-f2 and engineer-r1-f1 — the same defect, same two lines.
**Root cause:** `"application/x-www-form-urlencoded"` is written twice — once as the `grantClient`
default header in the constructor (`auth-manager.ts:82`) and once in the `captureRequest` headers
(`auth-manager.ts:163`). They are meant to be one wire header; nothing ties them, so changing the
dispatched header would silently leave the capture misreporting the old value. This is an
implementation-quality DRY issue below the plan's granularity — the plan example (plan.md L418) is
illustrative, not a mandate against a constant — so it is a straight code `Remediate`, no doc
amendment.
**Remediation approach:** hoist one module-level constant beside `GRANT_PATH` (e.g.
`const GRANT_CONTENT_TYPE = "application/x-www-form-urlencoded";`) and reference it from **both** the
`axios.create({ headers: … })` call and the `captureRequest({ headers: … })` call.
**Scope boundary:** header value only; do not alter the header key, add other headers, or touch the
`Authorization`/`Basic` handling.
**Verification:** `npm test` (existing grant tests assert the observed header set); grep confirms the
literal string appears exactly once in `auth-manager.ts`.

### Cluster C: observer-invariant test gaps on the grant path
**Members:** architect-r1-f3 (single-flight fires events once, not once per caller) and
engineer-r1-f3 (error-path terminal exclusivity). Distinct assertions but the same mechanism —
missing negative/invariant coverage of the grant instrumentation — so remediated together.
**Root cause:** the new `describe` block proves the happy path and raw-error identity but leaves two
invariants unpinned: (1) N concurrent `getToken()` against an empty cache share one `performRefresh`
(`pendingRefresh`, `auth-manager.ts:75`) and must fire `onRequest`/`onResponse` **exactly once**, not
per caller (grant-side R2); (2) the 401 and transport tests (test L385/L413) register **only**
`onError`, so they never prove `onResponse` does *not* also fire on the error path — the malformed-2xx
test does this correctly by registering all three and asserting `["request","response"]`.
**Remediation approach:** add a concurrency test firing several simultaneous `getToken()` calls with
one shared observer and asserting the collected event kinds are exactly `["request","response"]`
(one grant, one event pair); and, in the 401 test, register all three callbacks and assert the
captured kinds are exactly `["request","error"]` (mirror this in the transport-failure test).
**Scope boundary:** test file only (`tests/unit/auth/auth-manager.test.ts`); no production change.
**Verification:** `npm test` green; confirm the new concurrency test fails if a `fire*` call is moved
out of `performRefresh`, and the error-path test fails if `fireResponse` is added to the `catch`.

### Cluster D: unsafe `as string` cast in the grant test
**Members:** typescript-cop-r1-f1.
**Root cause:** `new URLSearchParams(requestEvent.body as string)` (test L348) casts a `unknown` body
to `string`; the preceding `expect(typeof … ).toBe("string")` is a runtime assertion the compiler
cannot see, so the cast is unsound and would mis-type if that line were reordered away.
**Remediation approach:** replace the cast with a compiler-visible narrowing —
`if (typeof requestEvent.body !== "string") throw new Error("expected string body");` then use
`requestEvent.body` directly (or a small local type-guard helper).
**Scope boundary:** the one call site (and any identical sibling casts if present); test file only.
**Verification:** `npm run typecheck` / `tsc --noEmit` and `npm test` pass with no `as` cast on
`requestEvent.body`.

**Ordering:** Cluster B first — it is the root/upstream item (design amendment + the same
`captureRequest` block Cluster A edits), so settle it before touching that call site; then A (same
site), then C and D (test-only, independent).

### Chain watch
None this round — this is round 1 of the phase-3 loop, so no mechanism has churned across two
consecutive rounds here. Awareness note (not a mandate): the "manual concat vs `getUri` URL fidelity"
theme already surfaced in the plan/design review loop (design.md Decision 5 cites `engineer-r1-f1/f2`)
and re-emerged here on the grant site; the Cluster B design amendment is what finally makes the grant
path consistent with the shared instance and should close the theme rather than recur as another spot
patch.

_No `Human` rows — no dossiers this round._
