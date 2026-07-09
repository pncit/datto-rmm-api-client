import { z } from "zod";

import {
  createAccountVariableBody,
  updateAccountVariableBody,
} from "../generated/schemas/-v2-account/-v2-account.zod";
import {
  createQuickJobBody,
  setUdfFieldsBody,
  setWarrantyDataBody,
} from "../generated/schemas/-v2-device/-v2-device.zod";
import {
  createBody as createSiteBody,
  createSiteVariableBody,
  updateProxyBody,
  updateSiteVariableBody,
} from "../generated/schemas/-v2-site/-v2-site.zod";

/**
 * Required-field marks for write-request bodies (R6, design "Schema-override module").
 *
 * The spec declares almost no `required` arrays (design "Current State": "only 4 of 113 schemas
 * declare any `required` array"), so a generated write-body schema's own `.strict()`/`.strictObject`
 * rejects an unknown key but happily accepts an **empty** body — every field being independently
 * optional says nothing about whether *some* field must be present for the write to be meaningful.
 * This module is where that genuinely-required-ness, hand-verified against the committed spec's own
 * `components.schemas` `required` arrays and each endpoint's summary/description, is added back — one
 * small, well-documented wrapper per write body, living outside `src/generated/` so it survives
 * regeneration.
 *
 * **Every body-carrying write operation named by a Phase 5 `WriteOpKey` is reconciled here**
 * (verified directly against `spec/openapi.json`): two (`site-create`, `device-job-create`) already
 * carry their genuinely-required fields from the spec's own component `required` array — the
 * generator already emits them as non-optional, so no wrapper is needed for those, and they are
 * re-exported here (unchanged) so this module remains the single place a reader checks for "what
 * does this write body actually require." The remaining seven (including `device-udf-set` above),
 * whose components declare no `required` array at all, get a hand-verified wrapper: the two
 * variable-*create* bodies require `name` (a variable cannot be meaningfully created without one —
 * spec's own field description: "Variable name"); the two variable-*update* bodies, the
 * proxy-settings body, and the warranty body require *some* field be present (the same "reject an
 * all-omitted body" judgment already applied to `device-udf-set`, since which single field is "the"
 * required one is genuinely ambiguous for an update/settings body where any subset of fields may be
 * changed).
 *
 * **Known gap, out of this module's scope to fix:** the spec also declares a body-carrying
 * `POST /api/v2/site/{siteUid}` ("Updates the site...", body `SiteRequest` — the generated
 * `updateBody`, whose `name` field is already spec-required) with **no corresponding key at all** in
 * Phase 5's `WriteOpKey` union (`src/rate-limit/rate-limits.ts`) — the inverse of that same file's
 * already-flagged `filter-create`/`filter-delete` dead entries (a real write op with no key, rather
 * than a key with no real op). `BaseResource`'s write primitives require a `WriteOpKey` argument, so
 * a `SiteResource.update()` method (Phase 7) cannot be implemented until Phase 5's table gains a key
 * for it (e.g. `'site-update'`) — this module cannot add one on its own without editing that
 * untouched Phase 5 file, which is out of scope here.
 */

/**
 * `PUT /api/v2/site`'s body (`site-create`): the spec's own `CreateSiteRequest` component declares
 * `required: ["name"]`, and the generator already emits `name` as non-optional (`createBody`) — no
 * additional wrapper is needed. Re-exported here (unchanged) so every write body's required-ness is
 * checkable from this one module.
 */
export const siteCreateBodySchema = createSiteBody;

/**
 * `PUT /api/v2/device/{deviceUid}/quickjob`'s body (`device-job-create`): the spec's own
 * `CreateQuickJobRequest` component declares `required: ["jobComponent", "jobName"]`, and the
 * generator already emits both as non-optional (`createQuickJobBody`) — no additional wrapper is
 * needed. Re-exported here (unchanged) for the same discoverability reason as {@link siteCreateBodySchema}.
 */
export const deviceJobCreateBodySchema = createQuickJobBody;

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

