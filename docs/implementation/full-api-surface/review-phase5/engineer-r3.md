## engineer — round 3

In-progress review. `reviser-r3` marked my one remaining open finding (`engineer-r2-f1`) `Fixed`; I
re-verified it against the current source and it holds — ratified and `Closed` below. My six round-1
findings were already `Closed` in round 2 and are not re-listed (carry-forward discipline). I also
re-read the full Phase 5 surface as fresh review — `src/auth/{auth-manager,token-store}.ts`,
`src/http/http-client.ts`, `src/rate-limit/{rate-limiter,rate-limits}.ts`,
`src/errors/datto-api-error.ts`, `src/defaults.ts`, `src/util/{sleep,is-record}.ts` — for anything
the r3 fix introduced or that prior rounds missed. No new maintainability / error-handling / DRY
issue meets the actionable bar; the review has converged. No new findings.

### Re-verification note

- **engineer-r2-f1 (raw grant body on malformed-token error)** — `performRefresh`
  (`auth-manager.ts` l.165-177) now throws `new DattoApiError("…malformed token response", {
  statusCode: response.status, cause: parsed.error })` — the `response: response.data` attachment is
  gone, so a 200 grant reply that fails `tokenResponseSchema` (valid `access_token`, bad
  `expires_in`) no longer routes a live bearer token onto the public `DattoApiError.response` field.
  The `cause` is the zod error, which for a numeric-field type mismatch carries "Expected number,
  received string" — not the sibling `access_token` value — so the token does not survive there
  either. The extended test (`tests/unit/auth/auth-manager.test.ts` l.200-214) uses a realistic
  token value (`"live-bearer-token"`), asserts `error.response` is `undefined`, and asserts the
  token string does not appear in the error's own-property serialization. Ratified.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r2-f1 | Medium | Closed | ErrorHandling | `src/auth/auth-manager.ts` l.165-177 | Ratified — the malformed-token-response branch no longer attaches `response: response.data`; it throws with `statusCode`/zod `cause` only, so a live bearer token in a schema-rejected 200 grant body can no longer reach the public `DattoApiError.response` field. Test asserts `response` is `undefined` and the token never appears in the serialized error. | No change; fix confirmed in source and test. |
