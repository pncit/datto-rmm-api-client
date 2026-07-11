# Process Artifact — Plan Cycle: `http-observer-seam`

- **Stage:** plan
- **Descriptive name:** http-observer-seam
- **Plan:** `docs/implementation/http-observer-seam/plan.md`
- **Design:** `docs/implementation/http-observer-seam/design.md`
- **Reviewed directories:** `review-plan/`, `review-amend-plan-p2--architect-r1-f2/`
- **Outcome:** Converged. All 15 findings Closed; plan approved for implementation. One
  cross-stage design amendment (`architect-r1-f2`) applied and ratified upstream (commit
  `17325eb`); a second, more consequential design/requirements amendment (the `onError.error`
  contract) folded into `reviser-r2` by human ruling.

> **What this artifact is.** A single historical record of the plan review for the HTTP Observer
> Seam — how the plan came to be, the full reviewer↔reviser conversation round by round, every
> finding and its disposition, the two escalations that went to a human and how they were ruled
> (one of them *against* the mediator's recommendation), and how the cycle closed. It is written
> to be read on its own, without the review turn files beside it.

---

## 1. Genesis

The design (`ee99629 design(http-observer-seam): approved design document`) established the seam:
an optional, transport-agnostic `httpObserver` on `DattoRmmClientConfig` giving a compliance-bound
consumer a raw view of every HTTP exchange the client makes — request, response/error, duration —
without exposing axios and without touching the client's ownership of auth, rate limiting, retry,
and pagination. This restores, in a safe form, a capability 0.1.x consumers had (inject-an-axios-
instance-plus-interceptors) that the 1.0.x transport-isolation rewrite deliberately removed.

The plan under review decomposed that design into four phases:

1. **Phase 1** — the five axios-free public types + shape-only Zod schema (`http-observer.ts`), the
   strict-config acceptance of `httpObserver`, the public exports, the per-attempt stash
   augmentation, and the single internal helper module (`observer.ts`) both transport layers
   consume.
2. **Phase 2** — instrument the shared axios instance (`createHttpClient` / `handleResponseError`):
   `onRequest` at the post-throttle/post-auth dispatch point, `onResponse` on 2xx, `onError` per
   dispatched attempt. Pagination fidelity falls out for free.
3. **Phase 3** — instrument the OAuth grant/refresh path (`AuthManager.performRefresh`), which
   carries no interceptors and must be instrumented at its own dispatch point.
4. **Phase 4** — end-to-end integration tests through the assembled client + README.

The plan entered review grounded in the real transport code, with the axios-LIFO interceptor
ordering (register-first → run-last) as the load-bearing mechanism for Decision 5.

The review ran in two waves, visible in the git checkpoints:

- `f53621d checkpoint(park): … triage in plan:p1: 2 finding(s) need a human ruling` → the
  plan-auditor wave (2 escalations).
- `444ddc6 checkpoint(park): … triage in plan:p2: 2 finding(s) need a human ruling` → the
  engineer + architect wave (2 escalations, reconciled from a duplicate pair).
- `17325eb amend(http-observer-seam): design amended for architect-r1-f2` → the upstream design
  amendment sub-loop.

---

## 2. Cast and mechanics

- **Reviewers:** `plan-auditor` (design-alignment / reality-check / gate coverage), `engineer`
  (DRY, complexity, error-handling, logging, naming), `architect` (module boundaries, data model,
  public surface, sequencing, hot paths).
- **triage:** mediator — routes each finding as **Ruled** (mediator settles a plan-prose edit),
  **Remediate** (clustered, larger revision), or **Human** (severity cap or a genuine design
  choice forces escalation). Emits full **dossiers** for escalated findings and **delta** turns
  when new outcomes land.
- **reviser:** applies dispositions; for one finding here it also executed a human-directed
  cross-stage edit to `design.md`.

Finding IDs are stamped by each reviewer's own round (`plan-auditor-r1-f*`, `engineer-r1-f*`,
`architect-r1-f*`); triage turns are numbered across the whole cycle (`triage-r1`…`triage-r4`).

