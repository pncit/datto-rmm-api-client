## engineer — round 1

Phase 4 is a documentation + assembled-client-verification close-out. Scoped via `git status` /
`git diff main`, the only Phase-4-authored changes are two files: `README.md` (new "Observing HTTP
exchanges (`httpObserver`)" section plus a Features bullet and an Exported-types entry) and
`tests/integration/http-observer.test.ts` (new). Everything else in the branch diff (`src/**`,
`tests/unit/**`, `tests/generated/surface-pin.ts`, prior-phase notes) belongs to Phases 1–3 and is
out of scope here. No production code is touched this phase, consistent with the phase Goal.

The integration suite is well-structured, follows the repo's existing conventions (`@/index`
import + `config()` helper, `nock.disableNetConnect()` in `beforeAll`/`afterAll`, `cleanAll` in
`afterEach`), and each `it(...)` title maps to a specific design requirement. The README section
leads with the raw/un-redacted warning and covers per-attempt semantics well. My findings are
maintainability/doc-accuracy polish, not correctness defects.

I verified the README's behavioral claims against the real event shapes in
`src/http/http-observer.ts` and `src/http/observer.ts`; the field-naming mismatch below is the one
substantive issue.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | Medium | Open | Documentation | `README.md` — the `onResponse`/`onError` callback bullets in the new section | The bullets describe the terminal events as "**adding** `statusCode`, `responseHeaders`, …", which implies the `onRequest` fields carry over unchanged. They do not: `DattoHttpResponseEvent`/`DattoHttpErrorEvent` **rename** the request-side fields to `requestHeaders`/`requestBody` (vs. `headers`/`body` on `DattoHttpRequestEvent`), and also carry `method`/`url`; `onError` additionally always carries `durationMs`. The README never names `requestHeaders`/`method`/`url` on the terminal events, and never mentions `durationMs` on `onError` — a consumer following the README would write `e.headers`/`e.body` on a response/error event and get `undefined`, and would not know errors are timed. (The only mention of `requestBody` is buried in the later per-attempt parenthetical.) | State explicitly that terminal events carry `method`, `url`, `requestHeaders`, `requestBody` (the request-side fields, **renamed** from `headers`/`body`) in addition to the response/error-specific fields, and that `onError` also carries `durationMs`. Drop the misleading "adding" framing or make the rename explicit. |
| engineer-r1-f2 | Low | Open | Complexity | `tests/integration/http-observer.test.ts` — `eventsOf` (L66–68) and its call sites (L93, L101, L146, L149, L168) | `eventsOf` returns the un-narrowed `event` union, forcing a repeated `as DattoHttpRequestEvent[]` / `as DattoHttpResponseEvent[]` / `as DattoHttpErrorEvent[]` cast at every call site, plus the `as DattoHttpErrorEvent` casts in the 429 test (L200–205). The casts defeat the discriminated union and would not catch a `kind`/type mismatch. | Make `eventsOf` generic on `kind` and narrow with a type predicate, e.g. `function eventsOf<K extends ObservedEvent["kind"]>(events: ObservedEvent[], kind: K): Extract<ObservedEvent, { kind: K }>["event"][]` using `events.filter((e): e is Extract<ObservedEvent, { kind: K }> => e.kind === kind).map((e) => e.event)`. All the `as …[]` casts then disappear and each result is correctly typed. |
| engineer-r1-f3 | Low | Open | Documentation | Phase-4 notes §8 vs. `tests/integration/http-observer.test.ts` (lazy-refresh test, L158–179) | Notes §8 asserts "this phase's assertions confirm that [Basic-auth header] omission holds even when observed through the fully assembled client" — but no test inspects the grant **request** event's `headers` at all (the lazy-refresh test only asserts the single `onError`, and the R3 grant test asserts `body`/`statusCode`, never `headers`). The claimed security-relevant assertion does not exist. | Either add the assertion the notes claim (in the R3 grant test, assert the grant request event's `headers` carries no `authorization`/`Authorization` key, locking in the intentional Basic-auth omission end-to-end), or correct the §8 claim to reflect that this behavior is only covered by Phase 3's isolated `AuthManager` tests. |
