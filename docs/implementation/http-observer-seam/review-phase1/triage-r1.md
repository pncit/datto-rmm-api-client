## triage — round 1

| ID | Route | Detail |
|----|-------|--------|
| implementation-auditor-r1-f1 | Remediate | (see Cluster 1 below) |
| implementation-auditor-r1-f2 | Remediate | (see Cluster 1 below) |
| implementation-auditor-r1-f3 | Remediate | (see Cluster 1 below) |

All three findings come from the one reviewer and are the same mechanism (the wrapping
callback schema). I reproduced the defect against the installed `zod@4.4.3` before routing —
see Cluster 1's evidence. None is a genuine requirements gap: R7 and R9 are both stated,
unambiguous Phase-1 requirements (design R7 line 47, R9 line 49; plan Phase 1 line 52) and
they jointly *determine* the fix, so nothing here is a decision only the human can make.
f1 is High, so I do not (and may not) issue a ruling on it — but High severity does not force
`Human`; it only bars `Ruled`. The fix is concrete and evidence-forced, so it is `Remediate`.

### Cluster 1: The validating-proxy callback schema defeats raw, un-wrapped pass-through (R7/R9)
**Members:** implementation-auditor-r1-f1 (the code defect), implementation-auditor-r1-f2
(the R7 test that bypasses the schema and so masks f1), and implementation-auditor-r1-f3 (the
config round-trip test that asserts structural, not identity, pass-through). f2 and f3 are the
test-side face of f1's single root cause; fix f1 first, then make the tests exercise and pin
the real (schema-parsed) path so this cannot regress silently.

**Root cause.** `observerCallbackSchema` uses `z.function({ input: [z.any()], output:
z.void() })` (`src/http/http-observer.ts:108-110`). In `zod@4.4.3` this does **not** hand back
the consumer's function — it returns a *validating proxy* that (a) is not identity-equal to
the supplied function and (b) validates the return value against `void` at call time. I
confirmed all three consequences empirically against the repo's own `node_modules`:
- `schema.parse(fn) === fn` → **false** (the delivered callback is a proxy, not the consumer's
  function — violates the R9/Decision-6 raw pass-through intent; the plan threads
  `validated.httpObserver`, i.e. these proxies, into both transport sites — plan lines 314, 403).
- A value-returning callback (the idiomatic `onRequest: (e) => buffer.push(e)`, which returns a
  number) → the proxy **throws `$ZodError` synchronously**. `invokeObserver` catches it and
  logs `"…callback threw; ignored"` once per attempt even though the callback ran fine.
- An `async`/thenable-returning callback → the proxy throws `$ZodError` **synchronously before
  returning the promise**, so `invokeObserver` never sees the thenable to attach its
  `.then(undefined, …)` handler, and the callback's own rejection escapes as an **unhandled
  rejection** — directly defeating R7 (design line 47 and the risk row at design line 282:
  "an accidentally-async callback cannot leak an unhandled rejection (R7)").

The plan's Assumption (plan line 9) and Step-1 note (plan line 57) that mirroring
`dattoLoggerSchema`'s `z.function` form "keeps the callbacks pass-through (invocable,
un-wrapped)" is factually wrong for this usage; the logger survives only because its methods
are internal, void-returning, and never async. `invokeObserver` (`src/http/observer.ts:92-120`)
is already correctly written for raw callbacks — it tolerates returns and attaches a
thenable-rejection handler; the schema is the sole defect.

**Remediation approach (one fix, root cause first).**
1. Replace `observerCallbackSchema` with a **non-wrapping, shape-only** validator that returns
   the consumer's original function reference unchanged — e.g. per callback
   `z.custom<DattoHttpObserver["onRequest"]>((v) => v === undefined || typeof v === "function")`
   (or a single `z.custom` predicate applied to each field). `z.custom` returns the input by
   identity, so the raw function is delivered, and `invokeObserver` — not the schema — owns
   return-value and async-rejection tolerance, as R7 intends. Keep `.strictObject` and
   `.optional()`; the non-function-rejection behavior (config.test.ts lines 78-83) must still
   pass. Update the doc comment at `http-observer.ts:103-107` so it no longer claims to mirror
   `z.function`, and record the deliberate deviation from plan lines 9/57 in
   `implementation-phase1-notes.md` (the plan's mandated form is empirically incompatible with
   R7 — this note is the standard implementation-loop deviation record, not a plan amendment;
   f1's High severity puts a plan-doc edit outside my ruling authority anyway).
2. **f2 —** add a regression test in `tests/unit/http/observer.test.ts` that obtains the
   callback **through** `dattoHttpObserverSchema.parse` (or `dattoRmmClientConfigSchema`), not a
   hand-built raw `fn`: one `async`/rejecting callback and one value-returning callback, each
   invoked via `invokeObserver`, asserting **no unhandled rejection**, exactly one `warn` for
   the async case, and **no** `warn` for the value-returning case. This test must fail on today's
   schema and pass after step 1.
3. **f3 —** in `tests/unit/client/config.test.ts` (the "still invocable after parsing" case,
   line ~67) change `expect(received).toEqual([rawEvent])` to assert **identity**:
   `expect(received[0]).toBe(rawEvent)`, pinning that parsing neither clones the payload nor
   substitutes the callback.

**Scope boundary.** Touches only `src/http/http-observer.ts` (the schema + its doc comment),
`tests/unit/http/observer.test.ts`, and `tests/unit/client/config.test.ts`, plus the
deviation note in `implementation-phase1-notes.md`. Must **not** touch `dattoLoggerSchema` (the
same latent form lives there, but the logger is out of Phase-1 scope and its usage does not
trigger the defect — leave it), must **not** add any Phase 2/3/4 transport wiring, must not
alter the five public types, and must preserve `.strictObject`, `.optional()`, and the
"reject a non-function callback" and "reject unknown key" behaviors.

**Verification.**
- `npx tsc --noEmit` clean; `npm test` green (new f2 test present and passing; f3 asserts `toBe`).
- Reviewer-grade identity check: `dattoHttpObserverSchema.parse({ onRequest }).onRequest ===
  onRequest` is **true**; a value-returning parsed callback invoked via `invokeObserver` logs
  **no** `warn`; a parsed async-rejecting callback produces **no** unhandled rejection and
  exactly one `warn`.
- Re-run the Phase-1 exit-gate greps unchanged: `http-observer.ts` stays axios-free
  (`from 'axios'` and `\bAxios[A-Z]` empty), `dist/index.d.ts` still contains
  `DattoHttpObserver`, carries no `declare module`, and leaks neither `ObserverCapture` nor
  `__dattoObserverCapture`; `observer.ts` still not re-exported from `index.ts`.

### Chain watch
None this round — this is round 1, so no mechanism has yet churned across consecutive rounds.
Watch item for next round only: the `z.function({ output: z.void() })` shape-only idiom is
shared with `dattoLoggerSchema`; if a later phase surfaces the same wrapping defect there, treat
it as the same recurring mechanism rather than a fresh spot fix.
