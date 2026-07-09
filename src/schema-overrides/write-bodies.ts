import { z } from "zod";

import { setUdfFieldsBody } from "../generated/schemas/-v2-device/-v2-device.zod";

/**
 * Required-field marks for write-request bodies (R6, design "Schema-override module").
 *
 * The spec declares almost no `required` arrays (design "Current State": "only 4 of 113 schemas
 * declare any `required` array"), so a generated write-body schema's own `.strict()`/`.strictObject`
 * rejects an unknown key but happily accepts an **empty** body — every field being independently
 * optional says nothing about whether *some* field must be present for the write to be meaningful.
 * This module is where that genuinely-required-ness, hand-verified against the endpoint docs, is
 * added back — one small, well-documented wrapper per write body, living outside
 * `src/generated/` so it survives regeneration.
 *
 * Scope note: only the `device-udf-set` write body is reconciled here in this phase (Phase 6
 * builds the module and its pattern; it is also the one write body this phase's own tests and
 * Phase 7's `DeviceResource.setUdf` example depend on by name). The remaining write-set bodies
 * (`device-job-create`, `device-warranty-set`, `site-create`, `site-variable-set`,
 * `account-variable-set`, `device-proxy-set`, …) are reconciled here, in this same module, as each
 * one's owning resource is implemented (Phase 7/8) — see the Phase 6 implementation notes'
 * "Ambiguities & Decisions" for why that scoping was chosen over speculatively wrapping every
 * write body now, with no resource yet calling most of them.
 */

/**
 * `POST /api/v2/device/{uid}/udf`'s body (`device-udf-set`): the generated `setUdfFieldsBody` (300
 * independently optional `udf<N>` string fields — spec's own endpoint doc: "Any user defined field
 * supplied with an empty value will be set to null. All user defined fields not supplied will
 * retain their current values.") accepts `{}` as a no-op write that would still consume a write
 * slot for nothing. `.refine` rejects a body with every field `undefined`, requiring at least one
 * UDF to actually be set.
 */
export const udfWriteBodySchema = setUdfFieldsBody.refine(
  (body) => Object.values(body).some((value) => value !== undefined),
  { message: "at least one udf field must be provided" },
);

/** The validated input shape {@link udfWriteBodySchema} accepts. */
export type DeviceUdfInput = z.infer<typeof setUdfFieldsBody>;
