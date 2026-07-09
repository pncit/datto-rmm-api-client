/**
 * Compile-time-only regression pin for the hand-mirrored paginated-item schemas Phase 7/8's
 * resources declare (`account-resource.ts`'s `componentSchema`/`dnetSiteMappingSchema`,
 * `site-resource.ts`'s `deviceNetworkInterfaceSchema`, `filter-schema.ts`'s `filterSchema`
 * (shared by `SiteResource`/`FilterResource`), `job-resource.ts`'s `jobComponentSchema`,
 * `variable-schema.ts`'s `variableSchema`, `audit-resource.ts`'s `softwareSchema`,
 * `user-resource.ts`'s `authUserSchema`, `activity-log-resource.ts`'s `activityLogSchema`) against
 * the generated entity type each one mirrors (`Component`, `DnetSiteMappingsDto`,
 * `DeviceNetworkInterface`, `Filter`, `JobComponent`, `Variable`, `Software`, `AuthUser`,
 * `ActivityLog`).
 *
 * Each hand-written schema is a plain mirror of a generated shape (no R8-style reconciliation
 * needed — see each schema's own doc), asserted via `narrow<T>` at its call site with nothing
 * binding the schema to the type. Because `parseLenient` strips unknown keys, a spec regeneration
 * that adds a field to one of these entities — or changes an existing field's type — would
 * otherwise silently drop or mis-coerce that field at runtime while the declared return type still
 * claims the old shape, undetected by any test or the typechecker. This file is that guard.
 *
 * **Full structural equality for most, key-set equality for the two enum-bearing mirrors:** a
 * naive `Equal<z.infer<typeof schema>, T>` pin would fail *today*, independent of any future
 * drift, for `Filter`/`filterSchema` and `ActivityLog`/`activityLogSchema` — the
 * response-enum-widening codemod (Phase 2) widens `Filter["type"]` and `ActivityLog["entity"]` to
 * `EnumUnion | (string & {})`, while each hand-written schema's `z.enum([...])` is authored
 * closed; the widening that reconciles the two happens only at runtime (`parseLenient`'s
 * recursive walk over the schema tree, Phase 4), which does not change `z.infer`'s compile-time
 * result. That open-enum/closed-enum asymmetry is already covered generically for every entity by
 * `Lenient<T>` and `lenient-type-pin.ts`, so re-proving it per schema here would be redundant —
 * `Filter` and `ActivityLog` alone use the weaker key-set-only comparison, scoped to that one
 * documented asymmetry. Every other mirror (`Component`, `DnetSiteMappingsDto`,
 * `DeviceNetworkInterface`, `JobComponent`, `Variable`, `Software`, `AuthUser`) carries no enum
 * field at all (verified against their generated types, including every nested object —
 * `ComponentVariable`, `NetworkInterface`, `DevicesType`, `JobComponentVariable`), so each of those
 * uses a full `Equal<T, z.infer<typeof schema>>` pin instead, which — unlike key-set equality —
 * also fails the moment a same-named field's *type* changes (e.g. a spec regeneration turning
 * `Component.id` from `number` to `string`), not just when a field is added or removed.
 *
 * Picked up directly by `tsconfig.test.json`'s `include: ["tests/**\/*.ts", ...]` glob, alongside
 * `lenient-type-pin.ts`; contains no runtime assertions and is never imported by a `*.test.ts` file.
 */
import type { z } from "zod";

import { componentSchema, dnetSiteMappingSchema } from "../../src/client/resources/account-resource";
import { activityLogSchema } from "../../src/client/resources/activity-log-resource";
import { softwareSchema } from "../../src/client/resources/audit-resource";
import { filterSchema } from "../../src/client/resources/filter-schema";
import { jobComponentSchema } from "../../src/client/resources/job-resource";
import { deviceNetworkInterfaceSchema } from "../../src/client/resources/site-resource";
import { authUserSchema } from "../../src/client/resources/user-resource";
import { variableSchema } from "../../src/client/resources/variable-schema";
import type { ActivityLog } from "../../src/generated/types/activityLog";
import type { AuthUser } from "../../src/generated/types/authUser";
import type { Component } from "../../src/generated/types/component";
import type { DeviceNetworkInterface } from "../../src/generated/types/deviceNetworkInterface";
import type { DnetSiteMappingsDto } from "../../src/generated/types/dnetSiteMappingsDto";
import type { Filter } from "../../src/generated/types/filter";
import type { JobComponent } from "../../src/generated/types/jobComponent";
import type { Software } from "../../src/generated/types/software";
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

// The enum-free mirrors are pinned by full structural equality — a field being added, removed, or
// changing type on either side fails `npm run typecheck`.

type _Component = Expect<Equal<Component, z.infer<typeof componentSchema>>>;
type _DnetSiteMappingsDto = Expect<
  Equal<DnetSiteMappingsDto, z.infer<typeof dnetSiteMappingSchema>>
>;
type _DeviceNetworkInterface = Expect<
  Equal<
    DeviceNetworkInterface,
    z.infer<typeof deviceNetworkInterfaceSchema>
  >
>;
type _JobComponent = Expect<
  Equal<JobComponent, z.infer<typeof jobComponentSchema>>
>;
type _Variable = Expect<Equal<Variable, z.infer<typeof variableSchema>>>;
type _Software = Expect<Equal<Software, z.infer<typeof softwareSchema>>>;
type _AuthUser = Expect<Equal<AuthUser, z.infer<typeof authUserSchema>>>;

// `Filter`/`filterSchema` and `ActivityLog`/`activityLogSchema` stay key-set-only (see the file
// doc's Phase-2 enum-widening asymmetry) — a field added to or removed from either side fails
// `npm run typecheck`.
type _FilterKeys = Expect<
  Equal<keyof Filter, keyof z.infer<typeof filterSchema>>
>;
type _ActivityLogKeys = Expect<
  Equal<keyof ActivityLog, keyof z.infer<typeof activityLogSchema>>
>;
