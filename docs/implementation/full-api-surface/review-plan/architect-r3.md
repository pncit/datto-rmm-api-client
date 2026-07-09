## architect — round 3

Plan Review Mode, round 3 (in-progress review of `full-api-surface/plan.md` against `design.md`).

Prior turns: `architect-r1` (f1–f8) all ratified `Closed` in r2; `architect-r2` (f9–f12) all
dispositioned **Accept** by `reviser-r7`. I re-verified each of f9–f12 against the current plan text
and ratified them (→ `Closed`); see the carry-forward rows. No `Rejected`/escalated items outstanding.

New finding this round arises from the revisions themselves — specifically the
`src/client/defaults.ts` module created to satisfy engineer-r1-f11 and extended in r7 with
`MAX_RETRY_AFTER_MS`. Axis pass:

- **(a) Boundaries/dependency direction:** placing the cross-cutting scalars under `src/client/`
  makes the transport layers (`src/http/`, `src/auth/`) import *upward* into the client layer, and
  because `DattoRmmClient` (client) mounts the http/auth modules, the result is a directory-level
  import cycle `client → http → client` (f13, new).
- **(b) Data model & schema:** no new issue; f1/f5/f7 reconciliations hold.
- **(c) Public API surface:** curated `public-types.ts` + `surface.test.ts` gate hold; f2/f9 closed.
- **(d) Migration/phase sequencing:** module/moduleResolution pairing (f8/f12) resolved; coexistence
  invariant holds. No new issue.
- **(e) Performance & hot paths:** drop-path aggregation (f11) closes the last per-row masker
  concern; no new hot-path issue.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r2-f9 | Medium | Closed | PublicAPI | Phase 5 Step 3 / Phase 8 exit gate | — | ratified: `axios-augment.d.ts` scoped as an internal-only typecheck aid (kept in `tsconfig` `include`, never imported from a value module in the `src/index.ts` entry graph, so `tsup dts:true` never rolls it into `dist/index.d.ts`); Phase 8 exit gate (l.583) `! grep -qn "declare module 'axios'" dist/index.d.ts` verifies no leak. |
| architect-r2-f10 | Medium | Closed | Architecture | Phase 8 Step 8 coverage-map test | — | ratified: each write op now carries a minimal valid sample body (factory keyed by opKey/path) so strict `validateRequest` passes and the request reaches the scoped nock intercept; test fails if a write op lacks one. R1 guard covers all 75 ops. |
| architect-r2-f11 | Medium | Closed | Performance | Phase 6 Step 1 `validateArrayResponse` | — | ratified: drops are aggregated per call into one `warn` summary (`meta { dropped, total, firstErrors[≤K] }`), keeping the deep-walk masker off the per-row path; base-resource test asserts exactly one `warn` even when every item is invalid. |
| architect-r2-f12 | Medium | Closed | Migration | Phase 1 Step 4 | — | ratified: step now requires setting `module: "ESNext"` (or `"Preserve"`) in the same edit as `moduleResolution: "Bundler"`, stating the pairing is required so the phase's own typecheck gate holds. |
| architect-r3-f13 | Medium | Open | Boundaries | Phase 3 Step 4 (`src/client/defaults.ts` — `DEFAULT_RETRY`, `DEFAULT_TOKEN_REFRESH_PCT`, `MAX_RETRY_AFTER_MS`) consumed by Phase 5 Step 3 (`src/http/http-client.ts`) and Step 4 (`src/auth/auth-manager.ts`), against Phase 7 Step 6 (`src/client/datto-rmm-client.ts` mounts http/auth) | The cross-cutting scalars live under **`src/client/`**, but the design's own layering (design Overview: `BaseResource ◀── AuthManager, RateLimiter, HttpClient`, `DattoRmmClient` on top) puts the transport modules *below* the client layer. `src/http/http-client.ts` imports `DEFAULT_RETRY`/`MAX_RETRY_AFTER_MS` and `src/auth/auth-manager.ts` imports `DEFAULT_TOKEN_REFRESH_PCT` — both **upward** edges (`http → client`, `auth → client`). Because `src/client/datto-rmm-client.ts` in turn imports the http/auth modules (`client → http`, `client → auth`), this closes a directory-level **import cycle** `client → http → client`. The plan's stated rule ("cross-cutting scalars → `defaults.ts`") is sound, but the *placement* under `src/client/` inverts the intended dependency direction and introduces the cycle — the same class of coupling hazard the plan is otherwise careful to avoid (e.g. isolating `_zod.def`, separating the auth transport). | Relocate the cross-cutting scalars out of the client layer to a neutral low-level module both the transport layers and the client depend on **downward** — e.g. `src/defaults.ts` (top-level, layer-neutral) — and update the config/http-client/auth-manager imports accordingly. Keep the single-source rule; only move the home so `http`/`auth` no longer import from `client/` and the `client → http → client` cycle is broken. (The rate-limit table correctly staying in `src/rate-limit/` is unaffected.) |
