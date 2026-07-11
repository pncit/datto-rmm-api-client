## engineer — round 2

In-progress review of Phase 3 (instrument the OAuth grant/refresh path). Re-verified my three
round-1 findings against the current working tree (diff vs `origin/main`): all three were routed
`Remediate` by triage and marked `Fixed` by reviser-r1. Each fix is present and correct, so all
three close as ratified. No finding was `Rejected` and no human ruling bears on my items, so there
is nothing to weigh or honor beyond ratification.

Verification of the ratified fixes:

- **engineer-r1-f1 (Content-Type duplication):** `const GRANT_CONTENT_TYPE =
  "application/x-www-form-urlencoded";` is hoisted beside `GRANT_PATH` (`src/auth/auth-manager.ts:44`)
  and referenced from both the `axios.create({ headers })` constructor (`:83`) and the
  `captureRequest({ headers })` call (`:161`). The literal now appears once in the file. Ratified.
- **engineer-r1-f2 (grant URL fidelity):** the captured `url` is now
  `this.grantClient.getUri({ url: GRANT_PATH })` (`src/auth/auth-manager.ts:159`), which runs axios's
  own `buildFullPath`/`combineURLs` off the grant client's `baseURL`, so the observed URL matches the
  dispatched wire URL even under a trailing-slash `apiUrl`. A dedicated test constructs the manager
  with `${BASE_URL}/` and asserts `requestEvent.url` is the single-slash form and contains no
  `//auth`, while the slash-free `BASE_URL` assertion still holds. Ratified.
- **engineer-r1-f3 (error-path terminal exclusivity):** both the 401 and the transport-failure tests
  now register all three callbacks and assert the captured kinds are exactly `["request","error"]`
  (proving `onResponse` does not also fire on the error path), mirroring the malformed-2xx test's
  `["request","response"]` exclusivity check. An `errorPayload` tuple-narrowing helper was added
  alongside `requestPayload`/`responsePayload`, and every prior assertion (statusCode, raw-error
  identity, `axios.isAxiosError`, `logger.warn`) is preserved against the narrowed payload. Ratified.

No new findings. The Phase 3 production surface (`performRefresh` instrumentation and the
`datto-rmm-client.ts` threading) reads cleanly: the terminal-event ordering (`fireResponse` before
`safeParse`; `fireError` handed the raw caught error before the `DattoApiError` mapping) is correct,
the raw/unmasked observer threading is documented at both client call sites, and the grant path
routes every capture/fire through the shared `observer.ts` primitives rather than inlining.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | Low | Closed | MagicValues | `src/auth/auth-manager.ts:44,83,161` | Content-Type literal duplication. | Ratified — `GRANT_CONTENT_TYPE` constant hoisted and referenced at both the constructor header and the `captureRequest` header; literal appears once. |
| engineer-r1-f2 | Low | Closed | Complexity | `src/auth/auth-manager.ts:159` | Observed grant URL built by manual concatenation, diverging from the wire URL under a trailing-slash `apiUrl`. | Ratified — captured `url` now composed via `this.grantClient.getUri({ url: GRANT_PATH })`; trailing-slash test asserts no `//auth`. |
| engineer-r1-f3 | Low | Closed | ErrorHandling | `tests/unit/auth/auth-manager.test.ts` (401 and transport-failure tests) | Error-path tests registered only `onError`, never proving `onResponse` does not also fire. | Ratified — both error-path tests register all three callbacks and assert kinds are exactly `["request","error"]`; `errorPayload` helper added without an `as` cast. |
