## design-auditor — round 1

Amendment under audit: the requested change is engineer-r1-f2 — normalize the grant
capture URL through the grant client's resolver (`getUri`) instead of manual
`` `${apiUrl}${GRANT_PATH}` `` concatenation, "same remedy as architect-r1-f1." The design
lead recorded a **reasoned decline** (`amendment-note.md`, no edit to `design.md`) on the
ground that the design already prescribes the resolver-based approach — the twin
architect-r1-f1 amendment having already applied it — so the finding is actionable only at
the code level (`src/auth/auth-manager.ts`), not against the design document.

I audited the decline for faithfulness, coherence, scope, and downstream blast radius.

### Current State Verification
| Claim | Status | Correction (if needed) |
|-------|--------|------------------------|
| design.md L102 `DattoHttpRequestEvent.url` comment prescribes `getUri` ("never … a manual concatenation") | Verified | — |
| design.md L191 (Decision 5) composes the grant URL via `this.grantClient.getUri({ url: GRANT_PATH })` and explicitly rejects the manual `${apiUrl}${GRANT_PATH}` double-slash | Verified | — |
| design.md L249 (Success Criteria) pins `getUri` for both resource and grant, single-slash on trailing-slash `apiUrl` | Verified | — |
| No prescribed manual concatenation for the grant remains in the design (both `${baseURL}${url}` and `${apiUrl}${GRANT_PATH}` appear only as rejected alternatives) | Verified | — |
| Remedy is feasible: `grantClient` is built with `baseURL: config.apiUrl` (auth-manager.ts L79–83), so `getUri({ url: GRANT_PATH })` resolves the absolute URL correctly | Verified | — |
| R3/R4 cover grant/pagination *coverage*, not URL-composition mechanics — no scope shift, no Requirements-table change needed | Verified | — |
| Decline makes no edit, so committed Phases 1–2 are untouched — no downstream invalidation | Verified | — |

The decline is faithful (the design text says exactly what the note claims), coherent (an
implementation-code finding whose design twin was already applied is correctly declined at
the document level rather than folded in again), scope-clean (R3/R4 unaffected), and
introduces no new contradiction — a decline that edits nothing cannot. The pre-existing
design↔plan/code divergence the finding targets (plan Phase 3 and auth-manager.ts still use
manual concatenation) is precisely the code-level defect the note concedes is real and
routes to the engineer; it is not a design-document defect and is out of scope for this
audit. Ratifiable decline; converged.

## Findings

| ID | Severity | Status | Category | Where | Finding | Recommendation |
|----|----------|--------|----------|-------|---------|----------------|
| design-auditor-r1-f1 | Low | Closed | DesignDecision | amendment-note.md vs design.md L102/L191/L249 | ratified: the decline of engineer-r1-f2 is a coherent, reasoned outcome — the design already prescribes `getUri`-based grant-URL composition (verified at all three cited locations, mutually consistent, with manual concatenation present only as a rejected alternative), the remedy is feasible (`grantClient` has `baseURL: apiUrl`), R3/R4 need no change, and no edit means no new contradiction and no downstream invalidation. The finding is legitimately actionable at the code level only. | None — decline stands. |
