## design-auditor — round 1

Auditing the amendment recorded in `amendment-note.md` (Decision: **APPLIED**) against the working-tree
`design.md`. The requested change pins every event's `url` to the **absolute resolved** URL
(`baseURL` + path) rather than the bare relative path. This is a targeted refinement of an existing
field, not a scope change — I verified the edits landed everywhere the note claims, that the
composition rules match the actual transport code, and that no surviving text still describes a
bare-relative `url`.

### Current State Verification
| Claim | Status | Correction (if needed) |
|-------|--------|------------------------|
| Grant absolute URL is `${apiUrl}${GRANT_PATH}` (Decision 5, L191; payload L102) | Verified | `src/auth/auth-manager.ts`: `grantClient = axios.create({ baseURL: config.apiUrl })`, `GRANT_PATH = "/auth/oauth/token"` — so `apiUrl + GRANT_PATH` is correct. |
| Shared-instance composition `${requestConfig.baseURL ?? ""}${requestConfig.url ?? ""}` yields `${apiUrl}${path}` (Decision 5, L191; payload L102) | Verified | `src/http/http-client.ts`: `axios.create({ baseURL: config.apiUrl })`; merged `requestConfig.baseURL` holds `apiUrl` at the observer interceptor, `requestConfig.url` holds the path. |

### Amendment coverage
| Site named in note | Landed? |
|--------------------|---------|
| Overview `onRequest` fires with absolute resolved URL (L77) | Yes |
| Payload `url` on request/response/error events (L102, L109, L120) | Yes |
| Decision 5 composition rules + rationale (L191) | Yes |
| Success Criteria absolute-`url` criterion (L249) | Yes |
| Verification absolute-`url` test, resource + grant (L262) | Yes |

No surviving statement in `design.md` describes `url` as a bare relative path; the change is internally
consistent across Overview, payloads, Decision 5, Success Criteria, and Verification.

**Requirements table (left unchanged):** the design lead's decline to add an R-row is coherent — the
`url` form is a field-level refinement pinned in Decision 5, exactly as header-absence is pinned there
(and consistent with how R5 pins body form). Forcing a new requirement row would be additive churn, not
a coherence fix. Ratified as a reasoned decline.

**Plan divergence (not a design finding):** `plan.md` Phase 2 S2 (`url: requestConfig.url ?? ""`, L234)
and Phase 3 (`url: GRANT_PATH`, L318) still capture the bare relative path and now diverge from the
amended design. Per the amendment note this is the plan reviser's to apply, and the plan is downstream
context — "Already-committed downstream phase(s): none yet" — so this change invalidates no committed
work and is not escalated.

## Findings

| ID | Severity | Status | Category | Where | Finding | Recommendation |
|----|----------|--------|----------|-------|---------|----------------|
| design-auditor-r1-f1 | Medium | Closed | DesignDecision | design.md L77, L100-128, L191, L249, L262 | ratified: the absolute-resolved-`url` change is applied faithfully at every site the amendment note claims, the composition rules (`${apiUrl}${path}` for resources, `${apiUrl}${GRANT_PATH}` for the grant) match the actual `baseURL: config.apiUrl` wiring in both transport layers, and no surviving text describes a bare relative `url`. The unchanged Requirements table is a coherent, reasoned decline (field-level form pinned in Decision 5, like header-absence). No contradiction introduced elsewhere. | — |
