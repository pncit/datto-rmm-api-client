## triage — round 3

First findings-bearing round with the `engineer` and `architect` reviewers. `plan-auditor-r2`
reconciled all four round-1 findings (`plan-auditor-r1-f1..f4`) to **Closed** and raised nothing
new — those are settled ground and get no route row. This round routes the 8 `engineer-r1` and
3 `architect-r1` open findings. All were interrogated against the repo (`http-client.ts`,
`auth-manager.ts`, `axios-augment.d.ts`, `design.md`); no `Challenge` is warranted (every finding
verified true). No prior triage turn challenged any of these ids, so the one-challenge cap is moot.

| ID | Route | Detail |
|----|-------|--------|
| engineer-r1-f1 | Human | (High — observer's `onError.error` diverges from the `DattoApiError` the client actually throws for a terminal 429; dossier below) |
| architect-r1-f1 | Human | (Medium — same mechanism as engineer-r1-f1; reconciled to the High call and folded into the dossier below) |
| engineer-r1-f3 | Ruled | Add the shared capture-and-stash **assembler** to `observer.ts` (design Decision 2 already mandates it — "the two instrumentation points cannot drift") and route both sites through it so method-uppercasing and header normalization live in one place; **do not** take the "reconcile the design to site-local capture" option. Foundation for Cluster 1. |
| engineer-r1-f4 | Remediate | (see Cluster 1 below) |
| architect-r1-f3 | Remediate | (see Cluster 1 below) |
| engineer-r1-f2 | Remediate | (see Cluster 2 below) |
| engineer-r1-f5 | Ruled | Adopt lightweight attribution: thread the callback name (`"onRequest"`/`"onResponse"`/`"onError"`) into `invokeObserver` and include it in the swallow `warn` (message or `meta`); `method`/`url` context is optional, left to the implementor. The finding has merit and the cost is trivial. |
| engineer-r1-f6 | Ruled | **Keep** the global `axios-augment.d.ts` stash — design Decision 5 / Schema-and-wiring (design L217) explicitly mandates the `rateDescriptor` precedent and architect ratified it as sound; do **not** switch to a local intersection. Fix only the plan muddle: the Phase 2 example (L257) casts `error.config as RetryTrackedConfig` yet reads `__dattoObserverCapture`, which is **not** on `RetryTrackedConfig` — read it off the globally-augmented config directly, and add a one-line note reconciling the `__datto` prefix vs the sibling unprefixed `rateDescriptor`. |
| engineer-r1-f7 | Ruled | State the new `handleResponseError` parameter (6th positional, `httpObserver?: DattoHttpObserver`, inserted before `error`) explicitly in Phase 2 Step 4 **prose**, not only the example; the options-object refactor is optional and **not** mandated (avoid scope creep on a stable signature). |
| engineer-r1-f8 | Ruled | Instruct the implementor (Phase 2 S1 / Phase 3 S1) to add a doc comment on the new `httpObserver` field of both `HttpClientConfig` and `AuthManagerConfig`, explicitly noting raw/unmasked delivery — unlike the adjacent masked `logger` field. |
| architect-r1-f2 | Ruled | Design Change: pin `DattoHttpRequestEvent.url` (and the `url` on the response/error events) as the **absolute resolved** request URL (`baseURL` + path), and update the design payload comment (design L100-128) to say so — a bare relative path is insufficient for the "every outbound HTTP exchange" audit artifact. Plan follows: Phase 2 S2 captures `` `${requestConfig.baseURL ?? ""}${requestConfig.url ?? ""}` ``, Phase 3 S2 captures `apiUrl + GRANT_PATH`; add a test asserting the absolute `url`. |

### Interrogation notes (verified against the repo)

- **engineer-r1-f1 + architect-r1-f1 — confirmed, duplicates, reconciled to High.** `mapObserverError`
  (plan L169-176) maps `403 → build403Error`, else `fromAxiosError`. The real terminal-429 path in
  `handleResponseError` throws `buildRateLimitError(waitMs, error)` (http-client.ts L299) — message
  "Datto RMM API rate limit exceeded", `statusCode 429`, populated `retryAfterMs`. The observer fires
  `onError` right after the `!axios.isAxiosError` guard (L253-255) via `mapObserverError`, so a
  terminal 429 is reported as `fromAxiosError` (no `retryAfterMs`, generic message) — the observed
  error ≠ the thrown error. `mapObserverError` structurally cannot reproduce `buildRateLimitError`
  (it lacks the `waitMs`/attempt context only `handleResponseError` holds). High (engineer) governs
  the reconciled call; the remedy touches design Decision 4's honesty claim → **Human** (dossier).
- **engineer-r1-f3 — confirmed.** Design Decision 2 (design L152-154) mandates `observer.ts` owns
  "the capture-and-stash payload assembler … so the two instrumentation points cannot drift." The
  plan instead hand-builds `ObserverCapture` inline at each site with divergent logic — shared:
  `(requestConfig.method ?? "get").toUpperCase()` + `normalizeHeaders(...)` (plan L231-238); grant:
  literal `method: "POST"` + a literal header object, no normalizer (L317-322). The plan does not
  realize the design's shared assembler. Medium, non-gap, plan-prose remedy on the plan stage, and a
  binary (add assembler vs reconcile design) that is mine to settle → **untagged Ruled**, honoring
  the design. Do not tag `Design Change:` — the design already mandates the assembler; the plan is
  the party out of step.
- **engineer-r1-f4 + architect-r1-f3 — confirmed, clustered.** Phase 1 S5 enumerates only
  `ObserverCapture, normalizeHeaders, invokeObserver, fireRequest, fireResponse, fireError`;
  `mapObserverError` is defined in the example (L169) and used by Phase 2 (L259) but **absent** from
  the export list (both reviewers flag this — the reconciled duplicate). `fireError`'s rule for
  extracting `statusCode`/`responseHeaders`/`responseBody` from its `rawError` arg (an `AxiosError`
  on the shared instance, a possibly-non-axios `err` on the grant, per auth-manager L155-164) is
  unstated. Phase 1 has no `mapObserverError` branch test. Medium/Low, clear completions → **Remediate**
  (Cluster 1).
- **engineer-r1-f2 — confirmed.** `performRefresh` today carries `logger?.debug` (L142),
  `logger?.warn("…refresh failed")` (L156), and `issuedAt = Date.now()` (L141). The Phase 3 example
  (plan L314-341) shows a rewritten flow that omits the `warn`/`debug` and elides `issuedAt` while
  introducing a separate `startedAt`; "rethrow as today" is prose only. Verbatim copy would delete
  existing logging — a behavior change the Non-Goals (design L33) forbid. Clear fix → **Remediate**
  (Cluster 2).
- **engineer-r1-f5 — confirmed, ruled.** `invokeObserver` (plan L149-166) logs static, context-free
  `warn` strings. Design L82 fixes only that a swallowed failure is "reported once … at `warn`" — it
  does not constrain message content, so callback-name attribution is a plan-level refinement, no
  design conflict. Medium, plan-prose → **untagged Ruled** (adopt the minimal useful form).
- **engineer-r1-f6 — confirmed, ruled against the switch.** The observer stash is written (interceptor)
  and read (fulfilled handler + `handleResponseError`) **entirely within `http-client.ts`** — the
  grant path uses a local `capture` variable, not the config stash — so on pure locality it resembles
  the local `RetryTrackedConfig` (L197-200) more than the cross-module `rateDescriptor`. **But** design
  Decision 5 and Schema-and-wiring (L217) explicitly prescribe the `axios-augment.d.ts` `rateDescriptor`
  precedent for this stash, and architect independently ratified the augment as sound and precedented.
  Overturning that is a design change I decline; the augment also lets the fulfilled/rejected handlers
  read the stash off `response.config`/`error.config` without a per-site cast. I rule to keep it and
  only clean the plan's own inconsistency (the `RetryTrackedConfig` cast that can't see the field) plus
  the naming note. Medium, plan-prose (affirming design is not a design change) → **untagged Ruled**.
