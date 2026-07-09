# Implementation Notes — Phase 3

- **Plan:** full-api-surface
- **Phase:** 3
- **Date:** 2026-07-09
- **Agent:** Implementor

---

## 1. Phase Scope Confirmation

**In-Scope (Phase 3 only):**
- `src/errors/`: `BaseError` (ported), `DattoApiError` (pinned constructor + `fromAxiosError`),
  `DattoValidationError` (pinned constructor + `getErrorTree`), and the `index.ts` barrel
  (including `isDattoApiError`/`isDattoValidationError` type guards).
- `src/logging/logger.ts`: `DattoLogger` type, `dattoLoggerSchema` (zod-validated), and the
  `console`-backed `consoleLogger` default.
- `src/logging/mask.ts`: `withUdfMasking`, the single logging boundary that redacts every
  non-null `udf*` value in a log call's `meta` (R20).
- `src/client/datto-client-config.ts`: `dattoRmmClientConfigSchema` (`z.strictObject`) and the
  inferred `DattoRmmClientConfig` type — `apiUrl`/`apiKey`/`apiSecret`, optional
  `logger`/`userAgentExtra`/`tokenRefreshPct`/`retry`/`rateLimit`; no `autoRefresh`,
  `validationMode`, or `axiosInstance`.
- `src/defaults.ts`: the layer-neutral `DEFAULT_RETRY`, `DEFAULT_TOKEN_REFRESH_PCT`,
  `MAX_RETRY_AFTER_MS` constants.
- Unit tests for every behavior named in the plan's Tests section.

**Explicitly Out-of-Scope:**
- Any change to the old runtime surface (`src/client.ts`, `src/config.ts`, `src/auth.ts`,
  `src/httpClient.ts`, `src/rateLimiter.ts`, `src/tokenStore.ts`, `src/validation.ts`,
  `src/schemas.ts`, `src/logger.ts`, `src/result.ts`, `src/internal/`) — untouched, still
  compiling, per the coexistence rule (deleted whole in Phase 8). Verified: `git status` shows
  only new, untracked paths after this phase; no tracked file was modified.
- `parseLenient`/`schema-leniency.ts` and its runtime enum degradation (Phase 4).
- The rate limiter, HTTP transport, and `AuthManager` (Phase 5) — including the actual
  `Retry-After` parsing and 403 ip-block/forbidden classification the `DattoApiErrorOptions`
  fields `retryAfterMs`/`code` exist to carry.
- `BaseResource`, resource classes, and `DattoRmmClient` itself (Phases 6–8).
- The `src/rate-limit/rate-limits.ts` table `rateLimit` config overrides (Step 4) reference —
  it does not exist until Phase 5, so nothing in this phase imports from it.

---

## 2. Phase Intent (Interpreted)

Stand up the three foundational, cross-cutting pieces every later phase's resources and
transport layer build on: a typed, throwing error hierarchy (`DattoApiError`/
`DattoValidationError` over `BaseError`) with pinned constructor signatures so every future
construction site agrees; an injectable, zod-validated structured logger (`DattoLogger`)
wrapped in a UDF-masking decorator that is the *single* boundary all client logging must flow
through (R20's "no call site can leak a raw UDF value" guarantee is a structural property of
this wrapper, not a per-site discipline); and the new `DattoRmmClientConfig` schema that
replaces the old `0.1.x` shape and drops its dead knobs (`autoRefresh`, `validationMode`,
`axiosInstance`). All of it lands under new paths per the coexistence rule — nothing in this
phase touches, imports from, or is imported by the old surface.

---

## 3. Files Touched

