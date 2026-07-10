# Amendment Note — review-amend-plan-p2 / architect-r1-f2

**Decision: APPLIED.**

The requested change is warranted and has been applied to `docs/implementation/http-observer-seam/design.md`. The design frames the observer payload as an audit artifact for "every outbound HTTP exchange" at wire fidelity (Problem Statement, Vision, Goals), yet the `url` field was previously left unspecified (`url: string;`) and the plan captured a bare relative path (`requestConfig.url ?? ""` / `GRANT_PATH`). A bare relative path cannot record which host each exchange hit, so it is an incomplete artifact for that compliance purpose — the reviewer's objection is correct.

**Edits made:**
- **Callback payloads (design L100–128):** annotated `DattoHttpRequestEvent.url` as the **absolute resolved** request URL (`baseURL` + path), e.g. `` `${apiUrl}${path}` `` for a resource request and `` `${apiUrl}${GRANT_PATH}` `` for the grant — never a bare relative path; and annotated the matching `url` on `DattoHttpResponseEvent` and `DattoHttpErrorEvent` as the same captured absolute URL.
- **Overview:** `onRequest` now fires with the **absolute resolved** URL (`baseURL` + path).
- **Decision 5:** added the concrete composition rules — the shared instance builds `` `${requestConfig.baseURL ?? ""}${requestConfig.url ?? ""}` `` at the dispatch point, the grant path builds `apiUrl + GRANT_PATH` — with the rationale that a bare relative path is an incomplete audit artifact.
- **Success Criteria** and **Verification:** added a criterion/test that every event's `url` is the absolute resolved URL for both a resource request and the grant, never a bare relative path.

**Requirements table:** left unchanged. Scope did not shift — pinning the `url` form refines the field-level semantics of the existing "observe every exchange" requirements (R1–R4), and is captured in Decision 5 consistent with how body-form (R5) and header-absence are pinned there rather than as separate requirement rows.

The plan-side changes named in the request (Phase 2 S2 capturing `` `${requestConfig.baseURL ?? ""}${requestConfig.url ?? ""}` ``, Phase 3 S2 capturing `apiUrl + GRANT_PATH`, and the added absolute-`url` test) are downstream of this design and are the plan reviser's to apply; the design now specifies the absolute-URL contract they must implement.
