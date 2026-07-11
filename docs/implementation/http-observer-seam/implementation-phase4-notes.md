# Implementation Notes — Phase 4

- **Plan:** HTTP Observer Seam (`docs/implementation/http-observer-seam/plan.md`)
- **Phase:** 4
- **Date:** 2026-07-10
- **Agent:** Implementor

---

## 1. Phase Scope Confirmation

**In-Scope (Phase 4 only):**
- Assembled-client integration tests (`tests/integration/http-observer.test.ts`, new) exercising
  `createDattoRmmClient({ ..., httpObserver })` end-to-end via `nock`, covering the cross-layer
  scenarios that only exist once both transport layers (Phase 2's shared instance, Phase 3's grant
  client) are wired together: the grant observed ahead of the first resource call, a multi-page
  paginated read, a lazy-refresh grant failure's single `onError`, and a `429 → retry → 200`
  resource read.
- README documentation: a new "Observing HTTP exchanges (`httpObserver`)" section, plus small
  touch-ups to the "Features" and "Exported types" sections pointing at it.

**Explicitly Out-of-Scope:**
- Any change to `src/http/http-observer.ts`, `src/http/observer.ts`, `src/http/http-client.ts`,
  `src/auth/auth-manager.ts`, `src/client/datto-client-config.ts`, `src/client/datto-rmm-client.ts`,
  or `src/index.ts` — all production wiring was completed in Phases 1–3. This phase adds **no new
  production behavior**, per its own Goal statement.
- Any new unit test in `tests/unit/**` — Phases 1–3 already cover every unit-level scenario; this
  phase's job is the assembled-client (integration) view and documentation only.

---

## 2. Phase Intent (Interpreted)

Prove, through the actual public entry point (`createDattoRmmClient`) rather than through either
transport layer in isolation, that the seam Phases 1–3 built behaves correctly once both layers
are wired together — closing out the design's Success Criteria items that specifically require the
*assembled* client (the lazy-refresh grant-failure exclusion, an end-to-end paginated read, a
retried resource read observed through the real client) — and document the raw-delivery contract
for a consumer deciding whether/how to use `httpObserver`.

---

## 3. Files Touched

| File | Change Type | Rationale |
|------|------------|-----------|
| `tests/integration/http-observer.test.ts` | Created | Assembled-client integration coverage (Step 1): grant-observed-end-to-end, N-page pagination, lazy-refresh single-`onError`, 429→retry→200, and additive-only sanity (no `httpObserver`). |
| `README.md` | Modified | New "Observing HTTP exchanges (`httpObserver`)" section (Step 2), a "Features" bullet pointing at it, and an "Exported types" entry listing the five observer types. |

---

## 4. Implementation Summary

**`tests/integration/http-observer.test.ts`** follows the existing integration/public-surface test
conventions (`tests/unit/client/surface.test.ts`'s `@/index` import + `config()` helper pattern,
and `tests/integration/fixtures.test.ts`'s placement under `tests/integration/`). It builds a real
`DattoRmmClient` via the public `createDattoRmmClient` factory against `nock`-stubbed HTTP, using a
`recordingObserver` helper that appends every fired event (tagged `request`/`response`/`error`, in
fired order) to a plain array — proving the wiring end-to-end rather than re-testing either
transport layer's internals (already done in Phases 2/3's unit suites):

1. **Grant observed end-to-end (R3).** `client.account.get()` triggers a lazy token fetch before
   the account GET. Both the grant's request/response events and the account request/response
   events are asserted independently by matching on `url`; the grant request event's `body`,
   parsed via `URLSearchParams`, carries the exact `apiKey`/`apiSecret`/`grant_type` fields as the
   raw wire string (not a JSON-serialized object), and the grant response event's `statusCode` is
   `200`.
2. **N-page pagination (R4).** `client.account.devices()` walks two pages (`nextPageUrl` chaining
   to a `?page=2` cursor, then `null`); filtering the recorded events to those whose `url` starts
   with the devices path proves exactly 2 request events and 2 terminal (`onResponse`) events —
   one pair per page, matching the plan's "N pages ⇒ N request + N terminal events" success
   criterion.
