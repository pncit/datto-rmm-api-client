## triage — round 3 (delta re-triage, turn 4)

Re-assessment-only delta. Two new outcomes landed since the initial triage-r3 turn, neither of
which that turn could have known:

1. **Human ruling on `engineer-r1-f1` + `architect-r1-f1`** (both routed `Human` in triage-r3):
   *"modify the design and requirements to drop the `DattoApiError` guarantee, and instead return
   error as `unknown` (a throw makes no guarantees about the error shape) — this keeps the http
   observer honest: it hands off the request error, whatever it is, regardless of what the SDK is
   going to return."* This is the reverse of the dossier's Option-1 recommendation (which proposed
   firing the *thrown* `DattoApiError` from the terminal sites); the human instead **removes the
   mapping obligation entirely** and re-types `onError.error` as `unknown`.
2. **Amendment result on `architect-r1-f2`** (Ruled `Design Change:` in triage-r3): design amended
   upstream, commit `17325eb` — the payload comments now pin the **absolute resolved** URL
   (design L76-78, L102, L109, L120). The plan-follow capture edits + absolute-`url` test remain
   the reviser's to apply per that settled ruling.

triage-r3 opened **no `Challenge` rows** (every finding verified true), so there is nothing to
restate verbatim and no reviewer is left waiting on a live challenge. It opened three `Remediate`
rows across two clusters — Cluster 1 (`engineer-r1-f4`, `architect-r1-f3`) and Cluster 2
(`engineer-r1-f2`). Outcome (1) directly reshapes Cluster 1 (which triage-r3 had explicitly
*sequenced behind* the engineer-r1-f1 ruling); Cluster 2 is unaffected in substance. No new
`Ruled`/`Human` row is recorded and no already-ruled finding is re-routed.

| ID | Route | Detail |
|----|-------|--------|
| engineer-r1-f4 | Remediate | **Revised** against the `error: unknown` ruling — see Cluster 1 (revised) below. The "add `mapObserverError` to the export list" and "add a `mapObserverError` 403/`fromAxiosError` branch test" sub-items are **mooted**; the export-surface completion and the `fireError` response-context narrowing rule survive, re-framed to the pass-through contract. |
| architect-r1-f3 | Remediate | **Revised** against the `error: unknown` ruling — see Cluster 1 (revised) below (reconciled duplicate of `engineer-r1-f4`). |
| engineer-r1-f2 | Remediate | **Survives unchanged** — see Cluster 2 below. Logging/`issuedAt` preservation is orthogonal to the error-contract ruling; only note that the grant's `fireError` now hands off the raw error as `unknown` rather than a constructed `mapped` `DattoApiError`. |

### Re-assessment notes

