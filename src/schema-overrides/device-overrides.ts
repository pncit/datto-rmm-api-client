import { z } from "zod";

import { getByUidResponse } from "../generated/schemas/-v2-device/-v2-device.zod";

/**
 * Reconciles the generated `Device` response schema against production reality (R8, design
 * "Schema-override module"): the spec's `Udf` component only models `udf1…udf300` as 300 literal
 * optional string properties, which is both unwieldy to hand-maintain and — per the Phase-3 UDF
 * masking decorator's own finding (`withUdfMasking` deliberately redacts a UDF value "regardless
 * of wire type") — too narrow: a UDF is not guaranteed to be a string in reality. Modeling it as a
 * `udf<N>`-keyed record with a union value type (tolerating a string, number, boolean, or nested
 * object/array, in addition to `null`) means a non-string UDF validates instead of failing the
 * whole item — the exact per-item silent-data-loss class (R7) the design condemns — and it keeps
 * the schema and the masker in agreement about what a UDF may be on the wire.
 */
export const udfSchema = z.record(
  z.string().regex(/^udf\d+$/),
  z
    .union([
      z.string(),
      z.number(),
      z.boolean(),
      z.record(z.string(), z.unknown()),
      z.array(z.unknown()),
    ])
    .nullable(),
);

/**
 * The reconciled `Device` response schema: the generated `getByUidResponse` (`GET
 * /api/v2/device/{uid}`, `-v2-device.zod.ts`) with its `udf` field re-composed onto
 * {@link udfSchema}. Every other Device-shaped response (the account/site device lists walked by
 * `paginate`, the MAC/id lookups) is structurally the same `Device` entity, so this one reconciled
 * schema is reused everywhere a Device is validated — resources never validate against a tag
 * file's own (structurally identical but differently-named) duplicate.
 *
 * Deliberately **not** used for `deviceClass`/`antivirus`/`patchManagement`: those already carry
 * accurate, spec-derived enums (design "Enum coverage is otherwise good") and need no per-field
 * reconciliation here — their *compile-time* open-enum widening is grafted separately, onto the
 * exported `Device` type (`./types.ts`), from the codemod-widened generated type.
 */
export const deviceResponseSchema = getByUidResponse.extend({
  udf: udfSchema.optional().describe("User defined fields"),
});

/**
 * Every top-level `Device` field whose subtree contains an open (codemod-widened) response enum
 * at any depth — the top-level `deviceClass` and the two fields whose own nested properties carry
 * an enum (`antivirus.antivirusStatus`, `patchManagement.patchStatus`; design "25 enums… are
 * present and accurate"). Naming the *containing* top-level property (not the nested enum field
 * itself) is deliberate: `Pick<GeneratedDevice, K>` can only address a top-level key, and picking
 * a containing field re-adds its *whole* subtree — including the nested enum — from the fully
 * widened generated type. See `./types.ts`'s `Device` type, which grafts exactly these fields.
 */
export const DEVICE_WIDENED_FIELDS = [
  "deviceClass",
  "antivirus",
  "patchManagement",
] as const;