---

## 3. Chronology

| Time  | Turn | Substance |
|-------|------|-----------|
| 13:23 | plan-auditor-r1 | 4 findings (f1–f4) |
| 13:26 | triage-r1 | f1,f4 → Ruled; f2,f3 → Human (dossiers) |
| —     | *human rules f2, f3* | both land on the dossier recommendation |
| 13:46 | triage-r2 | delta acknowledging the two human rulings |
| 13:48 | reviser-r1 | f1,f2,f4 Fixed; f3 Accepted (→ design amendment) |
| 13:51 | plan-auditor-r2 | all 4 Closed; no new finding |
| 13:56 | engineer-r1 | 8 findings (f1–f8) |
| 13:57 | architect-r1 | 3 findings (f1–f3) |
| 14:05 | triage-r3 | routes 11; eng-f1/arch-f1 → Human; arch-f2 → Design Change; 2 clusters |
| —     | *human rules eng-f1/arch-f1* | **reverses** the dossier recommendation |
| 14:16 | amendment-note | design amendment for arch-f2 **APPLIED** |
| 14:17 | design-auditor-r1 | ratifies the arch-f2 design amendment |
| 14:20 | triage-r4 | delta re-triage; reshapes Cluster 1 under the `unknown` ruling |
| 14:30 | reviser-r2 | all 11 Fixed, incl. cross-stage design/requirements edits |
| 14:32 | engineer-r2 | all 8 ratified → Closed |
| 14:33 | architect-r2 | all 3 ratified → Closed; converged |

---

## 4. Wave 1 — the plan-auditor pass (findings f1–f4)

The plan-auditor first ran reality checks against the repo — LIFO interceptor ordering, the
`isAxiosError` guard, `body: requestConfig.data` being pre-serialization at interceptor time, the
grant `try/catch` shape, and that `zod@4.4.3` passes a `z.function` through invocable and rejects
`axiosInstance`. All grounded. Then four findings:

### plan-auditor-r1-f1 — Medium, Consistency → **Ruled** → Fixed
The shared `fireError` helper was given two incompatible contracts: Phase 2 passed the *mapper
function* `build403Error` as its 5th argument while Phase 3 passed an *already-constructed*
`DattoApiError`. One parameter cannot be both, and the grant path has no 403/`build403Error`
concept. **Ruling:** pin one signature —
`fireError(logger, observer, capture, rawError, mappedError: DattoApiError)` — with every caller
pre-mapping. reviser-r1 applied it. *(This ruling was later superseded by the Wave-2 `unknown`
ruling — see §5.)*

### plan-auditor-r1-f2 — High, Consistency → **Human** → Fixed
A self-defeating exit gate: the Phase 1/4 gate grepped the whole `http-observer.ts` file
case-insensitively for `"axios"`, but the Phase 1 example doc comment contained the word "axios"
(`// … never a raw axios error`). A verbatim-faithful implementor — or anyone writing an
"axios-free" comment — would trip the phase's own gate. Capped at the reviewer's severity and
resting on a genuine design choice, triage escalated. **Human ruling (matched the dossier's
Option 3):** *both* narrow the gate to an actual import/type match
(`! grep -Eq "from ['\"]axios['\"]" …` plus `! grep -Eq '\bAxios[A-Z]' …`) *and* strip "axios"
from the example comment. Applied.

