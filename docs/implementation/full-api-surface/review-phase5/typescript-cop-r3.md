## typescript-cop — round 3

All three of my round-1 findings were already ratified `Closed` in round 2 (`typescript-cop-r1-f1`,
`-f2`, `-f3`), leaving nothing of mine to carry forward. Re-scanned the round-3 diff (`engineer-r2-f1`'s
removal of the raw grant `response.data` from the malformed-token-response `DattoApiError`, and
`project-lead-r2-f1`'s `AxiosError` → `unknown` retyping of `handleResponseError`/the response
interceptor's rejection handler plus its new `axios.isAxiosError` guard) against the current source,
and re-swept the rest of the Phase 5 surface (`rate-limiter.ts`, `rate-limits.ts`, `token-store.ts`,
`datto-api-error.ts`, `axios-augment.d.ts`) for anything new. Both round-3 fixes verified sound:

- `performRefresh` (`src/auth/auth-manager.ts:165-177`) no longer attaches `response.data` to the
  malformed-token-response `DattoApiError` — a live bearer token in a well-formed-but-invalid grant
  body (e.g. valid `access_token`, bad `expires_in`) can no longer reach the public `.response` field.
  The extended test asserts both `error.response` is `undefined` and the token is absent from the
  error's own-property JSON serialization.
- `handleResponseError` (`src/http/http-client.ts:246-255`) now takes `error: unknown` (matching
  axios's actual `(error: any) => any` interceptor typing) and guards with
  `if (!axios.isAxiosError(error)) throw error;` before narrowing to `AxiosError`, so an
  already-constructed `DattoApiError` thrown upstream (e.g. by a future `AuthManager.attachTo` request
  interceptor on the same instance) propagates with its real `statusCode`/`response`/`cause` intact
  instead of being lossily reconstructed. The new test registers exactly that upstream-throw shape and
  asserts referential identity of the propagated error.

No new type holes, unsafe casts, boundary-validation gaps, or exhaustiveness regressions found in this
round's diff or the rest of the phase.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|

