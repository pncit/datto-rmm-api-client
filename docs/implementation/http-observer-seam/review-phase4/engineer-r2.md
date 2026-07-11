## engineer — round 2

In-progress review. Re-scoped the Phase-4 diff vs. `main`: the Phase-4-authored surface is
`README.md` (the "Observing HTTP exchanges (`httpObserver`)" section + Features bullet + exported-
types entry), `tests/integration/http-observer.test.ts` (new), and
`implementation-phase4-notes.md`. All other diffed files (`src/**`, `tests/unit/**`,
`tests/generated/surface-pin.ts`, prior-phase notes) belong to Phases 1–3 and remain out of scope.

Re-verified each of my three round-1 findings against `reviser-r1.md`'s `Fixed` dispositions and
the actual files:

- **engineer-r1-f1** (README terminal-event field naming) — `README.md:409-419` now states the
  `onResponse`/`onError` bullets carry `method`/`url` plus the **renamed** `requestHeaders`/
  `requestBody` (not `headers`/`body`), and `onError` explicitly carries `durationMs`. Every field
  name now matches `src/http/http-observer.ts:33-76` exactly; no terminal bullet references an
  unrenamed `headers`/`body`. Fix ratified → Closed.
- **engineer-r1-f2** (`eventsOf` casts) — `tests/integration/http-observer.test.ts:74-79` is now
  three concrete `kind`-keyed overloads; every `as Datto…[]` call-site cast is gone (`grep " as Datto"`
  is empty), and the 429 test uses discriminant narrows (`:232-239`) instead of `as` casts. The
  overload-vs-single-generic deviation is documented in-file with the `tsc` limitation rationale;
  outcome is identical (zero casts, a `kind` typo fails to compile). Fix ratified → Closed.
- **engineer-r1-f3** (phase-notes §8 claim vs. missing assertion) — the grant test now asserts the
  grant request event's `headers` carries neither `authorization` nor `Authorization`
  (`:119-120`), and notes §7 (`:167-171`)/§8 (`:195-202`) were rewritten to attribute the Basic-auth-
  omission coverage to the grant test where the assertion actually lives (previously misattributed
  to the lazy-refresh test, which inspects no headers). Claim and code now agree. Fix ratified →
  Closed.

No new findings. The six plan-mandated Phase-4 integration scenarios (plan §497-504) are each
present and map to a test; R7 (throwing-callback swallow) is intentionally not a Phase-4 test per
the plan (covered in Phases 2–3), so its absence here is not a gap. The README section is accurate
against the live event shapes and export list. Nothing further to raise.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | Medium | Closed | Documentation | `README.md:409-419` | Terminal-event bullets now name `method`/`url` and the **renamed** `requestHeaders`/`requestBody`, and `onError` carries `durationMs`; all field names match `src/http/http-observer.ts:33-76`. | Fix ratified — Closed. |
| engineer-r1-f2 | Low | Closed | Complexity | `tests/integration/http-observer.test.ts:74-79` | `eventsOf` is now `kind`-keyed overloads with zero `as` casts at any call site (`grep " as Datto"` empty); 429 test narrows via discriminant. | Fix ratified — Closed. |
| engineer-r1-f3 | Low | Closed | Documentation | `implementation-phase4-notes.md` §7/§8 + `tests/integration/http-observer.test.ts:119-120` | Grant test now asserts the grant request headers omit `authorization`/`Authorization`; notes §7/§8 corrected to attribute the coverage to the grant test where the assertion lives. | Fix ratified — Closed. |
