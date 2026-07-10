## plan-auditor — round 2

Reconciled the four round-1 findings against the revised `plan.md` and re-verified each fix against
the repository, then hunted for new issues. All four are resolved; no new finding surfaced.

### Reconciliation (re-verified against the repo)

- **r1-f1 (fireError signature)** — ratified. Phase 1 S5 now pins one signature
  `fireError(logger, observer, capture, rawError, mappedError: DattoApiError)` and states "every
  caller pre-maps … so `fireError` never maps internally." All three call sites hand a finished
  `DattoApiError` in the 5th position: Phase 2 example `fireError(logger, httpObserver, cap, error,
  mapObserverError(error, build403Error))`; Phase 2 Step 4 prose matches; Phase 3 example
  `fireError(…, capture, err, mapped)`. No call passes the bare `build403Error` mapper. The internal
  403/`fromAxiosError` mapping now lives only in `mapObserverError`, whose `error.response?.status
  === 403` branch matches the real `build403Error` throw at `http-client.ts:259-261` (verified).
- **r1-f2 (self-defeating axios gate)** — ratified. Phase 1 exit gate replaced the whole-file
  `! grep -iq 'axios' …` with `! grep -Eq "from ['\"]axios['\"]" src/http/http-observer.ts` plus
  `! grep -Eq '\bAxios[A-Z]' src/http/http-observer.ts`; the Phase 1 example doc comment now reads
  "always a mapped DattoApiError; never the raw transport error" (no "axios" substring). The example
  `http-observer.ts` imports only `zod` and `../errors` and contains no `Axios[A-Z]` token, so a
  verbatim-faithful implementation passes its own gate. Phase 4's gate carries no axios source grep
  (that file isn't edited there), consistent.
- **r1-f3 (export-location divergence from design line 267)** — honored/closed. Escalated in round 1
  and ruled by the human: accept the `index.ts`-direct placement (matching the verified `DattoLogger`
  precedent) and amend the design (lines 267 / 87 / 95). The plan correctly retains `index.ts`-direct
  (Phase 1 S3). Per settled-item discipline I do not re-raise; the design-text correction is the
  driver's cross-stage task and is out of plan-review scope.
- **r1-f4 (dist invariant not gated at the introducing phase)** — ratified. Phase 2 and Phase 3
  exit gates now both carry `npm run build` and `! grep -q 'declare module' dist/index.d.ts`, with a
  note explaining that these phases first make axios-importing `src/http/observer.ts` reachable from
  the `index.ts` value graph (via `http-client.ts` / `auth-manager.ts`). No blanket
  `grep 'axios' dist/index.d.ts` was added (dist legitimately references `AxiosInstance`/`AxiosError`).

### New-issue hunt (verified, no finding)

- Phase 2 Step 4 fire placement re-checked against `handleResponseError` (`http-client.ts:246-330`):
  the fire sits immediately after the `!axios.isAxiosError` guard (line 255), i.e. **before** the
  `status === 403` throw (259), the `!config` throw (263), and every retry branch — so 403 and all
  retryable statuses (401/429/5xx/network) each fire exactly one `onError` per attempt via
  `mapObserverError`. Sound.
- Phase 3 restructuring re-checked against `performRefresh` (`auth-manager.ts:134-187`): `let
  response` scope, `body.toString()` wire string, the axios/non-axios `catch` mapping
  (`fromAxiosError` / `DattoApiError(statusCode:0, "…authentication failed")`), and `safeParse` after
  the 2xx all match; firing `onResponse` before `safeParse` correctly makes a malformed-token 2xx a
  single `onResponse` terminal event. Symbols `GRANT_PATH`, `BASIC_AUTH_USERNAME/PASSWORD`,
  `tokenResponseSchema` exist as used.
- LIFO ordering re-confirmed: observer registered first → runs last (post-Bearer, post-throttle);
  Bearer-before-rate-limit order preserved; a Bearer `getToken()` throw aborts before the observer
  interceptor runs (no stash) so no shared-instance `onError` double-fire. `RetryTrackedConfig`
  exists as referenced.

## Findings

| ID | Severity | Status | Category | Finding | Recommendation / update |
|----|----------|--------|----------|---------|-------------------------|
| plan-auditor-r1-f1 | Medium | Closed | Consistency | — | ratified: `fireError` pinned to one signature taking a pre-mapped `DattoApiError`; all three call sites pass a finished `DattoApiError`, none passes `build403Error`; internal mapping now only in `mapObserverError`. |
| plan-auditor-r1-f2 | High | Closed | Consistency | — | ratified: Phase 1 gate narrowed to `from ['"]axios['"]` + `\bAxios[A-Z]` checks and the example doc comment stripped of "axios"; a faithful implementation passes its own exit gate. |
| plan-auditor-r1-f3 | High | Closed | DesignAlignment | — | honored: escalated and human-ruled — accept `index.ts`-direct placement (matches the `DattoLogger` precedent) and amend the design; plan correctly retains `index.ts`-direct. Not re-raised. |
| plan-auditor-r1-f4 | Low | Closed | Test | — | ratified: `npm run build` and `! grep -q 'declare module' dist/index.d.ts` added to the Phase 2 and Phase 3 exit gates, catching a dist leak at the phase that introduces the axios-importing reachability. |