- **engineer-r1-f7 — confirmed, ruled.** The Phase 2 example (L253) adds a 6th positional arg to
  `handleResponseError`; Step 4 prose (L220) never states it. Low, plan-prose → **untagged Ruled**
  (state the signature; the options-object refactor is optional).
- **engineer-r1-f8 — confirmed, ruled.** Every existing field on `HttpClientConfig` (L62-83) and
  `AuthManagerConfig` (L22-32) is doc-commented; the plan adds `httpObserver` to each without asking
  for one. Low, plan-prose → **untagged Ruled**.
- **architect-r1-f2 — confirmed, ruled.** Captured `url` is the relative path (`requestConfig.url`,
  plan L233; `GRANT_PATH`, L318); `baseURL`/`apiUrl` (set at both `axios.create` sites — http-client
  L342, auth-manager L71) is never concatenated. The design payload (L100-128) is silent on
  relative-vs-absolute. For an audit artifact of "every outbound HTTP exchange," absolute is the
  faithful contract. Medium, non-gap; the authoritative contract lives in the design payload comment
  → **Ruled, tagged `Design Change:`** (Medium upstream-doc remedy is within my authority; the design
  amendment loop's auditor ratifies it). Plan capture edits + a test follow.

### Cluster 1: complete and pin `observer.ts`'s helper surface

**Members:** engineer-r1-f4, architect-r1-f3 (built on the shared assembler mandated by the
engineer-r1-f3 ruling; see Chain watch — this is a holistic pin, not a spot patch).
**Root cause:** `observer.ts`'s exported surface is enumerated in Phase 1 S5 but is incomplete and
under-specified relative to how the Phase 2/3 examples actually consume it.
**Remediation approach (holistic — per Chain watch):** In Phase 1 S5, re-enumerate the module's
**complete** export set — `ObserverCapture` + the shared capture assembler (engineer-r1-f3),
`normalizeHeaders`, `invokeObserver`, `mapObserverError`, `fireRequest`, `fireResponse`, `fireError`
— and for each pin its signature and responsibility: the assembler owns method-uppercasing + header
normalization (so neither site does it inline); `fireError` narrows its `rawError` via
`axios.isAxiosError(rawError)` (or structural `rawError.response`) and includes
`statusCode`/`responseHeaders`/`responseBody` **only** when a response is present, yielding **no**
response fields for a non-axios `rawError` (the grant's `statusCode:0` case). Add a Phase 1 unit test
for `mapObserverError`'s `403 → build403Error` and non-403 → `fromAxiosError` branches.
**Scope boundary:** Phase 1 S5 prose + example export list, the `fireError` contract description, and
Phase 1 Tests only. Do **not** touch the Phase 2/3 fire call sites (already consistent after the
round-1 `fireError`-signature ruling) and do **not** pre-empt Cluster A's mapping decision — the
`mapObserverError` **mapping duty** for terminal 429/403 is finalized only after the engineer-r1-f1
human ruling; the export-list addition, the assembler, and the `fireError` narrowing rule are all
independent of that ruling and can land now.
**Verification:** grep the Phase 2/3 examples for symbols imported from `./observer` and confirm the
S5 export list is a superset; confirm `fireError`'s narrowing rule and the assembler are stated in
prose; confirm Phase 1 Tests list a `mapObserverError` branch test. `npm run typecheck` + `npm test`
at the Phase 1 gate.

### Cluster 2: the Phase 3 grant example must not delete existing behavior

**Members:** engineer-r1-f2.
**Root cause:** the Phase 3 opinionated example (plan L314-341) presents a rewritten `performRefresh`
that omits the existing `logger?.debug` (L142) / `logger?.warn` (L156) and elides `issuedAt` (L141),
while introducing a separate `startedAt`.
**Remediation approach:** rework the Phase 3 example (and Steps 2/4 prose) to **show** the existing
`debug`/`warn` calls and `issuedAt` preserved, with `fireRequest`/`fireResponse`/`fireError` added
**around** them — not a catch block that replaces them. State explicitly that `startedAt` is the
observer's dispatch timestamp and `issuedAt` remains the token-TTL anchor (they may share one
`Date.now()` or stay distinct, but both are retained), and that the mapping/rethrow semantics are
unchanged.
**Scope boundary:** Phase 3 Steps 2/4 prose + example only; no change to real mapping/rethrow logic.
**Verification:** diff the example against `performRefresh` — every existing log call and `issuedAt`
is present; existing `auth-manager.test.ts` cases still asserted unchanged at the Phase 3 gate.

### Chain watch

**`observer.ts`'s helper contract is churning across consecutive findings-bearing rounds.** Round 1
raised `plan-auditor-r1-f1` (the `fireError` signature); this round raises five more against the same
module — engineer-r1-f1 / architect-r1-f1 (the mapping duty), engineer-r1-f3 (the missing shared
assembler), engineer-r1-f4 + architect-r1-f3 (missing export, unspecified `fireError` narrowing,
missing test). Per the chain-watch mandate, do **not** hand the reviser another isolated patch:
treat Cluster 1 + the engineer-r1-f3 ruling as **one holistic surface pin** of `observer.ts` —
enumerate every primitive with its exact signature, its header-normalization / method-casing / body
responsibility, its `rawError`-narrowing rule, and its mapping duty; state the invariant that **both
instrumentation sites route through these primitives** (no inline capture, no site-local mapping) so
they cannot drift, and that the enumerated export list **equals** the set of symbols the Phase 2/3
examples import; verify with a unit test per primitive. The mechanism is under-specified, not
over-complex — it exists to satisfy design Decision 2 (a shared helper so the two sites can't drift),
which is sound — so the right response is to complete/harden the surface, not descope it.

**Sequencing:** the one piece that cannot be finalized in this holistic pin is `mapObserverError`'s
mapping duty for terminal 429/403, which awaits the engineer-r1-f1 human ruling (Cluster A / dossier).
Resolve that ruling first, then land the surface pin, so `observer.ts` is edited once rather than
twice and the `mapObserverError` test's final assertions match the chosen mapping.

### Dossier: engineer-r1-f1 (with architect-r1-f1)

**History:** Raised this round independently by `engineer` (High / ErrorHandling) and `architect`
(Medium / DataModel) — the same mechanism under a severity split, reconciled here to the High call.
No prior reviser disposition; `plan-auditor-r2` did not flag it.
**Requirement at stake:** R8 — "`onError`'s error field is typed and guaranteed to be a
`DattoApiError`; the seam never delivers an unmapped error or a raw axios error." And design
Decision 4's rationale: "Every HTTP-attempt failure the client acts on is already mapped to a
`DattoApiError` before use, so the guarantee is real and the concrete type is honest." Note the gap:
R8 guarantees the error **is a** `DattoApiError`, but neither R8 nor Decision 4 explicitly requires
it to be **the same** `DattoApiError` the client throws to the caller — that ambiguity is the crux.
**Reviewers' strongest case:** For a terminal 429 (Retry-After over `MAX_RETRY_AFTER_MS`, or attempts
exhausted) the client throws `buildRateLimitError(waitMs, error)` — "Datto RMM API rate limit
exceeded", `statusCode 429`, populated `retryAfterMs` (http-client.ts L299). The observer fires
`onError` right after the `isAxiosError` guard via `mapObserverError`, which for 429 returns
`fromAxiosError` — generic message, no `retryAfterMs`. So the audit artifact's error object diverges
from what the SDK actually throws for rate-limit failures, undercutting the seam's compliance purpose
and contradicting Decision 4's "already mapped … so the guarantee is honest." `mapObserverError`
structurally cannot reproduce `buildRateLimitError` — it lacks the `waitMs`/attempt context only
`handleResponseError` holds.
**Planner's strongest case:** The seam deliberately fires **one** `onError` per attempt at a single
well-defined point (after the guard), independent of the retry branches; Decision 4 already accepts
constructing a `DattoApiError` on retried attempts the client swallows. For retried 429s the client
throws nothing, so a status-correct `fromAxiosError` is a defensible representation, and R8 as written
only promises "a mapped `DattoApiError`," which `fromAxiosError` satisfies. Only the terminal 429 (and
the retry-context-dependent parts of 403) actually diverge.
**What you must decide:** Must the observer's `onError.error` for a terminal 429 (and 403) equal the
exact `DattoApiError` the client throws to the caller (message / `retryAfterMs` / `code`), or is a
status-correct `fromAxiosError` acceptable for the observer?
**Options:**
1) Fire `onError` from the terminal sites inside `handleResponseError` using the `DattoApiError` the
   client is about to throw/act on (terminal 429 → `buildRateLimitError(waitMs, error)`; 403 →
   `build403Error`; else → `fromAxiosError`) — most faithful artifact (observed === thrown for every
   failure class), aligned with Decision 4's intent; cost: the fire moves off the single post-guard
   point to the terminal branches and must still fire on retried branches (with `fromAxiosError`),
   adding branch-local fire calls.
2) Thread the computed `waitMs` + a rate-limit branch into `mapObserverError` so the helper reproduces
   `buildRateLimitError`'s shape — keeps the single fire point but duplicates the client's mapping
   logic in `observer.ts` (a drift risk of exactly the kind Decision 2 exists to prevent).
3) Accept the divergence and narrow the design — state that `onError.error` is status-faithful but not
   guaranteed identical to the thrown error for rate-limit/terminal cases — cheapest, but weakens the
   compliance guarantee the seam is sold on.
**Recommendation:** Option 1. The seam's whole value is a faithful audit artifact; firing `onError`
from the site that already holds the mapped error the client acts on is the only option where observed
equals thrown for every failure class, and it matches Decision 4's stated rationale. The cost — firing
from the terminal branches rather than one point — is an implementation expense the design already
anticipated for the retry path. Whichever option is chosen, the `mapObserverError` unit test in
Cluster 1 is the regression anchor and its final assertions (and whether `mapObserverError` survives
at all) follow this decision — so this ruling should land before the Cluster 1 surface pin.