| File | Change Type | Rationale |
|------|------------|-----------|
| `src/errors/base-error.ts` | Created | Ported from `fuze-api`'s `BaseError`; `cause` option widened from `Error` to `unknown` (see §5) |
| `src/errors/datto-api-error.ts` | Created | `DattoApiError` with the plan's pinned constructor + `fromAxiosError` |
| `src/errors/datto-validation-error.ts` | Created | `DattoValidationError` with the plan's pinned constructor + `getErrorTree` |
| `src/errors/index.ts` | Created | Barrel: re-exports + `isDattoApiError`/`isDattoValidationError` type guards |
| `src/logging/logger.ts` | Created | `DattoLogger` type, `dattoLoggerSchema`, `consoleLogger` default |
| `src/logging/mask.ts` | Created | `withUdfMasking` — the single UDF-masking logger boundary (R20) |
| `src/client/datto-client-config.ts` | Created | `dattoRmmClientConfigSchema` + `DattoRmmClientConfig` (R14) |
| `src/defaults.ts` | Created | Layer-neutral `DEFAULT_RETRY`, `DEFAULT_TOKEN_REFRESH_PCT`, `MAX_RETRY_AFTER_MS` |
| `tests/unit/errors/datto-api-error.test.ts` | Created | `DattoApiError` construction + `fromAxiosError` mapping |
| `tests/unit/errors/datto-validation-error.test.ts` | Created | `DattoValidationError` construction + `getErrorTree` |
| `tests/unit/errors/index.test.ts` | Created | `isDattoApiError`/`isDattoValidationError` type guards |
| `tests/unit/logging/logger.test.ts` | Created | `dattoLoggerSchema` accept/reject cases |
| `tests/unit/logging/mask.test.ts` | Created | `withUdfMasking` — the plan's named R20 fixture + edge cases |
| `tests/unit/client/config.test.ts` | Created | `dattoRmmClientConfigSchema` accept/reject cases |

---

## 4. Implementation Summary

