## engineer — round 2

In-progress review. Read my `engineer-r1` turn (8 Open findings) and the reviser's `reviser-r2`
disposition (all 8 marked `Fixed`), then re-verified each `Fixed` claim against the current
`plan.md` and the upstream-amended `design.md`. Also re-walked the five plan axes (DRY/reuse →
abstraction/complexity → error-handling/logging → naming/intent → config/magic values) for issues
introduced by the revisions. Converging as expected: every prior finding is genuinely resolved and
no new real issue surfaced.

Verification notes per finding:
- **f1** — Design R8 + Decision 4 + `DattoHttpErrorEvent.error` now say `unknown`; the plan removed
  `mapObserverError` entirely (grep confirms every remaining mention is a negation), `fireError`'s
  signature is `(logger, observer, capture, rawError: unknown)` and passes the raw error straight
  through at both the shared-instance (L311) and grant (L400/L429) sites. The 429-divergence root
  cause is dissolved because nothing re-maps. Ratified.
- **f2** — Phase 3 Steps 2/4 and the example (L395, L400–402, L409–440) now preserve `issuedAt`
  (L141), `logger?.debug` (L142), `logger?.warn` (L156/L168) verbatim (marked `UNCHANGED`), firing
  the observer *around* them; `startedAt` is stated distinct from the `issuedAt` TTL anchor. Ratified.
- **f3** — `captureRequest` is now the single shared assembler in `observer.ts` (Step 5, L70) owning
  method-uppercasing + `normalizeHeaders` + `startedAt`; both the Phase 2 interceptor (L306) and
  Phase 3 `performRefresh` (L395/L413) build every capture through it, no inline capture. Ratified.
- **f4** — `observer.ts` export surface is fully enumerated (L67–72) and `mapObserverError` is
  correctly absent; `fireError`'s response-field narrowing rule is pinned
  (`axios.isAxiosError(rawError) && rawError.response`; non-axios → no response fields, L74). Ratified.
- **f5** — `invokeObserver` now takes `callbackName` and names the failing callback in both the warn
  message and `meta` (L71, example L192/L198); the Phase 1 test asserts attribution (L271). Ratified.
- **f6** — Human ruling kept the global augment; the plan muddle is fixed — Phase 2 reads
  `error.config?.__dattoObserverCapture` directly with no `RetryTrackedConfig` cast, and the
  `__datto`-prefix vs unprefixed-`rateDescriptor` note is reconciled (L313). Ratified (honored ruling).
- **f7** — The `handleResponseError` 6th-positional-param change is now stated in Step 4 prose with
  the full signature (L311). Ratified.
- **f8** — Phase 2 S1 (L305) and Phase 3 S1 (L394) instruct a doc comment on each new `httpObserver`
  field noting raw/unmasked delivery unlike the adjacent `logger`. Ratified.

### Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | High | Closed | ErrorHandling | Phase 1 S5 (L74); Phase 2 S4 (L311); Phase 3 S4 (L400) | Human ruling applied: `onError.error` typed `unknown`, `mapObserverError` removed, raw error handed straight through; the 429/`buildRateLimitError` divergence is dissolved because nothing re-maps. | Ratified — no change. |
| engineer-r1-f2 | Medium | Closed | Logging | Phase 3 S2/S4 + example (L395, L400–402, L409–440) | Existing `issuedAt`/`logger?.debug`/`logger?.warn` are now preserved verbatim; observer fires around them, `startedAt` kept distinct from `issuedAt`. | Ratified — no change. |
| engineer-r1-f3 | Medium | Closed | DRY | `observer.ts` `captureRequest` (L70); Phase 2 (L306), Phase 3 (L395/L413) | Shared capture-and-stash assembler added; both sites route through it, so method-casing/header handling cannot drift. | Ratified — no change. |
| engineer-r1-f4 | Medium | Closed | Complexity | Phase 1 S5 (L67–74) | `observer.ts` export surface fully enumerated (no `mapObserverError`); `fireError`'s response-field narrowing rule pinned. | Ratified — no change. |
| engineer-r1-f5 | Medium | Closed | Logging | Phase 1 `invokeObserver` (L71, example L192/L198); test (L271) | `callbackName` threaded and named in the swallow warn message + `meta`; test asserts attribution. | Ratified — no change. |
| engineer-r1-f6 | Medium | Closed | Complexity | Phase 2 S4 (L311, L313) | Human ruling kept the global augment; plan now reads the stash directly off `error.config` with no bogus `RetryTrackedConfig` cast, and reconciles the `__datto` prefix note. | Ratified — honored ruling. |
| engineer-r1-f7 | Low | Closed | Complexity | Phase 2 S4 (L311) | Signature change stated in prose with the full 6-arg form; options-object refactor noted as optional. | Ratified — no change. |
| engineer-r1-f8 | Low | Closed | Documentation | Phase 2 S1 (L305); Phase 3 S1 (L394) | Doc comment instructed on each new `httpObserver` field noting raw/unmasked delivery. | Ratified — no change. |
