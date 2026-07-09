# Implementation Notes — Phase 4

- **Plan:** full-api-surface
- **Phase:** 4
- **Date:** 2026-07-09
- **Agent:** Implementor

---

## 1. Phase Scope Confirmation

**In-Scope (Phase 4 only):**
- `src/validation/schema-leniency.ts`: `parseLenient(schema, data, logger?, context?)`, ported
  from `@pncit/fuze-api` and extended for the Datto reality — response-side nullability/presence
  leniency on every named object field, enum degradation (open-passthrough with widening
  diagnostics), and the exported `enumFieldPaths(schema)` helper Phase 9's completeness guard
  will import.
- `src/validation/diagnostics.ts`: `DiagnosticsCollector` — the small, dedupe-and-summarize
  aggregation primitive that turns per-occurrence unknown-key-strip / enum-widening events into
  one summarized `debug` line per `(message, field, value?)` per `parseLenient` call.
- Unit tests for every behavior named in the plan's Tests section, plus direct coverage of
  `DiagnosticsCollector` and `enumFieldPaths`.

**Explicitly Out-of-Scope:**
- Any change to the old runtime surface (`src/client.ts`, `src/config.ts`, `src/auth.ts`,
  `src/httpClient.ts`, `src/rateLimiter.ts`, `src/tokenStore.ts`, `src/validation.ts`,
  `src/schemas.ts`, `src/logger.ts`, `src/result.ts`, `src/internal/`) — untouched, still
  compiling, per the coexistence rule. Verified: `git status` shows only two new, untracked
  directories (`src/validation/`, `tests/unit/validation/`) after this phase; no tracked file was
  modified.
