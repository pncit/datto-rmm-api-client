/**
 * Compile-time-only regression pin for the six hand-mirrored paginated-item schemas Phase 7's
 * resources declare (`account-resource.ts`'s `componentSchema`/`dnetSiteMappingSchema`,
 * `site-resource.ts`'s `deviceNetworkInterfaceSchema`/`filterSchema`, `job-resource.ts`'s
 * `jobComponentSchema`, `variable-schema.ts`'s `variableSchema`) against the generated entity type
 * each one mirrors (`Component`, `DnetSiteMappingsDto`, `DeviceNetworkInterface`, `Filter`,
 * `JobComponent`, `Variable`).
 *
 * Each hand-written schema is a plain mirror of a generated shape (no R8-style reconciliation
 * needed — see each schema's own doc), asserted via `narrow<T>` at its call site with nothing
 * binding the schema to the type. Because `parseLenient` strips unknown keys, a spec regeneration
 * that adds a field to one of these entities would otherwise silently drop that field from the
 * returned value while the declared return type still claims it, undetected by any test or the
 * typechecker. This file is that guard: it fails `npm run typecheck` the moment a schema's key set
 * diverges from its generated type's key set.
 *
 * **Key-set equality, not full deep equality:** a naive `Equal<z.infer<typeof schema>, T>` pin
 * would fail *today*, independent of any future drift, for `Filter`/`filterSchema` — the
 * response-enum-widening codemod (Phase 2) widens `Filter["type"]` to
 * `FilterType | (string & {})`, while `filterSchema`'s `z.enum([...])` is authored closed; the
 * widening that reconciles the two happens only at runtime (`parseLenient`'s recursive walk over
 * the schema tree, Phase 4), which does not change `z.infer`'s compile-time result. That
 * open-enum/closed-enum asymmetry is already covered generically for every entity by
 * `Lenient<T>` and `lenient-type-pin.ts`, so re-proving it per schema here would be redundant.
 * What this file guards instead — and the specific hazard the missing-guard finding names — is a
 * field silently added or removed upstream, which a key-set comparison catches directly without
 * fighting the enum-widening type mismatch.
 *
 * Picked up directly by `tsconfig.test.json`'s `include: ["tests/**\/*.ts", ...]` glob, alongside
 * `lenient-type-pin.ts`; contains no runtime assertions and is never imported by a `*.test.ts` file.
 */
import type { z } from "zod";

import { componentSchema, dnetSiteMappingSchema } from "../../src/client/resources/account-resource";
import { jobComponentSchema } from "../../src/client/resources/job-resource";
import { deviceNetworkInterfaceSchema, filterSchema } from "../../src/client/resources/site-resource";
import { variableSchema } from "../../src/client/resources/variable-schema";
import type { Component } from "../../src/generated/types/component";
import type { DeviceNetworkInterface } from "../../src/generated/types/deviceNetworkInterface";
import type { DnetSiteMappingsDto } from "../../src/generated/types/dnetSiteMappingsDto";
import type { Filter } from "../../src/generated/types/filter";
import type { JobComponent } from "../../src/generated/types/jobComponent";
import type { Variable } from "../../src/generated/types/variable";

/** Strict type equality (standard type-testing idiom — see `lenient-type-pin.ts`'s doc for why a
 * generic-function comparison is used over a bare `extends` check). */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (
  <T>() => T extends B ? 1 : 2
)
  ? true
  : false;

/** Fails to compile unless its argument is the literal type `true`. */
type Expect<T extends true> = T;

// Each pin below asserts the generated type's field names and the hand-written schema's
// inferred field names are exactly the same set (order-independent) — a field added to or
// removed from either side fails `npm run typecheck`.

type _ComponentKeys = Expect<
  Equal<keyof Component, keyof z.infer<typeof componentSchema>>
>;
type _DnetSiteMappingsKeys = Expect<
  Equal<keyof DnetSiteMappingsDto, keyof z.infer<typeof dnetSiteMappingSchema>>
>;
type _DeviceNetworkInterfaceKeys = Expect<
  Equal<
    keyof DeviceNetworkInterface,
    keyof z.infer<typeof deviceNetworkInterfaceSchema>
  >
>;
type _FilterKeys = Expect<
  Equal<keyof Filter, keyof z.infer<typeof filterSchema>>
>;
type _JobComponentKeys = Expect<
  Equal<keyof JobComponent, keyof z.infer<typeof jobComponentSchema>>
>;
type _VariableKeys = Expect<
  Equal<keyof Variable, keyof z.infer<typeof variableSchema>>
>;