### plan-auditor-r1-f3 — High, DesignAlignment → **Human** → Accepted (design amendment)
The design's "What Stays the Same" (L267) said the curated `public-types` surface is extended by
the observer types, but the plan routed all five types through `index.ts` directly, citing the
verified `DattoLogger` precedent. Same package-root surface either way; a literal divergence from
the design. **Human ruling (dossier Option 2):** accept the `index.ts`-direct placement (it matches
the repo's own convention for hand-authored public types) and correct the *design* (L267/87/95).
The plan needed no change; the design text was the imprecise party.

### plan-auditor-r1-f4 — Low, Test → **Ruled** → Fixed
Phase 2/3 are exactly where the axios-importing `observer.ts` first becomes reachable from the
`index.ts` value graph, yet only Phase 4's gate checked `dist` for a `declare module` leak. A leak
would surface two phases downstream of where it was introduced. **Ruling:** add `npm run build` +
`! grep -q 'declare module' dist/index.d.ts` to the Phase 2 **and** Phase 3 gates — but *not* a
blanket `grep 'axios' dist/index.d.ts`, because `dist` legitimately references
`AxiosInstance`/`AxiosError` (~16 refs) via `BaseResource.axios` / `DattoApiError.fromAxiosError`.
Applied.

**Close of Wave 1:** plan-auditor-r2 re-verified all four fixes against the repo and Closed them; no
new finding.

---

## 5. Wave 2 — the engineer + architect pass (findings f1–f8, f1–f3)

The engineer and architect entered together. Between them they raised 11 findings; two were a
reconciled duplicate. triage-r3 was the first findings-bearing multi-reviewer turn and did the
heavy routing, including flagging a **chain watch**: the `observer.ts` helper contract had now
churned across consecutive rounds (starting with `plan-auditor-r1-f1`), so it should be pinned
holistically in one pass rather than spot-patched.

### 5.1 The central escalation — `onError.error`'s type (engineer-r1-f1 + architect-r1-f1)

Both reviewers independently found the same defect (engineer as High/ErrorHandling, architect as
Medium/DataModel; reconciled to the High call): the plan's `mapObserverError` helper mapped
`403 → build403Error`, else `fromAxiosError`. But the client's real terminal-429 path throws
`buildRateLimitError(waitMs, error)` — carrying `retryAfterMs` and a rate-limit message/code that
`mapObserverError` **structurally cannot reproduce** (it lacks the `waitMs`/retry context that only
`handleResponseError` holds). So the observed `onError.error` would diverge from the `DattoApiError`
the SDK actually throws for rate-limit failures — undercutting Decision 4's honesty claim and the
seam's compliance purpose.

triage-r3's dossier recommended **Option 1**: make observed == thrown by firing `onError` from the
terminal branches inside `handleResponseError` using the exact `DattoApiError` the client is about
to throw.

**The human ruled the opposite way.** Rather than manufacturing a faithful mapped error, the human
directed: *drop the `DattoApiError` guarantee entirely from both design and requirements, and type
`onError.error` as `unknown` — a throw makes no guarantees about an error's shape, so the seam makes
none either; it hands off the request error, whatever it is, regardless of what the SDK returns to
the caller.* This is the more honest stance and it was cheaper, but it inverts the dossier's whole
direction, and it cascaded widely:

- `mapObserverError` was **deleted** from `observer.ts` — it had no remaining purpose.
- The `fireError` signature pinned back in `plan-auditor-r1-f1` **lost its `mappedError` param**;
  it became `fireError(logger, observer, capture, rawError: unknown)`, passing the raw error
  straight through. (triage-r4 explicitly noted the higher human ruling supersedes the earlier
  settled `fireError` signature ruling — settled ground stayed *recorded* but the new ruling won.)
- The design's Decision 4, R8, the `DattoHttpErrorEvent.error` payload comment, and the Overview /
  Success Criteria / Verification / Risks sections all had to be amended to the `unknown` contract.

triage-r4 (a delta) re-triaged Cluster 1 against this ruling: the "add `mapObserverError` +
403/`fromAxiosError` branch test" sub-items were **mooted**; the surviving parts were the
export-surface completion and `fireError`'s response-field narrowing rule (which is independent of
the error's type). The sequencing dependency that had held Cluster 1 behind this ruling was
discharged, so `observer.ts` could be edited once.

reviser-r2 executed the whole thing in one coherent pass — editing `design.md` (R8, Decision 4,
payload, Overview, Success/Verification/Risks) *alongside* the plan — because the triage chain-watch
required design, requirements, and the `observer.ts` surface to all state the same contract so a
re-audit could not re-raise the divergence from either side.

### 5.2 The cross-stage design amendment — `architect-r1-f2` (absolute URL)

The plan captured the bare relative path (`requestConfig.url` / `GRANT_PATH`); for an audit artifact
of "every outbound HTTP exchange," that omits which host each exchange hit. triage-r3 ruled this a
**Design Change** — the authoritative `url` contract lives in the design payload comment. This ran
through the dedicated design amendment sub-loop (`review-amend-plan-p2--architect-r1-f2/`):

- **amendment-note.md** — Decision: **APPLIED** (commit `17325eb`). Pinned every event's `url` as
  the **absolute resolved** URL (`baseURL` + path): `${apiUrl}${path}` for resources,
  `${apiUrl}${GRANT_PATH}` for the grant, across the payload comments, Overview, Decision 5,
  Success Criteria, and Verification. Requirements table left unchanged (a field-level refinement,
  pinned in Decision 5 like header-absence, not a new R-row).
- **design-auditor-r1.md** — ratified: verified the edits landed at every claimed site, that the
  composition rules match the real `baseURL: config.apiUrl` wiring in both transport layers, and
  that no surviving text describes a bare relative `url`. The unchanged Requirements table was
  ratified as a reasoned decline. Sole finding `design-auditor-r1-f1` → **Closed**. The plan's
  still-relative capture was noted as a plan-side follow-up (not a design finding).

reviser-r2 then re-aligned the plan: Phase 2 captures `${requestConfig.baseURL ?? ""}${requestConfig.url ?? ""}`,
Phase 3 captures `${this.config.apiUrl}${GRANT_PATH}` (both through the shared `captureRequest`
assembler), with absolute-`url` assertions added to the Phase 2/3/4 tests.

### 5.3 The `observer.ts` surface pin (engineer-r1-f3, f4, architect-r1-f3 — Cluster 1)

The design's Decision 2 mandates a *single shared helper* so the two instrumentation sites cannot
drift. The plan violated this: it hand-built `ObserverCapture` inline at each site with **divergent**
logic (shared instance uppercased the method + normalized headers; the grant used a literal `"POST"`
and a literal header object with no normalizer). Separately, `mapObserverError` was used by Phase 2
but absent from Phase 1's enumerated export list, and `fireError`'s response-field extraction rule
was unspecified.

- **engineer-r1-f3** → **Ruled**: add the shared capture-and-stash assembler `captureRequest(...)`
  to `observer.ts` (owning method-uppercasing, `normalizeHeaders`, and `startedAt`) and route both
  sites through it. Do *not* take the "reconcile the design to site-local capture" escape — the
  design already mandates the assembler; the plan was the party out of step.
- **engineer-r1-f4 + architect-r1-f3** → **Remediate** (Cluster 1, holistic per chain-watch):
  re-enumerate the module's complete surface and pin each signature/responsibility; pin `fireError`'s
  narrowing (`axios.isAxiosError(rawError) && rawError.response`; a non-axios `rawError` yields **no**
  response fields). Under the §5.1 `unknown` ruling the `mapObserverError` export/test were dropped
  and replaced by a `fireError` **identity-equal pass-through** test.

Final enumerated surface: `ObserverCapture`, `normalizeHeaders`, `captureRequest`, `invokeObserver`,
`fireRequest`, `fireResponse`, `fireError` — no `mapObserverError`.

### 5.4 The Phase 3 grant example must not delete existing behavior (engineer-r1-f2 — Cluster 2)

The Phase 3 opinionated example rewrote `performRefresh`'s `catch` wholesale and, copied verbatim,
would have silently deleted the existing `logger?.warn("…refresh failed")` (L156), the
`logger?.debug` (L142), and elided the `issuedAt = Date.now()` (L141) token-TTL anchor — a behavior
change the Non-Goals forbid. **Remediate:** rework the example to *show* those preserved
(`UNCHANGED`), firing the observer *around* them, and state that `startedAt` (observer dispatch
timestamp) is distinct from `issuedAt` (TTL anchor). Per triage-r4, the grant's `fireError` now
hands off the raw `err`, but the auth-side `DattoApiError` is still constructed and rethrown to the
caller exactly as today. Applied and later ratified by engineer-r2.

### 5.5 The remaining engineer rulings (f5–f8)

| ID | Sev | Route | Resolution |
|----|-----|-------|------------|
| engineer-r1-f5 | Medium, Logging | Ruled | Thread the `callbackName` (`"onRequest"`/`"onResponse"`/`"onError"`) into `invokeObserver` and name it in the swallow `warn` message + `meta`, so a swallowed callback failure is attributable. `method`/`url` context optional. |
| engineer-r1-f6 | Medium, Complexity | Ruled | **Keep** the global `axios-augment.d.ts` stash — design Decision 5 explicitly mandates the `rateDescriptor` precedent (declined to switch to a local `RetryTrackedConfig` intersection). Fixed only the plan muddle: read `error.config?.__dattoObserverCapture` directly off the augmented config (no cast through `RetryTrackedConfig`, which lacks the field), plus a note reconciling the `__datto` prefix vs the unprefixed sibling `rateDescriptor`. |
| engineer-r1-f7 | Low, Complexity | Ruled | State the new `handleResponseError` parameter in **prose** — `httpObserver?` as the 6th positional param inserted before `error`. The options-object refactor is optional, **not** mandated (avoid scope creep on a stable signature). |
| engineer-r1-f8 | Low, Documentation | Ruled | Add a doc comment on the new `httpObserver` field of both `HttpClientConfig` and `AuthManagerConfig`, explicitly noting raw/unmasked delivery unlike the adjacent masked `logger`. |

---

## 6. Escalations and rulings — summary

| Finding(s) | Escalated because | Dossier recommendation | Human ruling | Alignment |
|------------|-------------------|------------------------|--------------|-----------|
| plan-auditor-r1-f2 | High cap; genuine gate-vs-prose design choice | Option 3 (narrow gate *and* strip word) | Both, as recommended | **With** dossier |
| plan-auditor-r1-f3 | High cap; plan-vs-design export-location divergence | Option 2 (accept `index.ts`-direct; amend design) | As recommended | **With** dossier |
| engineer-r1-f1 + architect-r1-f1 | High cap; touches Decision 4's honesty claim + R8 | Option 1 (fire the *thrown* `DattoApiError` from terminal sites) | **Opposite:** drop the guarantee, type `error` as `unknown`, hand off the raw error | **Against** dossier |
| architect-r1-f2 | Medium; authoritative contract lives in the design | (Design Change, ruled by triage) | Applied upstream (commit `17325eb`), ratified | n/a |

The `engineer-r1-f1` ruling is the defining moment of this cycle: the human chose the honest,
lower-cost stance (make *no* shape promise) over the mediator's faithful-reproduction proposal, and
that single decision rippled through the plan, the design, and the requirements in one coordinated
`reviser-r2` pass.

---

## 7. Disposition ledger (all findings)

| ID | Sev | Category | Route | Final |
|----|-----|----------|-------|-------|
| plan-auditor-r1-f1 | Medium | Consistency | Ruled | Fixed (later superseded by the `unknown` ruling) |
| plan-auditor-r1-f2 | High | Consistency | Human | Fixed |
| plan-auditor-r1-f3 | High | DesignAlignment | Human | Accepted → design corrected |
| plan-auditor-r1-f4 | Low | Test | Ruled | Fixed |
| engineer-r1-f1 | High | ErrorHandling | Human | Fixed (`error: unknown`) |
| architect-r1-f1 | Medium | DataModel | Human (dup of eng-f1) | Fixed (same change) |
| engineer-r1-f2 | Medium | Logging | Remediate (Cluster 2) | Fixed |
| engineer-r1-f3 | Medium | DRY | Ruled | Fixed (shared `captureRequest`) |
| engineer-r1-f4 | Medium | Complexity | Remediate (Cluster 1) | Fixed |
| architect-r1-f3 | Low | Architecture | Remediate (dup of eng-f4) | Fixed |
| engineer-r1-f5 | Medium | Logging | Ruled | Fixed |
| engineer-r1-f6 | Medium | Complexity | Ruled | Fixed (kept global augment) |
| engineer-r1-f7 | Low | Complexity | Ruled | Fixed |
| engineer-r1-f8 | Low | Documentation | Ruled | Fixed |
| architect-r1-f2 | Medium | DataModel | Design Change | Applied upstream, ratified |
| design-auditor-r1-f1 | Medium | DesignDecision | (amendment audit) | Closed (ratified) |

engineer-r2 and architect-r2 each re-verified every one of their prior findings against the revised
plan and the amended design, found them genuinely resolved, and raised **no new findings** —
convergence.

---

## 8. What the plan looks like at exit (net effect of the review)

- **`onError.error` is `unknown`**, handed off as the raw request error — no in-observer mapping.
  `mapObserverError` does not exist. `fireError` still populates `statusCode`/`responseHeaders`/
  `responseBody` only when a response is present (narrowing via `axios.isAxiosError(rawError) &&
  rawError.response`); a non-axios transport error yields no response fields. Design R8 and
  Decision 4 were amended to match.
- **A single shared `captureRequest` assembler** in `observer.ts` owns method-uppercasing, header
  normalization, and the `startedAt` stamp; both the shared-instance interceptor and the grant path
  route through it, so the two sites cannot drift.
- **Every event's `url` is the absolute resolved URL** (`baseURL` + path), pinned in the design and
  captured identically at both sites.
- **The grant path preserves all existing logging and `issuedAt`**; the observer fires *around* the
  unchanged auth/mapping/rethrow logic, and the caller still receives the SDK's own `DattoApiError`.
- **Phase 2/3 exit gates verify the `dist` axios-free invariant** (`npm run build` +
  `! grep -q 'declare module' dist/index.d.ts`) at the phases that introduce the risk.
- **The Phase 1 axios gate is precise** (import/type match, not a whole-file substring), so a
  faithful implementation passes its own gate.
- **Swallowed callback failures are attributable** (callback name in the `warn`), the global
  `axios-augment.d.ts` stash is retained per Decision 5, the `handleResponseError` 6th-positional
  parameter is documented in prose, and both internal configs' new `httpObserver` field carries a
  raw/unmasked doc comment.

---

## 9. Observations for future cycles

- **A mediator dossier is advisory, not decisive.** The most far-reaching change of this cycle came
  from the human ruling *against* the dossier's recommendation on `engineer-r1-f1`. The dossier's
  value was framing the decision crisply (observed==thrown vs. no-promise) so the human could pick
  the honest stance quickly.
- **Chain-watch paid off.** triage flagged that `observer.ts`'s contract was churning across rounds
  and deliberately sequenced the surface pin *behind* the pending human ruling, so the module was
  edited once (with `mapObserverError` removed) rather than twice. When the ruling inverted the
  expected direction, the delta re-triage (triage-r4) cleanly re-shaped the cluster instead of
  re-opening it.
- **Cross-stage discipline held.** Two findings reached back into the design — one via the dedicated
  amendment sub-loop with its own auditor ratification (`architect-r1-f2`), one folded into the
  reviser's pass by explicit human direction (`engineer-r1-f1`). In both cases the plan,
  requirements, and design were left mutually consistent, closing the door on a re-audit re-raising
  the same divergence from the opposite side.
- **Two independent reviewers surfaced the same defect** (`engineer-r1-f1` / `architect-r1-f1`) at
  different severities; reconciling to the higher call and issuing one dossier avoided double work.
