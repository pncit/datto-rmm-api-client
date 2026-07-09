import { z } from "zod";

/**
 * The "Filter" item schema shared by every collection this client validates that walks a
 * `{ pageDetails, filters }` envelope (`SiteResource.deviceFilters()`, `FilterResource.defaults()`/
 * `custom()`).
 *
 * Extracted from `site-resource.ts` (where it was originally scoped, Phase 7) once Phase 8's
 * `FilterResource` needed the identical `Filter` shape for the two account-wide filter catalogs
 * (`GET /api/v2/filter/default-filters`, `GET /api/v2/filter/custom-filters`) — the same
 * "tag file's own duplicate" hazard `device-overrides.ts` documents for `Device` and
 * `variable-schema.ts` documents for `Variable`: Orval inlines the identical filter-item shape
 * independently inside `getSiteDeviceFiltersResponse`, `getDefaultsFiltersResponse`, and
 * `getCustomFiltersResponse` (three separately-generated schema objects, no shared identity), so
 * hand-writing this once and importing it from both `SiteResource` and `FilterResource` avoids
 * validating against three independent duplicates of the same entity.
 *
 * `type` is a real spec enum (`FilterType`); no override is needed for it to widen at runtime —
 * `parseLenient`'s enum degradation (Phase 4) applies to every enum node this client validates,
 * independent of whether the entity is otherwise reconciled in `schema-overrides/`. (The
 * compile-time asymmetry this creates — `Filter["type"]` is codemod-widened to
 * `FilterType | (string & {})` in the generated type, while this hand-written schema's
 * `z.enum([...])` is authored closed — is why `tests/generated/schema-mirror-pin.ts` pins this
 * schema against `Filter` by key-set equality only, not full structural equality.)
 *
 * @internal Exported only so `tests/generated/schema-mirror-pin.ts` can pin it against `Filter` —
 * not resource API. The `src/index.ts` barrel must never `export *` from this module.
 */
export const filterSchema = z.object({
  id: z.number().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  type: z.enum(["rmm_default", "custom", "site"]).optional(),
  dateCreate: z.iso.datetime().optional(),
  lastUpdated: z.iso.datetime().optional(),
});
