## engineer — round 2

In-progress review. Read my round-1 turn (`engineer-r1.md`), the reviser's round-1 and round-2
dispositions (`reviser-r1.md`/`reviser-r2.md`), and the other threads' turns (architect-r1,
typescript-cop-r1, implementation-auditor-r1/r2, project-lead-r1) to honor their rulings and avoid
re-raising items Closed there. All four of my round-1 findings were dispositioned `Fixed`; I
re-verified each against the current working tree rather than the reviser's digest. After ratifying
the fixes I re-read the five `*Resource` classes, the three shared helpers, the `DattoRmmClient`
scaffold, the new `test-harness.ts`, and the rewritten tests hunting for issues newly introduced by
the fixes, plus any I missed in round 1.

### Re-verification of round-1 findings

- **engineer-r1-f1** (R20 end-to-end test that couldn't fail) — **Ratified → Closed.** The rewritten
  `device-resource.test.ts` test now drives a genuinely unrecognized top-level property through a
  real `get()` call and asserts `sink.debug` was actually called with `"stripped unknown response
  property"` / `{ field: "somethingUnrecognized" }` (line 172-175) — an assertion that organically
  exercises the real `BaseResource → parseLenient` path and would fail if `BaseResource` logged
  through any logger other than the constructor-injected `maskedLogger`. It then separately asserts
  that same `maskedLogger` reference redacts a raw UDF value (line 181-188) and keeps the "no raw
  secret in any sink call" sweep. The two assertions together give an honest transitive end-to-end
  argument, and the inline comments accurately disclose why the stripped-property diagnostic alone
  can't carry the UDF value. The test can now fail; the tautology is gone.
- **engineer-r1-f2** (five-file harness duplication) — **Ratified → Closed.** `test-harness.ts`
  exports `BASE_URL`, `createMockLogger`, `createTrackedAxios`, and a generic
  `makeResource(Ctor, logger?)`; `device-resource.test.ts` (and the other four) import it and keep
  only a one-line resource-specific wrapper. The single point of change is restored. Correctly
  scoped to the five Phase 7 files; the parenthetically-noted Phase 6 duplication was left untouched
  per Scope Lock.
- **engineer-r1-f3** (misnamed rate-limit test) — **Ratified → Closed.** `datto-rmm-client.test.ts`
  now splits the claim: the original test is renamed to describe only what it proves (auth token +
  `Authorization` header, line 70), and a new test (line 91-129) configures `readLimit: 1`, issues
  two real `client.devices.get()` calls under `vi.useFakeTimers()`, and asserts the second resolves
  only after the 1s window rolls — genuinely observing throttling through the real limiter. Test
  name now matches what it verifies.
- **engineer-r1-f4** (drift guard was key-set-only) — **Ratified → Closed.** `schema-mirror-pin.ts`
  now pins `Component`, `DnetSiteMappingsDto`, `DeviceNetworkInterface`, `JobComponent`, and
  `Variable` with full `Equal<T, z.infer<typeof schema>>`, which catches a same-named field's *type*
  changing, not just add/remove. `Filter`/`filterSchema` alone remains key-set-only, scoped in the
  file doc to the documented `Filter["type"]` open/closed-enum asymmetry. I considered re-raising the
  residual gap that `Filter`'s five non-enum fields (`id`/`name`/`description`/`dateCreate`/
  `lastUpdated`) still aren't guarded against value-type drift, but the parallel `typescript-cop-r1-f2`
  — the domain owner for this pin — explicitly permitted "keep the key-set-only comparison (or a
  per-field `Omit`-the-enum-field variant)" for `Filter`, and its own turn is Closed on that basis.
  Re-opening one schema's non-key drift over a tradeoff the type-theory reviewer already blessed would
  not survive the reviser's pushback, so I do not re-raise it.

### Fresh review — new issues

Independently re-verified this round: every hand-written path/verb and pagination `arrayKey` against
the generated tree (spot-confirmed `devicesWithNetworkInterface`'s `"devices"` key against
`DevicesNetworkInterfacePage.devices`); the bodiless-vs-bodied `httpPost`/`httpPut` overload arity at
every call site; each method's context-label string matching its path/verb; the `narrow<T>` return-site
narrowing on every method; `voidResponseSchema` reuse for every bodiless-response write; and the
`@internal`/barrel-leak docs on the five exported item schemas (architect-r1-f2's fix). All sound. The
resource layer is consistent, well-documented, and free of swallowed errors, dead code, magic values,
or misleading names. The one duplicated `BASE_URL` literal in `datto-rmm-client.test.ts` (a different
test directory from the harness) is a single constant and below the threshold of an actionable finding.

No new findings, and no round-1 finding remains open.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | Medium | Closed | Logging | `tests/unit/client/resources/device-resource.test.ts:147-195` | Ratified: the R20 test now organically triggers a real `"stripped unknown response property"` `debug` through the actual `BaseResource → parseLenient` path and asserts the injected `maskedLogger` received it, then separately proves that same logger redacts a raw UDF value — the test can now fail and no longer asserts over an always-empty call list. | — |
| engineer-r1-f2 | Low | Closed | DRY | `tests/unit/client/resources/test-harness.ts` (+ five `*-resource.test.ts`) | Ratified: `BASE_URL`/`createMockLogger`/`createTrackedAxios`/`makeResource` extracted into one shared harness imported by all five Phase 7 resource tests; single point of change restored. | — |
| engineer-r1-f3 | Low | Closed | Documentation | `tests/unit/client/datto-rmm-client.test.ts:70-129` | Ratified: the overstated test was renamed to describe only the auth/header it proves, and a new test genuinely exercises read throttling through the real `MultiWindowRateLimiter`. Name now matches behavior. | — |
| engineer-r1-f4 | Low | Closed | Complexity | `tests/generated/schema-mirror-pin.ts:61-82` | Ratified: five of six mirrors now use full `Equal<T, z.infer<schema>>` (catching value-type drift, not just key add/remove); `Filter` stays key-set-only, an explicitly-permitted tradeoff per the sibling `typescript-cop-r1-f2` (Closed). Residual `Filter` non-key drift deliberately not re-raised — see analysis above. | — |
