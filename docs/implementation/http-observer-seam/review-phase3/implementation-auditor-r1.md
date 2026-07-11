## implementation-auditor — round 1

Scope reviewed via `git diff`: `src/auth/auth-manager.ts`, `src/client/datto-rmm-client.ts`,
`tests/unit/auth/auth-manager.test.ts` (plus orchestration metadata `pipeline-run.json` and the
phase-3 notes file, neither of which is production code). Phase 3 instruments the OAuth
grant/refresh path with the Phase 1 observer primitives; Phases 1–2 are out of scope and were not
re-audited except where Phase 3 consumes their surface.

### Phase Coverage Checklist
| Step | Status | Notes |
|------|--------|-------|
| 1. `httpObserver` on `AuthManagerConfig` (raw/unmasked, doc comment) | ✅ Implemented | New optional `httpObserver?: DattoHttpObserver` with a doc comment explicitly flagging raw/unmasked delivery vs. the masked `logger`. Matches the plan and the Phase 2 `HttpClientConfig` precedent. |
| 2. Capture-and-stash + `fireRequest` at the grant dispatch point | ✅ Implemented | Built through the shared `captureRequest` assembler (not inline): method `"POST"`, absolute `` `${apiUrl}${GRANT_PATH}` ``, headers `{ "Content-Type": ... }` (no `Authorization`), `body = wireBody`. `issuedAt` (L151) and `logger?.debug` (L152) preserved above it; `capture.startedAt` kept distinct from `issuedAt` (comment documents it). |
| 3. `fireResponse` on the resolved 2xx, before `safeParse` | ✅ Implemented | Fires immediately after the `await ...post(...)` resolves and strictly before `tokenResponseSchema.safeParse` (L195), so a malformed-token 2xx emits exactly one terminal event. |
| 4. `fireError` in the existing `catch`, raw error handed off | ✅ Implemented | `fireError(logger, httpObserver, capture, err)` inserted between the preserved `logger?.warn("…refresh failed")` and the unchanged `isAxiosError`→`DattoApiError.fromAxiosError` / non-axios fallback mapping+rethrow. Raw `err` passed, never the mapped `DattoApiError`. |
| 5. Thread `validated.httpObserver` into `AuthManager` (unmasked) | ✅ Implemented | `datto-rmm-client.ts` passes `validated.httpObserver` into the `AuthManager` config alongside the masked `logger`, with a raw/unmasked comment. |
| Tests (grant success, malformed-2xx exclusion, non-2xx/transport terminal selection, raw-error identity, callback isolation) | ✅ Implemented | Five new tests in a dedicated `describe` block cover every scenario the plan's Tests section lists, using `nock` + a discriminated-union event tuple, identity (`not.toBe`) assertions, and `axios.isAxiosError` checks. |

Verification of the pinned mechanics against the diff:
- Terminal-event exclusivity holds: `onError` fires only inside the `catch` (a rejected non-2xx /
  transport failure); `onResponse` fires only on the resolved 2xx; the `safeParse` failure path
  throws without any `fire*` call, so Decision 4 rule 3 is honored (verified by the malformed-token
  test asserting `["request","response"]` and no `error`).
- Raw pass-through is real, not structural: the 401 test asserts `error` is `not.toBeInstanceOf`
  `DattoApiError`, is an axios error, and is `not.toBe` the thrown `DattoApiError` — proving the
  observer sees the raw caught error while the caller still receives the mapped one.
- `requestBody` stash identity is asserted (`responseEvent.requestBody).toBe(requestEvent.body)`),
  matching R5/Decision 5.
- The `wireBody` reuse (single `body.toString()` reused for both capture and POST) is behavior-
  neutral (`URLSearchParams.toString()` is pure); it matches the plan's own opinionated example and
  removes a redundant re-serialization. Not a deviation.
- No existing `performRefresh` line was altered beyond the additive fires: `issuedAt`, both log
  calls, the mapping/rethrow, and the malformed-response throw are intact.

### Drift Report
**Out-of-scope changes:** None. Only the three planned production/test files were modified;
`pipeline-run.json` is orchestration state, not code. No Phase 2/Phase 4 surface was touched.
**Acceptable Phase 3 necessities:** The `wireBody` local (correctness-neutral, enables the capture)
and the duplicated `nock` connect-guard hooks in the new `describe` (harmless, mirrors the existing
suite convention).

The implementation is faithful to the plan letter-and-intent, scoped cleanly to Phase 3, preserves
all existing grant behavior, and the tests meaningfully exercise the terminal-selection and
raw-delivery guarantees (including negative/identity assertions). No actionable issues found.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| — | — | — | — | — | No findings. | — |