3. **Lazy-refresh grant failure — single `onError` (Decision 4 rule 2).** The grant POST is stubbed
   to return 401 (no successful grant available). `client.account.get()` rejects with
   `DattoApiError` (the SDK's own thrown error), while the observer records **exactly one**
   `onError` — on the grant attempt (`url` = the grant path, `statusCode` 401, `error` the raw
   `AxiosError`, `not.toBeInstanceOf(DattoApiError)`) — and asserts no second `onError` was ever
   recorded for the account-request URL, since the Bearer interceptor's `getToken()` throw is a
   non-axios reject the shared instance's `!axios.isAxiosError` guard rethrows before ever reaching
   `fireError` (the exact mechanism Phase 2's own doc comment on `handleResponseError` describes).
4. **`429 → retry → 200` through the assembled client (R2/R6).** The account GET is stubbed to
   return 429 with `Retry-After: 0` once, then 200. The recorded account-URL events' terminal
   (non-`request`) subsequence is asserted to be exactly `[onError(429), onResponse(200)]` — two
   fully observed attempts, matching Phase 2's own unit-level assertion but now exercised through
   the real client's rate limiter/retry/auth stack rather than a bare `createHttpClient` instance.
5. **Additive-only sanity.** A client constructed with **no** `httpObserver` at all still resolves
   `client.account.get()` normally, confirming the seam's complete absence changes nothing about
   request outcomes (no observer object exists to assert "no events fired" against directly, so
   this test's job — per the plan's own phrasing, "leaves request outcomes ... unchanged" — is the
   outcome assertion, not an event-count assertion of zero, which Phases 1–3's unit tests already
   establish at the primitive level: `fireRequest`/`fireResponse`/`fireError` are each a no-op when
   `observer` is `undefined`).

**`README.md`** gained:
- A "Features" bullet ("Optional HTTP observer") linking to the new section, alongside the existing
  feature bullets.
- A new `## Observing HTTP exchanges (\`httpObserver\`)` section (placed directly after "Logger
  injection & UDF masking" — the closest existing sibling topic, config-level observability — and
  before "Validation"), documenting: the `httpObserver` config shape and a minimal usage example;
  a prominent "Raw, un-redacted delivery" warning naming the bearer token and API key explicitly;
  each of the three callbacks' firing condition and payload fields; the per-attempt (not
  per-logical-call) semantics with the `429 → retry → 200` example; the two internal exchanges
  covered (grant/refresh, pagination pages); the callback-failure-isolation guarantee; and the
  five-exported-types / axios-free summary.
- An "Exported types" bullet listing the five observer types with a link back to the new section,
  alongside the existing `DattoRmmClientConfig`/`DattoLogger` bullet.

---

## 5. Deviations From Plan (If Any)

No deviations. The plan's two steps (integration tests, README section) were both implemented as
specified; the plan's own "Opinionated Implementation Notes" example (a single `events` array of
`[kind, event]` tuples) is followed in spirit via the `recordingObserver`/`ObservedEvent` pattern,
adapted to a tagged-object form (`{ kind, event }`) rather than a `[string, unknown]` tuple, which
lets every assertion `filter`/`find` by both `kind` and `event.url` without repeated destructuring
or `as` casts at each call site — a direct, minor readability improvement over the plan's own
sketch, not a deviation from its intent (the plan's example is explicitly "Opinionated
Implementation Notes", i.e. guidance, not a mandate).

One small addition beyond the plan's minimum README ask: a "Features" bullet and an "Exported
types" entry, in addition to the dedicated section the plan calls for. This is the same
"tightly-related, phase-intent-preserving" completion the plan's own Implicit Intent Handling
guidance permits — the plan's Goal explicitly says this phase closes out the design's Success
Criteria, one of which ("`DattoHttpObserver`... exported from `src/index.ts`") is only genuinely
*documented* for a reader if the curated "Exported types" list — the README's canonical export
inventory — actually names the five new types; leaving that list stale while writing a full
dedicated section elsewhere would be an inconsistent, incomplete documentation pass.

---

## 6. Ambiguities & Decisions

- **Which resource call to use for the non-paginated grant/429/lazy-refresh scenarios.**
  `client.account.get()` (a bodiless `GET /api/v2/account` with an entirely-optional response
  schema) was chosen over inventing a new nock-friendly endpoint, since every field on
  `getUserAccountResponse` is optional — an empty `{}` stub body validates without any fixture
  data, keeping each test's stub minimal and focused on the observer assertions rather than on
  constructing a realistic account payload.
- **Which paginated call to use for the N-page scenario.** `client.account.devices()` was chosen
  over inventing a new paginated method, since `AccountResource.devices()` already routes through
  `BaseResource.paginate` against `/api/v2/account/devices` with a `devices` array key and a
  `Device` item schema whose every field (including `uid`) is optional — so a minimal
  `{ uid: "device-N" }` stub item validates cleanly, keeping the fixture data minimal.
- **Filtering recorded events by `url` rather than asserting a fixed total count.** The full
  `events` array recorded across a scenario mixes grant events and resource events (and, in the
  429 scenario, three account-URL attempts across the retry). Asserting a bare `events.length`
  would be fragile against a legitimate future change to how many *other* URLs a scenario touches;
  filtering by the specific `url` under test (the devices path, the grant path, the account path)
  isolates each assertion to exactly the exchange the test scenario is about, matching how Phase
  2/3's own unit tests already isolate their assertions per scenario.
- **`recordingObserver` return-type annotation.** Typed the helper's return as `DattoHttpObserver`
  explicitly (rather than letting it infer) so a future accidental typo in one of the three
  callback names (`onRequest`/`onResponse`/`onError`) fails to compile instead of silently building
  an object with an extra, never-invoked key — the same "assert the type at the boundary" instinct
  Phase 1's own `fireRequest`/`fireResponse`/`fireError` signatures already apply.

---

## 7. Tests

`tests/integration/http-observer.test.ts` (new, 5 tests), all via `nock` against the real,
publicly-constructed `DattoRmmClient`:
- Grant observed end-to-end, with the request event's `body` — parsed via `URLSearchParams` — an
  exact match for the raw urlencoded wire string (`grant_type`/`username`/`password`), and both the
  grant's and the account GET's own `onResponse` events present and `statusCode: 200` (R3). The
  grant request event's `headers` is asserted to carry no `authorization`/`Authorization` key
  (Phase 3's intentional Basic-auth omission, locked in end-to-end), and the account request
  event's `headers.Authorization` is asserted to equal the real `Bearer <token>` value produced by
  the real `AuthManager.attachTo` interceptor — proving the observer-first/attachTo-later
  interceptor order composes correctly against the real object graph (R9).
- A 2-page `client.account.devices()` paginated read fires exactly 2 request + 2 terminal
  (`onResponse`) events for the devices-path URL, matching the returned `devices` array's length of
  2 (R4).
- A grant POST returning 401 (no successful grant reachable) yields exactly one `onError` overall
  — on the grant attempt, with the raw `AxiosError` (`not.toBeInstanceOf(DattoApiError)`,
  `axios.isAxiosError(...) === true`) — while `client.account.get()` still rejects with
  `DattoApiError`; and no second `onError` is ever recorded for the account-request URL (Decision 4
  rule 2).
- A `429 (Retry-After: 0) → 200` account GET yields the account-URL terminal event subsequence
  `[onError(429), onResponse(200)]` in that exact order (R2/R6).
- Omitting `httpObserver` from the config entirely still lets `client.account.get()` resolve
  normally with the stubbed response data (additive-only sanity).

All pre-existing suites (585 tests, 39 files, confirmed via a `git stash` baseline run against the
pre-Phase-4 tree) continue to pass unchanged; the new file adds exactly 5 tests for a post-Phase-4
total of 590 tests across 40 files.

---

## 8. Security & Best-Practices Review

- No new dependency; no production code touched at all this phase (`nock`/`vitest` are already dev
  dependencies used identically to every other test in the suite).
- The first test (grant observed end-to-end) directly asserts the grant request event's `headers`
  carries no `authorization`/`Authorization` key — a credential-adjacent secret (the grant's
  `Authorization: Basic public-client:public` header) that never appears in the captured header map
  by design (Phase 3's documented, intentional omission). The same test also asserts the account
  request's `headers.Authorization` equals the real `Bearer <token>` value, proving the real
  `AuthManager.attachTo` interceptor and the observer interceptor compose in the documented order
  against the real object graph — closing R9's bearer-token half, which no unit test (all of which
  substitute a mock `attachTo`) exercises.
- The README's new section leads with the raw/un-redacted warning in bold, naming the bearer token
  and API key explicitly — before describing any callback's payload fields — so a reader cannot
  skim past the security-relevant caveat before seeing the feature's mechanics.
- No secrets are hard-coded beyond the same placeholder `"test-key"`/`"test-secret"` values already
  used identically across every other test file in this repo (`surface.test.ts`,
  `auth-manager.test.ts`); `nock.disableNetConnect()` (scoped to this suite via `beforeAll`/
  `afterAll`, matching every other integration/unit suite's own setup) guarantees no accidental
  live network call.

---

## 9. Self-Review Scoring

| Element | Before | After | Comments |
|---------|--------|-------|----------|
| Extensibility | 9.0 | 9.5 | The `ObservedEvent`/`recordingObserver`/`eventsOf` helpers are generic enough that a future Phase-4-adjacent integration test (e.g. covering a write endpoint's observer behavior) could reuse them directly without modification. |
| Understandability | 9.0 | 9.5 | Every test's `it(...)` title names the exact design decision/requirement it proves (R2/R4/R6/R8, "Decision 4 rule 2"), mirroring Phases 1–3's own test-naming convention, so a reviewer can map each assertion straight back to the plan/design without re-deriving intent. |
| Best Practices | 9.0 | 9.5 | Followed the repo's own established integration-test conventions exactly (`surface.test.ts`'s `@/index` + `config()` pattern, `fixtures.test.ts`'s file placement) rather than inventing a new structure; used `nock`'s query/basicAuth matchers rather than manual URL string comparisons. |
| Plan Adherence | 9.5 | 10.0 | Both Phase 4 steps (integration tests, README) implemented exactly as scoped; the one documented deviation (§5) is a readability-only adaptation of the plan's own "Opinionated" (non-mandatory) example, and the README additions beyond the single dedicated section are a documented, intent-preserving completion (Implicit Intent Handling), not scope creep. |
| Test Quality | 9.0 | 9.5 | Every scenario the plan's Tests section lists for this phase is covered, including the two hardest-to-fake assertions — the lazy-refresh single-`onError` exclusion and the 429→retry→200 ordered-terminal-sequence — verified through the real assembled client rather than re-asserting what Phases 2/3's unit tests already proved in isolation. |

---

## 10. Iterative Improvements Made

1. Switched the recorded-event shape from the plan's sketched `[string, unknown]` tuple to a
   tagged `{ kind, event }` object, letting every assertion `filter`/`find` on both `kind` and
   `event.url` without an `as` cast or manual tuple-index destructuring at each call site.
2. Added the explicit `DattoHttpObserver` return-type annotation on `recordingObserver` so a typo
   in a callback name fails `npm run typecheck` rather than silently compiling.
3. Ran a `git stash`-isolated baseline test count (585/39) before finalizing, rather than trusting
   Phase 3's notes' own reported figure, to state this phase's test-count delta (+5 → 590/40)
   against a freshly-verified number.
4. Added the "Exported types" and "Features" README touch-ups (beyond the single dedicated section
   literally named in the plan's steps) so the README's own canonical export inventory doesn't go
   stale the moment the dedicated section is added elsewhere in the same file.

---

## 11. Remaining Risks or Follow-Ups

- None. This was the plan's final phase; the design's full Success Criteria list is now covered
  end-to-end by the combination of Phases 1–4's tests (unit-level primitives, unit-level per-layer
  instrumentation, and this phase's assembled-client integration coverage).

---

## 12. Commands Run / To Run

- `npm run typecheck` — clean (`typecheck:src` + `typecheck:test` + `typecheck:tools`).
- `npm test` — 590/590 passing, 40/40 test files (baseline, confirmed via a temporary `git stash`
  re-run against the pre-Phase-4 tree, was 585/585 passing across 39 files; this phase adds exactly
  the 5 new integration tests in 1 new file).
- `npm run build` — clean; `dist/index.d.ts` contains `DattoHttpObserver` and zero `declare module`
  blocks.
- `npm run lint` — clean (`eslint src`; this phase touches no `src` file).
- Manual exit-gate script (plan-specified) run verbatim:
  ```bash
  npm run typecheck
  npm test
  npm run build
  grep -q 'DattoHttpObserver' dist/index.d.ts
  ! grep -q 'declare module' dist/index.d.ts
  ```
  All checks passed.

---

## 13. Final Assertion

I assert that:
- Only Phase 4 has been implemented.
- No unnecessary scope expansion occurred.
- All quality scores are ≥ 9.5.
