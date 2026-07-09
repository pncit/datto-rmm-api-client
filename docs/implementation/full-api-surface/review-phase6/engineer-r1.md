## engineer — round 1

First engineer review of Phase 6 (`src/client/resources/base-resource.ts` and the
`src/schema-overrides/**` module, plus their tests). Prior turns in this directory are the
implementation-auditor's and reviser's, not engineer's — no engineer findings to carry forward, no
ruled escalations to honor — so this is a fresh exhaustive pass over maintainability, DRY, naming,
complexity, error handling, and cleanliness. The auditor already converged on plan-adherence and
correctness; the findings below are the everyday-maintainability concerns in its blind spot.

Overall the code is well-documented and cleanly structured. The concrete issues:

- **A robustness gap in `paginate`:** the walk loop has no cycle/upper-bound guard, so a server that
  returns a self-referential or non-advancing `nextPageUrl` spins forever, accumulating unbounded
  memory. The phase's whole premise is "never silently truncate," but the opposite failure mode
  (never terminate) is equally real and is untested.
- **Duplicated "reject an all-omitted body" `.refine`** repeated verbatim four times in
  `write-bodies.ts`.
- Several smaller reuse / consistency nits (an existing `isRecord` guard bypassed by hand-casts;
  inconsistent `*Input` type derivation; a nested-ternary type describer; the arity-based write
  dispatch).

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | Medium | Open | ErrorHandling | `src/client/resources/base-resource.ts:387-409` (`paginate`) | The `while (url)` walk follows `cursor.data.nextPageUrl` with no cycle detection and no maximum-page cap. A server bug, or a malicious/misbehaving endpoint, that returns a `nextPageUrl` equal to (or cycling back to) an already-fetched URL makes `paginate` loop forever, growing `items` without bound — a hang/OOM that no test exercises. This is the inverse of the R3 "never truncate" guarantee and just as much a correctness risk. | Add a bounded guard: either a `MAX_PAGES` module constant that throws `DattoValidationError('response')` when exceeded, or track visited URLs in a `Set<string>` and throw on a repeat. Add a paginate test for the cyclic-`nextPageUrl` case. |
| engineer-r1-f2 | Medium | Open | DRY | `src/schema-overrides/write-bodies.ts:80-83, 132-135, 154-158, 169-172` | The predicate `(body) => Object.values(body).some((value) => value !== undefined)` with a "at least one field must be provided"-style message is copy-pasted into four `.refine` calls (`udfWriteBodySchema`, `updateSiteVariableWriteBodySchema`, `updateAccountVariableWriteBodySchema`, `updateProxyWriteBodySchema`). The identical intent is restated four times; a future tweak (e.g. also treating `null` as absent) must be made in four places. | Extract one helper, e.g. `const requireSomeField = <S extends z.ZodTypeAny>(schema: S, message = "at least one field must be provided") => schema.refine((body) => Object.values(body as object).some((v) => v !== undefined), { message });` and apply it to all four bodies. |
| engineer-r1-f3 | Low | Open | DRY | `src/client/resources/base-resource.ts:392-393, 401-402` | `paginate` hand-casts `(data as Record<string, unknown> \| undefined)?.pageDetails` / `?.[arrayKey]` twice, duplicating the cast and bypassing the existing `isRecord` guard (`src/util/is-record.ts`) whose own doc says it is "Shared by every module that needs to distinguish a JSON object body ... before doing keyed lookups on it." The unchecked cast also lies about non-object page bodies (a string `data` is asserted to be a record). | Compute once: `const record = isRecord(data) ? data : undefined;` then read `record?.pageDetails` and `record?.[arrayKey]`. Reuses the shared guard and removes the duplicated cast. |
| engineer-r1-f4 | Low | Open | Naming | `src/schema-overrides/write-bodies.ts:86, 105, 119, 175` | The `*Input` type aliases derive inconsistently: `DeviceUdfInput` and `SiteProxyInput` are `z.infer<typeof setUdfFieldsBody>` / `z.infer<typeof updateProxyBody>` (the **raw generated** bodies), while `DeviceWarrantyInput` and `SiteVariableCreateInput` are `z.infer<typeof warrantyWriteBodySchema>` / `z.infer<typeof createSiteVariableWriteBodySchema>` (the **override** schemas). Each alias's doc says "the validated input shape {overrideSchema} accepts," yet half of them infer from a different symbol — a reader can't trust the pattern. | Derive every `*Input` alias from its exported override schema (`z.infer<typeof udfWriteBodySchema>`, `z.infer<typeof updateProxyWriteBodySchema>`, …) so the alias name, its doc, and its source all agree. |
| engineer-r1-f5 | Low | Open | Complexity | `src/client/resources/base-resource.ts:323-330` | The `receivedType` value is a two-level nested ternary (`data === undefined ? "undefined" : data === null ? "null" : typeof data`) inline inside the `logger.warn` meta object, which is harder to scan than it needs to be. | Extract `const describeType = (v: unknown): string => v === undefined ? "undefined" : v === null ? "null" : typeof v;` (module scope) and call `describeType(data)`. |
| engineer-r1-f6 | Low | Open | Naming | `src/schema-overrides/write-bodies.ts:132-135, 154-158` | `updateSiteVariableWriteBodySchema` and `updateAccountVariableWriteBodySchema` export no companion `*Input` type, while every other write-body override here (create variants, udf, warranty, proxy) exports one. Phase 7 consumers of the update operations get an inconsistent, incomplete public surface. | Add `SiteVariableUpdateInput` / `AccountVariableUpdateInput` aliases (deriving from their override schemas, per f4) and export them from `index.ts`, matching the create-side pattern. |
| engineer-r1-f7 | Low | Open | MagicValues | `src/client/resources/base-resource.ts:222` (`sendWrite`) | The bodied/bodiless dispatch keys on the bare literal `args.length === 3`, coupling control flow to the arity of the `BodilessWriteArgs` tuple with no named anchor. If that tuple ever gains or loses an element, this branch silently mis-dispatches (a bodied call falling into the bodiless path, or vice versa) with nothing at the dispatch site to catch it. | Introduce a `const BODILESS_WRITE_ARITY = 3` constant (or discriminate on a structural check rather than length) and reference it here, so the coupling is named and greppable next to the tuple definitions. |

Mechanics: all findings originate this round (`engineer-r1-f{m}`); none inherited from the
auditor/reviser turns. New issues in a later round would take `engineer-r2-f{m}`.
