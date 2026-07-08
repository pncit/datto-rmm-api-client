## architect — round 2

In-progress review. I re-verified each of my seven round-1 findings against the reviser's r5
dispositions and the current design text. All five `Fix` dispositions land where they were needed
(the fixes tighten the design without expanding scope), and both `Accept` dispositions correctly
record my `Defer:` findings under Deferred Decisions rather than folding adjacent scope into this
design. No finding remains `Open`, and the fixes introduced no new inconsistency, un-plannable gap,
or residual duplication that would warrant a fresh finding. Round-2 restraint posture holds: the
design has converged — I raise nothing new.

Verification detail per carried finding:

- **f1** — The dual-layer rate-limiter Key Concept (l.296–310) now names the opKey→limit source of
  truth as a **committed static table** (`src/rate-limits.ts`) seeded from the observed
  `system/request_rate` contract, states the limiter has concrete limits before the first request
  (init does not read `requestRate()`), and gives the **100** write fallback for an unlisted opKey.
  The one genuinely un-plannable gap is closed. **Ratified → Closed.**
- **f2** — UDF masking (l.288–295) is now enforced at the **single logger boundary** via a masking
  decorator wrapping the injected `DattoLogger`; the call-site-discipline framing is gone, so the
  guarantee holds by construction. **Ratified → Closed.**
- **f3** — The worst-rated risk row (l.543) now specifies a **committed sanitization script + a
  pre-commit/CI scan** over `spec/` and fixture paths that fails the build on an unsanitized
  `udf*`/credential-shaped value — a mechanical control, not a documented step. **Ratified → Closed.**
- **f4** — The triplicated **pageDetails cursor override** now states canonically in R3 with the
  schema-override and BaseResource Key Concepts referencing it; the enum-widening/codemod restatement
  in Decision 2 is trimmed to a pointer at the leniency Key Concept. Residual mentions are pointers,
  not restatements. **Ratified → Closed.**
- **f5** — The Public-surface section (l.448–454) fixes one **pluralization rule** (plural for
  collection namespaces; singular for the singletons `account`/`system` and for `audit` as a group of
  audit-*fetch* ops) and R1 is reconciled to it; `audit` is no longer an unexplained lone singular.
  **Ratified → Closed.**
- **f6** — `Defer:` honored: recorded under Deferred Decisions (l.562–566) as a conscious, temporary
  copy with a consolidation follow-up; not folded into this design. **Honored → Closed.**
- **f7** — `Defer:` honored: recorded under Deferred Decisions (l.567–569) as a revisitable
  eager-buffer tradeoff with a streaming variant deferred; not folded in. **Honored → Closed.**

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | Medium | Closed | Architecture | Dual-layer rate limiter Key Concept (l.296–310); R11; Decision 3 | Ratified: opKey→limit source of truth named as committed static table `src/rate-limits.ts`, seeded before first request, with a 100 write fallback; init does not depend on `requestRate()`. | No further action. |
| architect-r1-f2 | Medium | Closed | Security | UDF log-masking Key Concept (l.288–295); R20 | Ratified: masking enforced at the single logger-boundary decorator through which all log calls flow; call-site-discipline framing removed. | No further action. |
| architect-r1-f3 | Medium | Closed | Security | Risks table, final row (l.543); R17 | Ratified: documented step replaced by committed sanitization script + pre-commit/CI scan that fails the build on unsanitized secret-shaped values. | No further action. |
| architect-r1-f4 | Low | Closed | Architecture | R3 (l.76); schema-override (l.247); BaseResource (l.278); Decision 2 (l.351) | Ratified: cursor override canonical in R3 (others reference it); enum-widening/codemod in Decision 2 trimmed to a pointer at the leniency Key Concept. | No further action. |
| architect-r1-f5 | Low | Closed | PublicAPI | Public surface (l.448–454); R1 | Ratified: single pluralization rule stated and R1 reconciled; `audit` singular now explained. | No further action. |
| architect-r1-f6 | Low | Closed | Architecture | Deferred Decisions (l.562–566) | Honored `Defer:`: recorded as conscious temporary copy with a consolidation follow-up; not folded in. | No further action. |
| architect-r1-f7 | Low | Closed | Performance | Deferred Decisions (l.567–569) | Honored `Defer:`: eager-buffer pagination recorded as a revisitable tradeoff; streaming variant deferred. | No further action. |
