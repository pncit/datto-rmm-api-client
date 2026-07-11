# Amendment note — Phase 3 Step B / engineer-r1-f2

**Decision: DECLINED (no edit to `design.md`).**

The requested change — normalize the grant capture URL through the grant client's
resolver instead of manual concatenation, "same remedy as architect-r1-f1" — is already
present in the design document and requires no further edit. engineer-r1-f2 is the
implementation-code twin of architect-r1-f1 (it flags the naive
`` `${this.config.apiUrl}${GRANT_PATH}` `` concatenation in `src/auth/auth-manager.ts`),
and the architect-r1-f1 amendment already updated `design.md` to prescribe exactly the
resolver-based approach the finding asks for. All three locations the remedy touches
already read as originally authored with the corrected mechanic: the
`DattoHttpRequestEvent.url` comment in the Callback payloads section ("composed via the
instance's own `getUri` ... never a bare relative path or a manual concatenation"), the
URL-composition paragraph in Decision 5 ("The grant path composes it the same way, via
`this.grantClient.getUri({ url: GRANT_PATH })` ... a manual `` `${apiUrl}${GRANT_PATH}` ``
concatenation would double the slash (`https://host//auth/oauth/token`) and diverge from
the dispatched URL"), and the corresponding Success Criteria bullet ("composed via the
instance's own `getUri` ... for both a resource request and the grant ... so a
trailing-slash `apiUrl` resolves the grant URL with a single slash"). Because the design
already routes both instrumentation sites through axios's own
`getUri`/`buildFullPath`/`combineURLs` join, there is no manual concatenation left in the
design to correct. No Requirements-table change is needed either: R3/R4 pin
grant/pagination coverage, not URL-composition mechanics, so scope did not shift. The
finding is legitimately actionable at the code level (`src/auth/auth-manager.ts`), but it
is not a defect in the design document, so per the instruction I made no edit to
`design.md`.
