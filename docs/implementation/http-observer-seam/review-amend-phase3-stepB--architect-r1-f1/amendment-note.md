# Amendment note — Phase 3 Step B / architect-r1-f1

**Decision: APPLIED.**

The requested change is warranted. The grant client is constructed as
`axios.create({ baseURL: config.apiUrl, ... })` (`src/auth/auth-manager.ts`), so the
URL axios actually dispatches for the token grant is the result of axios's own
`buildFullPath`/`combineURLs` join of `apiUrl` and `GRANT_PATH`. That join strips a
trailing slash from `baseURL` before joining, whereas the design's prior manual
`` `${apiUrl}${GRANT_PATH}` `` concatenation double-slashes under a trailing-slash
`apiUrl` (`https://host//auth/oauth/token`) — diverging from the dispatched URL and
producing a dishonest audit artifact. This is the same divergence the design already
cites as its reason for using `instance.getUri(requestConfig)` on the shared instance;
the grant path had been exempted only on query-param grounds, which misses the
slash-joining case. Composing the grant's observed `url` via
`this.grantClient.getUri({ url: GRANT_PATH })` makes the two instrumentation sites
resolve the absolute URL identically and keeps the observed URL faithful to what axios
dispatches.

Edits, all in `design.md`, all reading as originally authored (no revision markers):
the `DattoHttpRequestEvent.url` comment (Callback payloads), the URL-composition
paragraph in Decision 5, and the corresponding Success Criteria bullet. No Requirements
table change was needed — R3/R4 pin grant/pagination coverage, not URL-composition
mechanics, so scope did not shift.
