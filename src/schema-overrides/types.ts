import type { z } from "zod";

import type { Alert as GeneratedAlert } from "../generated/types/alert";
import type { Device as GeneratedDevice } from "../generated/types/device";

import { ALERT_WIDENED_FIELDS, alertResponseSchema } from "./alert-overrides";
import {
  DEVICE_WIDENED_FIELDS,
  deviceResponseSchema,
} from "./device-overrides";

/**
 * Reconciled entity types (R4/R5 alignment, design "Schema-override module").
 *
 * For every entity this module reconciles, the public TypeScript type must both (a) carry the
 * reconciled shape (the `udf` record, the open `alertContext`) and (b) carry the R5 open-enum
 * widening (`EnumUnion | (string & {})`) the Phase-2 codemod applies to `src/generated/types/**`
 * at every nesting depth — because that widening is TypeScript-only (no zod/runtime
 * representation), `z.infer<typeof deviceResponseSchema>` alone does **not** carry it: composing
 * the generated zod enum yields either a *closed* union (a novel value fails to type-check,
 * reviving the exact compile-time-claims-more-than-runtime-allows hazard R5 exists to kill) or,
 * via `.or(z.string())`, a collapsed plain `string` (losing the literal members). Neither is the
 * R5 shape.
 *
 * The fix: intersect each reconciled entity's `z.infer` with a `Pick` of the **already-widened**
 * generated type, taken at the *containing top-level field* of every enum the entity carries —
 * `Pick<GeneratedDevice, 'antivirus'>` re-adds the whole `antivirus` sub-object from the
 * codemod-widened generated `Device`, so the nested `antivirusStatus` enum is widened along with
 * the top-level `deviceClass`. The `Omit`/`Pick` key set is driven from one `as const` constant per
 * entity (`DEVICE_WIDENED_FIELDS`, `ALERT_WIDENED_FIELDS` — `./device-overrides.ts`,
 * `./alert-overrides.ts`), never hand-repeated literals, so the graft and the constant cannot
 * desync.
 *
 * This is sound only because each reconciled field (`udf`, `alertContext`) contains no enum of its
 * own and does not overlap a `WIDENED_FIELDS` entry — true today (`udf` is a scalar record,
 * `alertContext` an open `@class` object). Phase 9's recursive completeness guard
 * (`enumFieldPaths`, `src/validation/schema-leniency.ts`) verifies every enum field present on
 * each entity — at every depth — has its containing top-level property listed in that entity's
 * `WIDENED_FIELDS` constant, so a spec-refresh enum whose containing field is omitted here fails
 * that gate rather than shipping a silently-closed type.
 */
export type Device = Omit<
  z.infer<typeof deviceResponseSchema>,
  (typeof DEVICE_WIDENED_FIELDS)[number]
> &
  Pick<GeneratedDevice, (typeof DEVICE_WIDENED_FIELDS)[number]>;

/** See {@link Device}'s doc — the same graft, over the reconciled `Alert` entity. */
export type Alert = Omit<
  z.infer<typeof alertResponseSchema>,
  (typeof ALERT_WIDENED_FIELDS)[number]
> &
  Pick<GeneratedAlert, (typeof ALERT_WIDENED_FIELDS)[number]>;

/**
 * The single per-entity registry pairing each override-touched entity's reconciled **schema**
 * (not just its name) with its `WIDENED_FIELDS` constant. Phase 9's completeness guard iterates
 * this to feed each `schema` straight to `enumFieldPaths(schema: z.ZodType)` — which introspects
 * `_zod.def` and needs a schema object, never a name string — so there is no entity-name→schema
 * lookup and, critically, no reverse dependency from `src/validation/schema-leniency.ts` back into
 * this registry (`enumFieldPaths` stays typed to accept a bare `z.ZodType`).
 */
export const OVERRIDE_ENTITIES = [
  {
    name: "Device",
    schema: deviceResponseSchema,
    widenedFields: DEVICE_WIDENED_FIELDS,
  },
  {
    name: "Alert",
    schema: alertResponseSchema,
    widenedFields: ALERT_WIDENED_FIELDS,
  },
] as const;
