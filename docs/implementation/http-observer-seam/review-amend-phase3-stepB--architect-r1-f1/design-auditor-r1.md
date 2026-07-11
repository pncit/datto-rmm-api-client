## design-auditor — round 1

Amendment audit for **architect-r1-f1** (grant observed-`url` composed via `getUri` rather than manual
`` `${apiUrl}${GRANT_PATH}` `` concatenation). The `amendment-note.md` records **APPLIED**. I audited the
applied result against the design, the axios runtime, the config schema, and the committed downstream
phases — not a fresh document.

### What the amendment changed (design.md diff verified)
Three edits, all in `design.md`, all reading as originally authored (no revision markers):
1. `DattoHttpRequestEvent.url` comment (Callback payloads, L102) — now "composed via the instance's own
   `getUri` … never a bare relative path or a manual concatenation."
2. Decision 5 URL-composition paragraph (L191) — grant now "composes it the same way, via
   `this.grantClient.getUri({ url: GRANT_PATH })`," with the trailing-slash double-slash divergence spelled
   out; prior text exempted the grant on query-param grounds only.
3. Success Criteria bullet (L249) — grant `url` now composed via `getUri`, "so a trailing-slash `apiUrl`
   resolves the grant URL with a single slash."

No other design location references the grant URL; grep for `GRANT_PATH`/`getUri`/`apiUrl}` in `design.md`
returns only these three edited sites plus the unchanged shared-instance sentence. No stray manual-concat
reference survives.

### Current State Verification
| Claim | Status | Correction (if needed) |
|-------|--------|------------------------|
| Grant client built as `axios.create({ baseURL: config.apiUrl, … })` | Verified | `src/auth/auth-manager.ts:79-80` |
| `GRANT_PATH = "/auth/oauth/token"` is a relative path | Verified | `auth-manager.ts:43` |
| `getUri({ url })` picks up `baseURL` from instance defaults | Verified | `axios@1.18.1`: `getUri(config){ config = mergeConfig(this.defaults, config); return buildURL(buildFullPath(config.baseURL, config.url, …)) }` |
| `combineURLs` strips a trailing slash before joining (single-slash result) | Verified | `combineURLs = baseURL.replace(/\/?\/$/, '') + '/' + relativeURL.replace(/^\/+/, '')` → `https://host/` + `/auth/oauth/token` = `https://host/auth/oauth/token` |
| Manual `` `${apiUrl}${GRANT_PATH}` `` double-slashes under trailing-slash `apiUrl` | Verified | `https://host/` + `/auth/oauth/token` = `https://host//auth/oauth/token` |
| The trailing-slash `apiUrl` case is reachable (not hypothetical) | Verified | `dattoRmmClientConfigSchema.apiUrl` is `z.url()` with **no** trailing-slash normalization/restriction (`datto-client-config.ts:39-43`), so `https://host/` validates |
| Shared-instance URL composition already uses `getUri` (committed Phase 2) | Verified | `src/http/http-client.ts:388 url: instance.getUri(requestConfig)` — **unchanged** by this amendment |
| Requirements table needs no change | Verified | R3/R4 pin grant/pagination *coverage*; R5 pins *body* form; none pin URL-composition mechanics, so scope did not shift |

The amendment's rationale is sound and honest: `getUri` makes the grant instrumentation site resolve the
absolute URL by the same axios join rule the transport actually dispatches — the exact divergence the design
already cites for the shared instance — and closes the trailing-slash gap the prior query-param-only exemption
missed. No contradiction is introduced: Decision 4 (terminal-event selection), the Decision 5 grant header
exception, and the Risks table are all independent of URL composition and remain internally consistent.

### Blast-radius / invalidation check (committed phases 1, 2 + plan)
This change does **not** invalidate committed downstream work. The only observed-`url` composition site the
amendment touches is the **grant path** in `performRefresh` (`auth-manager.ts`), which is **uncommitted
Phase 3** work (working tree; `feat … phase 2` is HEAD; `review-phase3/` in progress). The committed
shared-instance site (Phase 2, `http-client.ts:388`) already uses `instance.getUri(requestConfig)` and is
untouched; Phase 1 (public types / config schema / observer helper) is unrelated to URL mechanics. No
Escalated `Invalidation:` finding is warranted.

Note (not a design defect, no finding): the still-committed `plan.md` Phase 3 steps (L397/L417/L447, echoed
L361) and the in-flight uncommitted grant implementation (`auth-manager.ts:162`) still carry the manual
`` `${this.config.apiUrl}${GRANT_PATH}` `` form; reconciling them to `getUri` is the Phase 3 revision's job
(this very amendment flow), not a design-document issue — recorded here only so the downstream reviser sees it.

## Findings

| ID | Severity | Status | Category | Where | Finding | Recommendation |
|----|----------|--------|----------|-------|---------|----------------|
| design-auditor-r1-f1 | Medium | Closed | DesignDecision | design.md L102, L191, L249 (grant observed-`url` composition) | ratified: the architect-r1-f1 amendment is applied faithfully across all three sites (payload comment, Decision 5 paragraph, Success Criteria bullet). Verified against `axios@1.18.1` (`getUri` merges `this.defaults`, so `baseURL: apiUrl` feeds `buildFullPath`/`combineURLs`, which strips the trailing slash for a single-slash join) and against `datto-client-config.ts` (`apiUrl` is `z.url()` with no trailing-slash restriction, making the double-slash divergence a genuine reachable case). The Requirements table correctly needed no change (R3/R4/R5 pin coverage and body form, not URL mechanics), and no contradiction is introduced elsewhere. Committed Phases 1/2 are not invalidated — the shared-instance `getUri` site (`http-client.ts:388`) is unchanged and the grant path is uncommitted Phase 3. | None — design is coherent; ratified as-is. |