- **`engineer-r1-f1` + `architect-r1-f1` — closed by the human; recorded, not re-routed.** Ruling:
  drop the `DattoApiError` guarantee from **both** design and requirements and re-type
  `onError.error` as `unknown`; the seam hands off whatever the request error is. This is a
  cross-stage remedy (design Decision 4 / payload comment L123 "`error: DattoApiError; // always
  mapped`", **and** requirement R8) — see Chain watch. Note the *direction*: the triage-r3 dossier
  recommended making observed-equal-thrown by firing the mapped error; the human chose the opposite
  honesty stance — make **no** shape promise. Everything downstream that existed to *manufacture* a
  `DattoApiError` for the observer (`mapObserverError`, the `fireError(... mappedError:
  DattoApiError)` 5th-param typing) is therefore no longer load-bearing.
- **`architect-r1-f2` — amended upstream (commit `17325eb`); recorded, not re-routed.** The design
  now states the absolute resolved URL on all three payloads. The reviser's plan-follow work
  (Phase 2 S2 captures `` `${requestConfig.baseURL ?? ""}${requestConfig.url ?? ""}` ``, Phase 3 S2
  captures `apiUrl + GRANT_PATH`, plus an absolute-`url` assertion test) is unchanged and lands with
  the rest of the plan edits; re-align to the amended design.md, do not re-open the design point.
- **All other triage-r3 `Ruled` rows unaffected.** `engineer-r1-f3` (shared assembler),
  `engineer-r1-f5` (callback-name attribution), `engineer-r1-f6` (keep the global augment; fix the
  `RetryTrackedConfig` cast + naming note), `engineer-r1-f7` (state the 6th positional param in
  prose), `engineer-r1-f8` (raw/unmasked doc comment) carry their rulings verbatim — none touches
  the error type or the URL contract. Settled ground stays settled.

### Cluster 1 (revised): complete and pin `observer.ts`'s helper surface — under the `unknown` contract

**Members:** `engineer-r1-f4`, `architect-r1-f3` (built on the `engineer-r1-f3` shared-assembler
ruling). Still one holistic surface pin, not spot patches (Chain watch).
**What the outcome invalidated:** triage-r3's remediation added `mapObserverError` to the Phase 1 S5
export list and required a Phase 1 unit test for its `403 → build403Error` / non-403 →
`fromAxiosError` branches, and it sequenced the whole cluster behind the engineer-r1-f1 ruling
because "whether `mapObserverError` survives at all follows this decision." The decision is now in:
`onError.error` is `unknown`, so the observer performs **no** error mapping. `mapObserverError` has
no remaining purpose in the observer surface, and the `fireError(logger, observer, capture,
rawError, mappedError: DattoApiError)` signature pinned by the settled `plan-auditor-r1-f1` ruling
loses its `mappedError` argument. The sequencing dependency is discharged — the cluster can land now.
**Revised remediation approach (holistic):** In Phase 1 S5, re-enumerate the module's **complete**
export set against the amended contract — `ObserverCapture` + the shared capture assembler
(`engineer-r1-f3`), `normalizeHeaders`, `invokeObserver`, `fireRequest`, `fireResponse`,
`fireError` — and pin each signature/responsibility, with these deltas from triage-r3:
  - **Drop `mapObserverError` from the surface** (mooted). The observer no longer maps; if the helper
    is referenced anywhere in the Phase 2/3 examples it is removed there too.
  - **`fireError` takes the raw error as `unknown` and passes it straight through** to
    `onError.error` — no `mappedError: DattoApiError` parameter, no per-site pre-mapping. This is the
    point where the human's `unknown` contract is realized; state it as the invariant.
  - **Keep the `fireError` response-context narrowing rule** (this part of the finding survives and
    is *independent* of the `error` type): `fireError` narrows via `axios.isAxiosError(rawError)` (or
    structural `rawError.response`) and populates `statusCode`/`responseHeaders`/`responseBody`
    **only** when a response is present — **no** response fields for a non-axios `rawError` (the
    grant's transport-failure case). These optional fields stay on `DattoHttpErrorEvent` regardless
    of the `error` re-typing.
  - **Replace** the mooted `mapObserverError` branch test with a Phase 1 test asserting `fireError`
    delivers the **exact** `rawError` object it was handed to `onError.error` unchanged (both an
    `AxiosError` and a plain non-axios error), plus the response-field-presence rule above.
**Scope boundary:** Phase 1 S5 prose + example export list, the `fireError` contract description, and
Phase 1 Tests only — **plus** deleting any now-dead `mapObserverError` reference the examples carry.
Do not touch the Phase 2/3 fire *call sites'* structure beyond dropping the pre-map argument.
**Verification:** grep the Phase 2/3 examples for symbols imported from `./observer` and confirm the
S5 export list is an exact superset **and no longer includes `mapObserverError`**; confirm
`fireError`'s `unknown` pass-through and response-field narrowing are stated in prose; confirm Phase 1
Tests list the pass-through test (not a mapping-branch test). `npm run typecheck` + `npm test` at the
Phase 1 gate.

### Cluster 2 (unchanged): the Phase 3 grant example must not delete existing behavior

**Members:** `engineer-r1-f2`. Unaffected by both new outcomes — this cluster is about preserving the
existing `logger?.debug` (L142) / `logger?.warn` (L156) and `issuedAt` (L141) when the Phase 3
`performRefresh` example is rewritten, which is orthogonal to the error type and the URL contract.
**Remediation approach (verbatim from triage-r3):** rework the Phase 3 example (and Steps 2/4 prose)
to **show** the existing `debug`/`warn` calls and `issuedAt` preserved, with
`fireRequest`/`fireResponse`/`fireError` added **around** them — not a catch block that replaces
them. State that `startedAt` is the observer's dispatch timestamp and `issuedAt` remains the
token-TTL anchor (they may share one `Date.now()` or stay distinct, but both are retained), and that
the rethrow semantics are unchanged.
**One re-assessment addendum (from outcome 1):** the grant's `fireError` now hands off the **raw**
caught error as `unknown` (per the engineer-r1-f1 ruling), so the example's previously-constructed
`mapped` `DattoApiError` is no longer passed *into* the observer — but the auth flow still constructs
and **rethrows** its own `DattoApiError(statusCode:0, "…authentication failed")` to the caller
exactly as today. Do not delete that construction; only stop routing it through `fireError`.
**Scope boundary:** Phase 3 Steps 2/4 prose + example only; no change to real mapping/rethrow logic.
**Verification:** diff the example against `performRefresh` — every existing log call and `issuedAt`
is present, the auth-side `DattoApiError` is still constructed and rethrown, and `fireError` receives
the raw error; existing `auth-manager.test.ts` cases still asserted unchanged at the Phase 3 gate.

### Chain watch

- **The `observer.ts` error contract just flipped from "mapped" to "raw `unknown`."** The
  engineer-r1-f1/architect-r1-f1 human ruling supersedes, on the error-shape point, both design
  Decision 4 and the settled `plan-auditor-r1-f1` `fireError` signature ruling (which typed the 5th
  param `mappedError: DattoApiError`). I am **not** re-routing `plan-auditor-r1-f1` — settled ground
  stays settled — but the reviser applying Cluster 1 must reconcile it: the higher human ruling wins,
  so `fireError`'s 5th param becomes `rawError: unknown` pass-through and the pre-map-at-each-caller
  instruction from that r1 ruling falls away. Land Cluster 1 **and** the cross-stage design/
  requirements edits (Decision 4 + payload L123 + R8 → `unknown`) in one coherent pass so
  design.md, requirements, and `observer.ts`'s surface all state the same contract and a downstream
  re-audit cannot re-raise the divergence from either side.
- **Sequencing now unblocked.** triage-r3 held the Cluster 1 surface pin behind this ruling; the
  ruling has landed, so `observer.ts` can be edited once — with `mapObserverError` removed rather
  than added, and its test replaced by the pass-through test — instead of twice.
- **No new mechanism churn.** Beyond the already-tracked `observer.ts` helper-surface thread (now
  converging as the contract is settled), nothing new is churning across rounds this delta.
