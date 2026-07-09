/**
 * Hand-maintained schema-override module (R8, design "Schema-override module").
 *
 * Reconciles the **generated** zod schemas (`src/generated/schemas/**`) against production
 * reality — not to be confused with `scripts/patch-spec.mjs` (Phase 2), which corrects the spec
 * *before* generation. This module operates on the already-generated schemas *after* generation.
 * It lives outside `src/generated/`, imports generated schemas, and exports the reconciled forms
 * resources (Phase 7/8) use.
 */
export {
  alertContextSchema,
  alertResponseSchema,
  ALERT_WIDENED_FIELDS,
} from "./alert-overrides";
export {
  deviceResponseSchema,
  udfSchema,
  UDF_KEY_PATTERN,
  DEVICE_WIDENED_FIELDS,
} from "./device-overrides";
export { pageDetailsSchema, type PageDetails } from "./pagination";
export type { Alert, Device } from "./types";
export { alertSchema, deviceSchema, OVERRIDE_ENTITIES } from "./types";
export {
  udfWriteBodySchema,
  type DeviceUdfInput,
  warrantyWriteBodySchema,
  type DeviceWarrantyInput,
  siteCreateBodySchema,
  siteUpdateBodySchema,
  deviceJobCreateBodySchema,
  createSiteVariableWriteBodySchema,
  type SiteVariableCreateInput,
  updateSiteVariableWriteBodySchema,
  type SiteVariableUpdateInput,
  createAccountVariableWriteBodySchema,
  type AccountVariableCreateInput,
  updateAccountVariableWriteBodySchema,
  type AccountVariableUpdateInput,
  updateProxyWriteBodySchema,
  type SiteProxyInput,
} from "./write-bodies";