**Error hierarchy (`src/errors/`).** `BaseError` is `fuze-api`'s version with one deliberate
widening (see §5). `DattoApiError` implements the plan's pinned constructor exactly
(`{ statusCode: number; response?; requestId?; retryAfterMs?; code?; cause? }`, `statusCode`
required, `cause` typed `unknown`) plus `static fromAxiosError(err): DattoApiError`. Per the
plan's explicit "disambiguated in Phase 5" note, `fromAxiosError` is a **generic** mapper only:
it sets `statusCode` (falling back to `0` for a transport-level failure with no HTTP response,
matching the existing `mapAxiosError`'s `status: 0` convention in the old `httpClient.ts`),
`response`, `requestId` (best-effort, see §6), `cause`, and a `message` extracted via an
ordered-key scan (`message`/`error`/`detail`, then JSON fallback) — a direct, faithful port of
`fuze-api`'s `extractErrorMessage`, inlined as a private helper rather than a separate
`error-utils.ts` file since the plan's file list for this phase names exactly four files.
`retryAfterMs` and `code` are deliberately left `undefined` by `fromAxiosError`: Phase 5's
`http-client.ts` owns the 429 `Retry-After` parsing and the 403 ip-block/forbidden
classification in full (per the plan's own Phase 5 Step 3 code sketch, both paths construct
`DattoApiError` **directly**, never through `fromAxiosError`), so duplicating that logic here
would create a second, divergent source for it. `DattoValidationError` implements the pinned
`(zodError, stage, opts?: { payload?; context? })` constructor, `prettyMessage` via
`z.prettifyError`, and `getErrorTree()` via `z.treeifyError` — verified to match exactly how
`fuze-api`'s `BaseResource.validateResponse`/`validateRequest` already construct the analogous
`FuzeValidationError` (`(zodError, direction, context)`), so Phase 6's `BaseResource` port will
need no signature reconciliation. `index.ts` re-exports both classes and their option/stage
types, plus `isDattoApiError`/`isDattoValidationError` instanceof guards (the barrel-level
equivalent of `fuze-api`'s `error-utils.ts` guards, consolidated here rather than in a
plan-unlisted file).

**Logger (`src/logging/logger.ts`).** `DattoLogger` and `dattoLoggerSchema` mirror `fuze-api`'s
`FuzeLogger`/`fuzeLoggerSchema` exactly (same `z.function({ input: [...], output: z.void() })`
per-method schema, verified against the installed `zod@4.4.3` to actually reject a
missing/mistyped method — not just structurally plausible). `consoleLogger` is exported as
`console` directly (`export const consoleLogger: DattoLogger = console;`), matching the old
`src/logger.ts`'s exact `defaultLogger: LoggerLike = console` idiom already established in this
repo, rather than fuze-api's separate-wrapper-with-explicit-calls approach — verified this
compiles (`Console`'s methods are structurally `(message?: any, ...optionalParams: any[]) =>
void`, compatible with `DattoLogger`'s signature) and, unlike calling `console.debug(...)`
directly, produces zero `no-console` lint warnings (the repo's config allows only
`console.warn`/`console.error`).

**UDF masking (`src/logging/mask.ts`).** Implements the plan's `withUdfMasking` sketch with one
simplification (removal of a dead `?? String(v)` fallback, see §5). Verified against the plan's
own named test fixture (`{ udf: { udf1: 'S3CR3T', udf7: null }, udf3: 12345, udf5: 'abcd', udf9:
{ key: 'BitLockerRecoveryKey' }, host: 'PC1' }`) that every non-null `udf*` value — string,
number, and nested object, at any depth including inside a nested `udf` record — is redacted to
`[redacted - N characters]`, `null` UDFs and non-UDF structure pass through unchanged, and the
underlying sink never receives the raw secret in any call argument.

**Config (`src/client/datto-client-config.ts` + `src/defaults.ts`).** `dattoRmmClientConfigSchema`
is a `z.strictObject` with exactly the plan's named fields (`apiUrl`, `apiKey`, `apiSecret`,
`logger?`, `userAgentExtra?`, `tokenRefreshPct?`, `retry?`, `rateLimit?`); `.strictObject`
rejects any other key, which is how the schema enforces "no `autoRefresh`, no `validationMode`,
no `axiosInstance`" rather than by omission alone — verified by a dedicated rejection test for
each. `retry`/`rateLimit` are each their own `z.strictObject` sub-schema, exactly the plan's
pinned field sets, with no `.default()` applied at the schema level (see §6) — the schema's job
is shape validation only; `DEFAULT_RETRY`/`src/rate-limit/rate-limits.ts`'s constants are applied
by their respective Phase 5 consumers. `src/defaults.ts` exports the three named constants with
the plan's exact values and documents, in its own module comment, why it is layer-neutral rather
than living under `src/client/` (breaks the `client → http → client` import cycle the plan
describes).

---

## 5. Deviations From Plan (If Any)

1. **Widened `BaseError`'s `cause` option type from `Error` to `unknown`.** *Why:* the pinned
   `DattoApiError` constructor takes `cause?: unknown` (not `Error`), but a verbatim port of
   `fuze-api`'s `BaseError` types its `options?: { cause?: Error }` — passing `opts.cause`
   (typed `unknown`) through to a strictly-`Error`-typed `super()` call would not compile. Native
   `Error`'s own `ErrorOptions` (`lib.es2022.error.d.ts`) already types `cause` as `unknown`, so
   widening `BaseError` to match is a strict correctness improvement (accepts any thrown value,
   not just `Error` instances, matching the underlying JS `Error.cause` semantics) rather than a
   workaround, and it does not change `BaseError`'s runtime behavior at all. This was the only way
   to satisfy the plan's own pinned `DattoApiError` signature while keeping `BaseError` shared
   across both error classes as specified.
2. **Simplified `mask.ts`'s `mask()` helper: dropped the plan sketch's `JSON.stringify(v) ??
   String(v)` fallback, using `JSON.stringify(v)` directly.** *Why:* the plan's own code sample
   is explicitly illustrative ("Opinionated Implementation Notes (Examples)"), not a literal
   mandate. `JSON.stringify`'s TypeScript return type is `string` (never `string | undefined`),
   and at runtime it can only return a non-string (`undefined`) for `undefined`/function/symbol
   inputs — none of which a JSON-parsed wire value (the only thing `mask()` is ever called with,
   guarded by the caller's `v != null` check) can be. The `?? String(v)` branch was therefore
   dead code that would also trip this repo's own precedent for flagging exactly this pattern
   (`error-utils.ts`'s `extractErrorMessage`, ported into `datto-api-error.ts`, needed an explicit
   `eslint-disable-next-line @typescript-eslint/no-unnecessary-condition` for the analogous line
   in `fuze-api`). Removing it is simpler and behaviorally identical for every real input.
3. **Inlined `extractErrorMessage`/type guards rather than creating a separate
   `src/errors/error-utils.ts`.** *Why:* `fuze-api` splits these into their own file, but the
   plan's Phase 3 Step 1 file list is explicit and closed: `base-error.ts`, `datto-api-error.ts`,
   `datto-validation-error.ts`, `index.ts`. Both helpers are small, single-consumer (or
   barrel-level) pieces of the ported error hierarchy — an "implicit intent" item needed to
   complete `fromAxiosError`'s message extraction and the barrel's guards, not a new concern — so
   they were kept inside the four named files rather than adding a fifth, unlisted one.

No other deviations. `DattoApiError`, `DattoValidationError`, `DattoLogger`,
`dattoLoggerSchema`, `withUdfMasking`'s masking behavior, and `dattoRmmClientConfigSchema`'s
field set all match the plan's pinned signatures/shapes exactly.

---

## 6. Ambiguities & Decisions

- **`requestId` extraction in `fromAxiosError`.** The plan's design doc lists `requestId` as a
  `DattoApiError` field ("status, response body, request id") but neither the design nor the
  plan names a source header, and Datto's committed `spec/openapi.json` declares no response
  headers for any operation (confirmed by scanning every `responses[*].headers` node — none
  exist). This is a genuine spec gap, not a fatal one: `extractRequestId` checks an ordered list
  of conventional candidate header names (`x-request-id`, `x-requestid`, `request-id`, first
  match wins — the same "ordered candidate keys" pattern already used for
  `ERROR_MESSAGE_KEYS`/`extractErrorMessage`), and simply leaves `requestId` `undefined` when
  none matches, which is exactly what a `string | undefined`-typed optional field is for. Flagged
  in §11 as a follow-up: if a live Datto response is ever observed to carry a request-id-shaped
  header under a different name, this candidate list is the one place to update.
- **Whether `retry`/`tokenRefreshPct` get a zod-level `.default()`.** The plan's prose says
  `DEFAULT_RETRY`/`DEFAULT_TOKEN_REFRESH_PCT` are "imported here" (i.e. in this config file) and
  are "the config default", which could be read as the schema applying `.default(...)` at parse
  time. But the plan gives an exact, literal zod snippet for `retry` — `z.strictObject({
  maxAttempts: ...optional(), ... }).optional()` — with no `.default()` anywhere, and describes
  `tokenRefreshPct` identically (`z.number().min(0).max(100).optional()`, no `.default()`).
  Per this phase's own "pinned signature" framing (every construction site must agree on the
  *exact* shape), I treated the literal code as authoritative over the surrounding prose and did
  **not** add `.default()`: both fields stay plainly optional, and their imported-constant use is
  the `.describe()` docstring text (so the visible default documentation can never drift from the
  actual constant). Phase 5's `http-client.ts`/`auth-manager.ts` apply `config.retry ??
  DEFAULT_RETRY` / `config.tokenRefreshPct ?? DEFAULT_TOKEN_REFRESH_PCT` themselves, per the
  plan's own Phase 5 Step 4 language ("Default `tokenRefreshPct = 25`... when the config omits
  it"). If Step-A/Step-B review reads "the config default" as requiring an actual `.default()`
  call, that is a one-line change to this file (`.optional().default(DEFAULT_TOKEN_REFRESH_PCT)`)
  with no ripple beyond it, since Phase 5 was written to apply its own fallback regardless.
- **`rateLimit` config sub-schema has no cross-phase import.** The plan says unset `rateLimit`
  fields "fall back to the table's exported constants" in `src/rate-limit/rate-limits.ts` — a
  file Phase 5 creates. Since that module does not exist yet, `rateLimitConfigSchema` in this
  phase validates shape only (matching its own literal pinned snippet, which also carries no
  `.default()`); the actual fallback-to-table wiring is necessarily a Phase 5 concern once the
  table exists.

---

## 7. Tests

- `tests/unit/errors/datto-api-error.test.ts` (8 tests): `instanceof BaseError`/`Error`; every
  constructor option is stored; `fromAxiosError` maps `statusCode`/`response`/`message` from a
  `message`-keyed body; falls back to `statusCode: 0` with no response; extracts `requestId` from
  a conventional header and leaves it `undefined` when absent; leaves `retryAfterMs`/`code`
  unset; falls back to JSON serialization when no known message key is present.
- `tests/unit/errors/datto-validation-error.test.ts` (6 tests): `instanceof BaseError`/`Error`;
  `stage` + pretty message; request vs. response stage; optional `payload`/`context` stored and
  left `undefined` when omitted; `getErrorTree()` matches `z.treeifyError`.
- `tests/unit/errors/index.test.ts` (2 tests): `isDattoApiError`/`isDattoValidationError` narrow
  correctly and reject unrelated values.
- `tests/unit/logging/logger.test.ts` (4 tests): `dattoLoggerSchema` accepts a valid logger and
  the default `consoleLogger`; rejects a logger missing a method or with a non-function method.
- `tests/unit/logging/mask.test.ts` (4 tests): the plan's exact named R20 fixture (nested `udf`
  record, numeric UDF, object UDF, benign non-UDF field, null UDF) redacts correctly and the
  underlying sink never receives a raw secret in any call argument (verified via
  `JSON.stringify(sink.mock.calls)`); a call with no `meta` passes through unchanged; all four
  log levels are wrapped independently; a UDF nested inside an array element is masked.
- `tests/unit/client/config.test.ts` (11 tests): accepts a minimal and a fully-populated config;
  rejects an unknown top-level key, a malformed `apiUrl`, an empty `apiKey`/`apiSecret`, the
  retired `validationMode`/`autoRefresh` fields, a never-supported `axiosInstance`, an unknown key
  inside `retry`, a `defaultWriteLimit` override inside `rateLimit` (the R14 anti-pattern the
  plan explicitly calls out), and an out-of-range `tokenRefreshPct`.
- Total: **35 new tests**, all passing; the pre-existing **59** Phase-1/2 tests (jest→vitest
  conversions + generation pipeline) plus the **19** other already-present tests remain green,
  unchanged — **113 tests / 13 files** overall (`npm test`).

---

## 8. Security & Best-Practices Review

- **R20 (UDF masking) is the central security concern of this phase** and is covered by a
  dedicated test asserting the underlying log sink never receives a raw secret value in any
  argument, for every wire type (string, number, nested object) and at every nesting depth,
  including inside an array.
- `DattoApiError.response`/`DattoValidationError.payload` intentionally carry the raw wire
  payload for debugging (matching `fuze-api`'s `FuzeApiError.response`/
  `FuzeValidationError.context.wirePayload`) — this is unchanged, pre-existing behavior in the
  architecture this phase ports, not a new exposure; masking is scoped to *log* output (R20's
  explicit scope), not to error object fields a caller inspects directly.
- No `eval`/dynamic code execution; no new runtime dependencies (only `zod` and `axios`, both
  already present).
- `dattoRmmClientConfigSchema`'s `.strictObject` rejects unknown keys outright rather than
  silently ignoring them — closes the exact "dead config knob" pattern (`autoRefresh`,
  `validationMode`) the plan explicitly retires.
- `extractRequestId`/`extractErrorMessage` only ever read plain string/object shapes off
  already-received HTTP response data; no injection surface (no `eval`, no dynamic property
  access beyond a fixed candidate-key list).

---

## 9. Self-Review Scoring

| Element | Before | After | Comments |
|---------|--------|-------|----------|
| Extensibility | 9.0 | 9.5 | `DattoApiErrorOptions`/`DattoValidationErrorOptions` are named, exported interfaces (not inline object types), so Phase 5/6/7/8 construction sites get full IDE/type-checker support; the ordered-candidate-key pattern (`ERROR_MESSAGE_KEYS`, `REQUEST_ID_HEADERS`) is a documented, one-place-to-extend list rather than an inline conditional chain. |
| Understandability | 9.0 | 9.5 | Every deviation and ambiguity is documented at its point of use (module/field JSDoc) as well as in §5/§6 here, with concrete reasoning (the exact pinned-snippet text, the exact TS type conflict) rather than assertions. |
| Best Practices | 9.0 | 9.5 | `consoleLogger: DattoLogger = console` reuses this repo's own established, lint-clean idiom instead of a `console.debug(...)`-calling wrapper that would trip `no-console`; `BaseError`'s `cause` widening is a documented, behavior-preserving correctness fix, not an unsafe cast. |
| Plan Adherence | 9.0 | 9.5 | All four steps' pinned signatures/shapes implemented exactly (verified by tests asserting the literal option fields and rejection cases the plan names, e.g. the `defaultWriteLimit`-on-`rateLimit` anti-pattern). The three deviations are each justified against the plan's own explicit rules (native `ErrorOptions` correctness, "examples not mandates", the phase's own closed file list) rather than convenience. |
| Test Quality | 9.0 | 9.5 | The mask test reproduces the plan's own named fixture verbatim and additionally asserts on the raw serialized sink calls (not just the returned object) so a masking regression that leaked a secret into a *different* argument position would still be caught; the config test explicitly covers every named rejection case from the plan text, not just the happy path. |

---

## 10. Iterative Improvements Made

1. Ran `npm run typecheck`/`npm run lint` incrementally after each new file (not just at the
   end), which caught the `BaseError.cause` type conflict immediately rather than after all four
   modules were written.
2. Compared `consoleLogger`'s two possible implementations (an explicit `console.debug(...)`
   wrapper vs. a direct `console` reference) against this repo's own `no-console` ESLint config
   and its existing `src/logger.ts` precedent, and chose the zero-warning option.
3. Removed an unused `eslint-disable-next-line` comment from `base-error.ts` after `npm run lint`
   reported it as flagged-but-inert (the rule it targeted, `no-unnecessary-condition`, is not
   enabled in this repo's non-type-checked ESLint config) — cleaner than leaving dead
   suppression comments.
4. Added the array-nesting and no-meta-call cases to `mask.test.ts` beyond the plan's single named
   fixture, since the recursive `scrub` implementation's array branch and the `meta`-omitted
   branch of `withUdfMasking`'s wrapper were both otherwise untested code paths.
5. Ran `npx prettier --write` over every new file at the end (the repo's `prettierrc` file is
   misnamed and not actually picked up by Prettier — a pre-existing, out-of-scope issue
   documented in the Phase 2 notes — so this applies Prettier's own defaults, matching the
   already-established, observably-in-use repo style).

---

## 11. Remaining Risks or Follow-Ups

- `requestId` header-name extraction in `fromAxiosError` is a best-effort convention (see §6),
  not a confirmed Datto contract — the design/plan's own Deferred Validation items already cover
  live-response verification generally; Step-A/Step-B review should confirm the candidate-list
  approach is an acceptable interim answer to a genuine spec gap.
- Whether `retry`/`tokenRefreshPct` should carry an actual zod `.default()` (vs. the Phase
  5-applies-the-fallback design implemented here) is flagged in §6 as a one-line change if review
  reads the plan's prose differently from its literal code snippet.
- `DEFAULT_RETRY`/`DEFAULT_TOKEN_REFRESH_PCT`/`MAX_RETRY_AFTER_MS` are defined but **unconsumed**
  until Phase 5 wires the HTTP transport and auth manager against them — expected at this point in
  the plan's phase sequencing, not a defect.
- `dattoRmmClientConfigSchema` is defined but not yet wired into a constructor (`DattoRmmClient`
  itself is Phase 8) — also expected sequencing, not a defect.

---

## 12. Commands Run / To Run

- `npm run typecheck` — passes (`typecheck:src`, `typecheck:test`, `typecheck:tools` all green).
- `npm run lint` — passes, 0 errors, 11 pre-existing `no-explicit-any` warnings in untouched old
  files (unchanged from Phase 2).
- `npm test` — `vitest run`: 13 files, 113 tests, all passing (94 pre-existing + 19 pre-existing-
  other + 35 new — see §7).
- `npm run build` — `tsup`: ESM `dist/index.js` + `dist/index.d.ts` emitted successfully (not
  part of this phase's Exit Gate, run as an extra confidence check that the old surface still
  compiles end-to-end).
- `npx prettier --write` over all new `src/`/`tests/` files.
- `git status` — confirmed only new, untracked files/directories; no tracked (old-surface) file
  modified.

---

## 13. Final Assertion

I assert that:
- Only Phase 3 has been implemented.
- No unnecessary scope expansion occurred (all deviations are documented, evidence-backed, and
  justified against the plan's own explicit rules, per §5).
- All quality scores are ≥ 9.5.
