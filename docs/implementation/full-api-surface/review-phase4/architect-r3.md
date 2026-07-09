## architect — round 3

In-progress review, converging round. I had no `Open` architect findings entering this round —
both `architect-r1-f1` (doubly-nested `total`) and `architect-r1-f2` (false `Math.max` JSDoc) were
ratified `Closed` in round 2 and are not re-listed (earlier-closed findings must not reappear). The
two findings the reviser dispositioned this round (`engineer-r2-f1`, `typescript-cop-r2-f1`) are not
mine to adjudicate; I re-verified only that their fixes do not regress the architect axes, and they
do not. No new architect-axis findings.

### Round-3 changes re-checked against the architect axes (no finding)

- **`transform` terminal added to `cleanAndDiagnoseResponse` (engineer-r2-f1).** The new
  `case "transform": return parsed;` (`src/validation/schema-leniency.ts:577-579`) is structurally
  identical to `addCatchallRecursive`'s existing `transform` terminal (`:271-274`): both treat the
  node as opaque and pass the value through unchanged. Ownership and symmetry hold — the two
  parallel walkers keep the same recognized-kind set, so neither can silently diverge into the
  throwing `default`. The reachability path is real (a bare `z.string().transform(fn)` is a
  `ZodPipe` whose `out` is a `transform` node, so the `pipe` case's `pipeOut` recursion lands here),
  and no committed schema under `src/generated/schemas/**` contains a `transform` today, so this is
  a correct defensive terminal, not a live behavior change. No boundary, data-flow, or diagnostic
  correctness impact: an opaque node carries no shape to clean or aggregate.

- **`Lenient<T>` primitive-before-object reorder (typescript-cop-r2-f1).** The added primitive
  branch (`:711`) precedes the `object` branch, so a distributed `(string & {})` member of a
  widened response-enum union (`EnumUnion | (string & {})`) short-circuits as a primitive instead of
  matching `extends object` and being mapped over `String.prototype`. This is the enum type/runtime
  split I validated in rounds 1–2, now made sound at the type level: generated runtime zod schemas
  stay closed and are widened only at parse time, generated *types* are already open, and
  `Lenient<T>`'s `cleaned as Lenient<T>` return no longer corrupts any enum field's type. The
  `object` branch still adds `| null` homomorphically (preserving `?`), matching `toLenientField`'s
  `.nullable().optional()` runtime leniency for the all-optional generated interfaces (verified:
  every field in the generated response interfaces, e.g. `Device`, is `?`-optional, so the mapped
  `| null` plus the pre-existing `| undefined` exactly covers runtime null+absent tolerance). The
  new `tests/generated/lenient-type-pin.ts` is a compile-time pin picked up by
  `tsconfig.test.json`'s glob (no runtime coupling, no test-runner execution as it is a `.ts`, not a
  `.test.ts`), turning the type-contract invariant into a build-breaking guard — a boundary-clean
  enforcement addition. Type-precision beyond this is `/typescript-cop`'s axis; nothing here affects
  module boundaries, data flow, or the public parse contract.

- **Isolation / boundaries unchanged.** All `_zod.def` access remains confined to
  `schema-leniency.ts` behind `getDef`/`objectShape`/`nodeChildren`; `DiagnosticsCollector` is
  untouched this round (no diff) and remains a single-responsibility primitive. The
  `enum`/`union`/`record`/`transform` handling that is inert against today's committed schemas stays
  documented as such; the union-freedom build guard still enforces the `toLenientField`
  all-fields-optional invariant. Diagnostics lifecycle, R20 static-message/`meta` split, and
  fail-loud `default` drift guards on both walkers are all unchanged and correct.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|

No `Open` architect findings. Both round-1 findings remain `Closed` (ratified in round 2); the
round-3 revisions introduce no architecture, boundary, data-model, public-API, performance, or
security regression.