- The rate limiter, HTTP transport, and `AuthManager` (Phase 5).
- `BaseResource`, `validateRequest`/`validateResponse`/`validateArrayResponse`, resource classes,
  and `DattoRmmClient` itself (Phases 6–8) — `parseLenient` is a standalone primitive in this
  phase, not yet wired to any call site. In particular, the per-item **drop** path (R7, `warn`
  level) belongs to `validateArrayResponse` (Phase 6 Step 1, per the plan's own text) and is not
  implemented here; `DiagnosticsCollector` is deliberately generic enough for that phase to reuse,
  but no drop-specific method was added now (nothing in this phase needs one).
- `src/schema-overrides.ts` (Phase 6) — nothing in this phase imports from or depends on it.

---

## 2. Phase Intent (Interpreted)

Give every later phase's response validation a single, load-bearing primitive: `parseLenient`,
which turns a strict, spec-derived zod schema into one that survives the two defect patterns
Datto's real responses are known to exhibit — pervasive nullability the spec never declares, and
enum members the spec hasn't documented yet — without ever silently discarding a record. A
response that would otherwise fail (nullability) or a value that would otherwise be dropped
(R7's per-item drop, in Phase 6) instead type-checks and parses, with the tolerated event
reported once, summarized, at `debug`. Requests are untouched — `parseLenient` is never called on
the request path, so strict validation there (Phase 6) is unaffected.

---

## 3. Files Touched

| File | Change Type | Rationale |
|------|------------|-----------|
| `src/validation/schema-leniency.ts` | Created | `parseLenient`, `addCatchallRecursive`, `detectUnknownProperties`, `enumFieldPaths` |
| `src/validation/diagnostics.ts` | Created | `DiagnosticsCollector` — dedupe/aggregate/flush primitive |
| `tests/unit/validation/schema-leniency.test.ts` | Created | Full behavior suite: ported fuze-api cases (adapted) + Datto-specific enum/nullability/aggregation cases + `enumFieldPaths` |
| `tests/unit/validation/diagnostics.test.ts` | Created | Direct unit coverage of `DiagnosticsCollector` |

---

## 4. Implementation Summary

**`schema-leniency.ts`.** Ported `fuze-api`'s `addCatchallRecursive`/`detectUnknownProperties`/
`parseLenient` verbatim as the Step 1 baseline (schema-tree walk, `_zod.def` isolation, the
WeakMap cache, union-branch matching by broadest-key-set-first), then extended it per Steps 2–3:

- **Enum degradation (Step 2).** `addCatchallRecursive` gained an `'enum'` case: an enum node's
  member values are widened to `z.enum(values).or(z.string())`, so any string parses. The
  *original* (unwrapped) schema still carries the closed member set, so
  `detectUnknownProperties` gained a parallel `'enum'` case that checks the parsed string against
  it and records a widening diagnostic — never rejecting or rewriting the value — only when it
  falls outside. Since `parseLenient` is never invoked on the request path (Phase 6's
  `validateRequest` calls `schema.safeParse` directly against the *unwidened* generated request
  schema), enums stay closed on requests with no flag needed inside the walker, exactly as the
  plan specifies.
- **Nullability/presence leniency (Goal + Tests, folded into Step 2's "extend the recursive
  walk").** The plan's Goal text ("response validation tolerates null/absent on any field") and
  its Tests list ("Null on a spec-non-nullable field is tolerated on the response path") require
  this but it isn't its own numbered step; I implemented it inside `addCatchallRecursive`'s
  `'object'` case via a new `toLenientField` helper (`.nullable().optional()`), applied to every
  named shape key at every nesting depth, regardless of what the (unreliable) spec declared for
  that field. Scoped to named object fields only — a `record`'s dynamic values are left to their
  own declared shape, since "optional" has no clear meaning for an already-dynamic key, and
  nothing in the plan's Tests or the design's R5 examples names record values.
- **Aggregated, leveled diagnostics (Step 3).** Both diagnostic kinds are benign, so both log at
  `debug` (not fuze-api's immediate `warn`). Rather than calling the logger per occurrence,
  `detectUnknownProperties` now records into a `DiagnosticsCollector` (`./diagnostics.ts`, a
  separate file since the plan's own Files line allows one "if the collector is non-trivial," and
  this one — dedupe key, group counting, flush/clear, an `isEmpty` fast-path — is), and
  `parseLenient` flushes it once at the end of the call with `total` = the size of the top-level
  collection (`Array.isArray(result.data) ? result.data.length : 1`).
- **`enumFieldPaths`** reuses the same schema-tree walk (object/array/union/optional/nullable/
  record/pipe/default) over the *original* schema to return every enum node's dotted path,
  confining this additional `_zod.def` introspection to this one file per the isolation rule the
  module doc (ported from fuze-api) states.

**`diagnostics.ts`.** `DiagnosticsCollector` is a minimal, generic dedupe/aggregate/flush
primitive: `record(message, field, value?)` folds an occurrence into an existing group (keyed on
all three) or starts one; `flush(logger, context, total)` emits one `debug` line per group with
`{ context, field, count, total }` (+ `value` when present) and clears. It requires only a
`{ debug }`-shaped logger — the only level either event this phase produces ever uses — rather
than speculatively also requiring `warn` for Phase 6's not-yet-existing drop path.

---

## 5. Deviations From Plan (If Any)

1. **Array element diagnostic paths deliberately drop the numeric index — a real behavioral
   divergence from fuze-api's ported original, not a cosmetic one.** fuze-api's
   `detectUnknownProperties` embeds the array index in the reported `path` (`[0].extra`,
   `[1].extra`, …), which it can do because it logs immediately, per occurrence. Datto's Step 3
   requires the opposite: diagnostics *aggregated per call*, summarized as e.g. "widened
   `deviceClass=rmmnetworkdevice` on 3/848 devices." Those two are incompatible: an index-qualified
   path is unique per array element by construction, so the same field at the same structural
   position across 848 collection items would never collapse into one group — aggregation would
   silently do nothing for exactly the large-collection case it exists to handle. So the array
   case now passes the *same* `path` to every element instead of appending `[i]`. This is
   documented at the point of change (both functions' doc comments) and is exactly why
   `enumFieldPaths`' schema-only paths (`['deviceClass', 'antivirus.antivirusStatus', …]`, no
   index syntax anywhere) already matches this convention — the plan's own example paths corroborate
   it.
2. **`detectUnknownProperties` kept its name across an expanded responsibility (now also detects
   enum widening, not just unknown keys).** *Why:* it is still fundamentally "walk parsed output
   against the original schema and report/clean deviations"; renaming an internal (unexported)
   function purely for a label change adds churn without adding traceability, and the module's
   updated doc comment states its full current responsibility precisely.
3. **The one ported test whose assertion had to change: "returns failure when data is missing
   required keys from all union branches."** Under blanket per-field nullability/presence
   leniency, a union's own required discriminator field is no longer required by the *permissive*
   parse step, so a payload matching none of the branches' real shapes now succeeds (matching the
   first, now-effectively-all-optional branch) instead of failing. I verified this has zero
   effect on any real Datto schema — `grep -rn "zod.union(" src/generated/schemas/` returns no
   matches; Datto's spec declares no `oneOf`/discriminated-union response bodies — and updated
   the test's expectation and description to document the new, intentional behavior (R5's own
   text: "all fields are tolerated as nullable/optional," with no carve-out for union
   discriminators) rather than silently preserving a stale assertion. Flagged again in §11.

No other deviations. `parseLenient`'s signature, `enumFieldPaths`' export, and the aggregated
`debug`-level diagnostic shape all match the plan's pinned text and code sketch.

---

## 6. Ambiguities & Decisions

- **Dedup key composition differs by event kind, and this is deliberate, not an oversight.** The
  design's prose describes both diagnostic kinds as "deduped by `(context, field, value)`." Taken
  completely literally for the unknown-key-strip event, `value` would be the actual stripped
  value — but that value is typically unique per record (an arbitrary future field Datto adds),
  so including it in the dedup key would produce one group *per item* for a field that appears on
  every record in a page, defeating the exact volume-control goal the design states in the same
  breath ("cannot produce thousands of lines... rather than per row"), and directly contradicts
  fuze-api's own explicit precedent (its test literally asserts "Verify value is NOT included in
  metadata (prevents log noise and data leakage)"). I read "(context, field, value)" as the
  general *shape* of a diagnostic identity, not a literal instruction to always populate `value`:
  enum widening passes it (a specific out-of-set member is itself the informative,
  naturally-bounded-cardinality signal worth its own line); unknown-key-strip does not (dedup by
  field alone, matching fuze-api's established behavior). `context` is applied uniformly at
  `flush()` rather than per-record, since one `parseLenient` call has exactly one context.
- **What "total" means for a non-array top-level parse.** The design's own example
  ("3/848 devices") is array-shaped. For a single-object top-level parse (e.g. `GET
  /device/{uid}`), I defined `total = 1` (`Array.isArray(result.data) ? result.data.length : 1`)
  so the same `{ count, total }` shape always applies, even though a single-object parse's
  diagnostics will always show `total: 1`. No test in the plan's Tests list exercises this case
  directly; verified sound by direct construction (see §7) rather than by a named plan
  requirement.
- **Nullability/presence leniency scope: named object fields only, not record values.** See §4 —
  the plan's Goal/Tests require field-level leniency but neither names record values, and
  "optional" has no clean meaning for an already-dynamic map key. If Phase 6/9 review surfaces a
  concrete record-shaped response field (e.g. a site-variable map) that needs the same tolerance,
  it is a one-line addition to `addCatchallRecursive`'s `'record'` case.

---

## 7. Tests

- `tests/unit/validation/schema-leniency.test.ts` (52 tests): the full ported fuze-api suite
  (happy path, root/nested/array/record/union/optional/nullable/strictObject/pipe/default
  unwrapping, cache behavior, no-logger fast path, context propagation, failure passthrough, edge
  cases, round-trip correctness) adapted for the `debug`-level, aggregated, `field`-keyed,
  index-free diagnostic shape (see §5.1), plus new Datto-specific coverage:
  - Enum degradation: widens and reports an unobserved response enum value without dropping the
    item (including at a nested dotted path); does **not** report a value within the declared
    set; aggregates the plan's named case — an array of 50 items sharing the same widened value —
    into exactly one summarized call; keeps two distinct widened values in the same array as two
    separate groups.
  - Nullability/presence leniency: tolerates `null` on a spec-non-nullable string field, an
    entirely absent spec-non-optional field, `null` on a spec-non-nullable enum field (with no
    spurious widening report), and `null` on a spec-non-nullable nested object field — all with
    zero diagnostics (this is silent tolerance, not a strip or a widening).
  - Array-index-dropping: two dedicated tests proving the field path carries no `[i]` segment and
    that the same field stripped from every item in a collection collapses into one summarized
    call with the correct `count`/`total`.
  - `enumFieldPaths`: empty-array for an enum-free schema; a top-level path; the plan's own named
    multi-depth example (`deviceClass`, `antivirus.antivirusStatus`, `patchManagement.patchStatus`,
    sorted); a path through an array with no index segment; a path through
    optional/nullable-wrapping; a path through a union branch.
- `tests/unit/validation/diagnostics.test.ts` (7 tests): starts empty; `isEmpty` after a record;
  flush emits one line per distinct `(message, field, value)` group with the correct `count`; a
  group recorded without `value` omits it from the flushed `meta`; a valued and an unvalued group
  at the same `(message, field)` stay distinct; `flush` clears all groups; `flush` on an empty
  collector is a no-op.
- **Real-fixture sanity check (not part of the committed suite — see §12):** manually parsed
  `src/__tests__/fixtures/device.json` against the real generated
  `getByUidResponse` schema and `src/__tests__/fixtures/devicesPage.json` against
  `getSiteDevicesResponse`, both through `parseLenient` with a capturing `debug` logger — both
  succeeded with zero diagnostics, confirming the module works end-to-end against this repo's
  existing real device captures, not just synthetic test schemas.
- Total: **59 new tests**, all passing; **123** pre-existing tests unchanged — **182 tests / 15
  files** overall (`npm test`).

---

## 8. Security & Best-Practices Review

- **R20 compliance is structural, not per-call-site.** Every diagnostic this module produces
  passes its wire-derived value (the enum's out-of-set string) through `meta.value`, never
  interpolated into the message string (both messages — `'stripped unknown response property'`,
  `'widened response enum'` — are static text plus, at most, static keys/counts in `meta`), so
  `withUdfMasking` (Phase 3) scrubs it correctly if it were ever a UDF value (`deviceClass` isn't,
  but the rule is enforced uniformly, per the plan's own R20-invariant framing in Step 3).
- The stripped-key event deliberately never logs the stripped value at all (§6), which is
  strictly more conservative than the R20 boundary requires, not less.
- No `eval`/dynamic code execution. No new runtime dependencies — only `zod`, already a direct
  dependency.
- All Zod v4 internal (`_zod.def`) access remains isolated to this one file, per the design's
  explicit risk mitigation ("Isolate all zod-internal access to `schema-leniency.ts`... cover
  leniency with unit tests") — `enumFieldPaths` reuses it rather than adding a second site.
- `DiagnosticsCollector`'s dedup key is a plain string built from caller-supplied strings; no
  injection surface (it is a `Map` key, never interpreted as code or a query).

---

## 9. Self-Review Scoring

| Element | Before | After | Comments |
|---------|--------|-------|----------|
| Extensibility | 9.0 | 9.5 | `DiagnosticsCollector` is a standalone, exported, generic dedupe/aggregate/flush primitive in its own file — Phase 6's per-item-drop aggregation (explicitly flagged by the plan as needing "the same" mechanism) can reuse it without modification to this phase's code. |
| Understandability | 9.0 | 9.5 | The one genuine behavioral divergence from the ported baseline (array-index dropping) is documented at both its point of implementation and in a dedicated deviation entry with the concrete mechanism (aggregation vs. per-occurrence index-uniqueness) that makes it necessary, not just asserted. |
| Best Practices | 9.0 | 9.5 | `DiagnosticsCollector`'s logger type requires only the `debug` method actually used in this phase rather than speculatively widening it for Phase 6's not-yet-existing `warn` path; the enum-degradation guard against a zero-member enum avoids a runtime crash on a degenerate schema. |
| Plan Adherence | 9.0 | 9.5 | All three Phase 4 steps implemented; the plan's own named test cases (50-item enum-widening aggregation, `enumFieldPaths`' multi-depth example) are reproduced verbatim as tests; every deviation (§5) is justified against the plan's own explicit text (the aggregation requirement in Step 3, R5's literal "any field" wording, a verified-empty grep against real generated schemas) rather than convenience. |
| Test Quality | 9.0 | 9.5 | Beyond the plan's named cases, tests directly exercise `DiagnosticsCollector` in isolation and verify the module against this repo's real, pre-existing device fixtures (not just synthetic schemas) end-to-end with zero diagnostics — the strongest evidence this phase's leniency mechanism actually matches production Datto response shapes rather than only its own test doubles. |

---

## 10. Iterative Improvements Made

1. Ran `npm run typecheck`/`npm run lint` after the first draft of `schema-leniency.ts`, before
   writing tests, catching nothing (clean on first pass) — then used that confidence to write the
   full adapted test suite against the real implementation rather than iterating types alongside
   assertions.
2. Ran the ported "union branches: returns failure..." test unmodified first, let it fail, traced
   the failure to the new blanket-leniency behavior (not a bug), verified via `grep` that no real
   Datto schema uses `z.union`, and only then updated the assertion — rather than assuming the
   change was correct without confirming the ported test's original intent no longer applied.
3. Added the two real-fixture sanity checks (§7, §12) as an ad hoc verification step (not part of
   the committed suite, since the plan's Tests section names only synthetic-schema unit tests for
   this phase) after noticing that every existing test's schema was hand-constructed rather than
   drawn from `src/generated/`; this caught nothing broken but is the strongest available evidence
   the module works against this repo's actual committed fixtures before Phase 6 wires it in.
4. Reduced `DiagnosticsCollector`'s logger requirement from a speculative `{ debug, warn }` shape
   to the `{ debug }` shape actually used, after first drafting the broader one and recognizing it
   was unused generality this phase doesn't need (Phase 6 can widen it when it actually needs
   `warn`).
5. Ran `npx prettier --write` over all four new files at the end (repo convention per Phase 3
   notes: the committed `prettierrc` is misnamed and not picked up, so this applies Prettier's own
   defaults, matching the already-established, observably-in-use double-quote repo style).

---

## 11. Remaining Risks or Follow-Ups

- The "union branches" test's behavior change (§5.3) is a real, if currently inconsequential,
  semantic tradeoff of blanket per-field leniency — Step-A/Step-B review should confirm treating
  R5's "any field" as literally universal (rather than carving out union discriminators) is the
  intended reading, since Datto's spec having zero unions today doesn't guarantee a future
  refresh or a hand-written override (Phase 6) never introduces one.
- `parseLenient`/`DiagnosticsCollector` are complete but **unconsumed** until Phase 6 wires them
  into `BaseResource.validateResponse`/`validateArrayResponse` — expected at this point in the
  plan's phase sequencing, not a defect.
- The record-values nullability-leniency scope decision (§6) is a one-line change if a concrete
  Phase 6/9 case needs it.

---

## 12. Commands Run / To Run

- `npm run typecheck` — passes (`typecheck:src`, `typecheck:test`, `typecheck:tools` all green).
- `npm run lint` — passes, 0 errors, 11 pre-existing `no-explicit-any` warnings in untouched old
  files (unchanged from Phase 3).
- `npm test` — `vitest run`: 15 files, 182 tests, all passing (123 pre-existing + 59 new — see
  §7).
- `npm run build` — `tsup`: ESM `dist/index.js` + `dist/index.d.ts` emitted successfully (not
  part of this phase's Exit Gate, run as an extra confidence check).
- Ad hoc (not committed): ran `parseLenient` against `src/__tests__/fixtures/device.json` /
  `devicesPage.json` through the real generated `getByUidResponse` / `getSiteDevicesResponse`
  schemas via temporary `vitest` files, confirmed zero diagnostics and `success: true`, then
  deleted the temporary files (`git status` confirmed no trace remains).
- `npx prettier --write` over all four new `src/`/`tests/` files.
- `git status` — confirmed only two new, untracked directories; no tracked file modified.

---

## 13. Final Assertion

I assert that:
- Only Phase 4 has been implemented.
- No unnecessary scope expansion occurred (all deviations are documented, evidence-backed, and
  justified against the plan's own explicit rules, per §5).
- All quality scores are ≥ 9.5.