/**
 * `POST /api/v2/device/{deviceUid}/warranty`'s body (`device-warranty-set`): the generated
 * `setWarrantyDataBody` types `warrantyDate` as `z.string().optional()`, but the endpoint's own doc
 * says "The warranty date can also be set to null" — an omittable, non-nullable field would make
 * `{ warrantyDate: null }` (the documented way to clear a warranty date) fail `validateRequest`.
 * This override `.extend`s the generated body, overriding `warrantyDate` to be **required but
 * nullable**: the field itself must be present (an empty `{}` body is a meaningless no-op write,
 * the same judgment as every other body here), and its value may be a date string or `null`
 * (clearing), matching the endpoint doc exactly. Deriving from `setWarrantyDataBody` (rather than
 * rebuilding it) keeps this schema tied to the generated one, so a regeneration that renames or
 * extends the warranty body is caught here instead of silently diverging.
 */
export const warrantyWriteBodySchema = setWarrantyDataBody.extend({
  warrantyDate: z.string().nullable(),
});

/** The validated input shape {@link warrantyWriteBodySchema} accepts. */
export type DeviceWarrantyInput = z.infer<typeof warrantyWriteBodySchema>;

/**
 * `PUT /api/v2/site/{siteUid}/variable`'s body (`site-variable-set`'s create half): the spec's
 * `Variable Creation Request` component declares no `required` array, but a variable without a
 * `name` has nothing to reference by — the field's own description ("Variable name") makes it the
 * one genuinely load-bearing field for a *create*. `value`/`masked` stay optional (a variable may
 * legitimately be created with an empty value and set later).
 */
export const createSiteVariableWriteBodySchema = createSiteVariableBody.extend({
  name: z.string(),
});

/** The validated input shape {@link createSiteVariableWriteBodySchema} accepts. */
export type SiteVariableCreateInput = z.infer<
  typeof createSiteVariableWriteBodySchema
>;

/**
 * `POST /api/v2/site/{siteUid}/variable/{variableId}`'s body (`site-variable-set`'s update half):
 * the spec's `Variable Update Request` component declares no `required` array, and — unlike the
 * create body — there is no single obviously-load-bearing field: a caller may legitimately update
 * only `value` while leaving `name` unchanged, or vice versa. Rather than guess which one field is
 * "the" required one (the exact risk this module's scoping note warns against), this applies the
 * same "reject an all-omitted body" judgment as {@link udfWriteBodySchema}: an update with *no*
 * fields at all is a meaningless no-op write.
 */
export const updateSiteVariableWriteBodySchema = updateSiteVariableBody.refine(
  (body) => Object.values(body).some((value) => value !== undefined),
  { message: "at least one field must be provided" },
);

/**
 * `PUT /api/v2/account/variable`'s body (`account-variable-set`'s create half): identical shape and
 * rationale to {@link createSiteVariableWriteBodySchema} (the spec's `Variable Creation Request`
 * component is reused verbatim for both the site- and account-scoped create operations).
 */
export const createAccountVariableWriteBodySchema =
  createAccountVariableBody.extend({ name: z.string() });

/** The validated input shape {@link createAccountVariableWriteBodySchema} accepts. */
export type AccountVariableCreateInput = z.infer<
  typeof createAccountVariableWriteBodySchema
>;

/**
 * `POST /api/v2/account/variable/{variableId}`'s body (`account-variable-set`'s update half):
 * identical shape and rationale to {@link updateSiteVariableWriteBodySchema}.
 */
export const updateAccountVariableWriteBodySchema =
  updateAccountVariableBody.refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    { message: "at least one field must be provided" },
  );

/**
 * `POST /api/v2/site/{siteUid}/settings/proxy`'s body (`device-proxy-set` in the Phase 5 rate-limit
 * table): the spec's `ProxySettings` component declares no `required` array, and no endpoint doc
 * detail states which of `host`/`port`/`type`/`username`/`password` must co-occur (e.g. whether a
 * `socks4` proxy requires credentials). Guessing a specific required subset here risks getting it
 * wrong with no test to catch it (the exact hazard this module's scoping note names) — so, as with
 * the two update bodies above, this only rejects the unambiguous no-op case: a completely empty
 * body sets nothing and would still consume a write slot for it.
 */
export const updateProxyWriteBodySchema = updateProxyBody.refine(
  (body) => Object.values(body).some((value) => value !== undefined),
  { message: "at least one field must be provided" },
);

/** The validated input shape {@link updateProxyWriteBodySchema} accepts. */
export type SiteProxyInput = z.infer<typeof updateProxyBody>;
