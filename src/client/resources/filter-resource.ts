import type { Filter } from "../../generated/types/filter";
import type { GetCustomFiltersParams } from "../../generated/types/getCustomFiltersParams";
import type { GetDefaultsFiltersParams } from "../../generated/types/getDefaultsFiltersParams";

import { BaseResource } from "./base-resource";
import { filterSchema } from "./filter-schema";
import { narrow } from "./narrow";

/**
 * `client.filters` (R1, R2, design "Public surface", plan Phase 8 Step 2: "default & custom
 * filters"): the two account-wide filter catalogs, genuinely tagged `-v2-filter` in the committed
 * spec — distinct from `SiteResource.deviceFilters()` (`GET /api/v2/site/{siteUid}/filters`,
 * `-v2-site`-tagged), a *site*-scoped filter read that returns the same `Filter` entity via the
 * shared `filterSchema` (`./filter-schema.ts`) rather than a per-file duplicate.
 *
 * **No write operations exist for this namespace.** Phase 5's rate-limit table carries
 * `'filter-create'`/`'filter-delete'` `WriteOpKey` entries (flagged as a possible future gap in
 * Phase 6/7's remaining-risks notes); direct enumeration of the committed `spec/openapi.json`
 * confirms the `-v2-filter` tag declares only the two reads below — no create/delete operation
 * exists at all. Those two table entries are therefore dead (unreachable via any typed resource
 * call), not an omission of this class; they are left in place rather than removed, since deleting
 * a rate-limit table entry is Phase 5's file to own and doing so here would be scope creep for a
 * defensive, harmless no-op.
 */
export class FilterResource extends BaseResource {
  /** `GET /api/v2/filter/default-filters` — the account's default device filters, fully
   * paginated. */
  async defaults(params?: GetDefaultsFiltersParams): Promise<Filter[]> {
    const result = await this.paginate(
      "/api/v2/filter/default-filters",
      "filters",
      filterSchema,
      params,
      "GET /filter/default-filters",
    );
    return narrow<Filter[]>(result);
  }

  /** `GET /api/v2/filter/custom-filters` — the account's custom device filters (administrator
   * role), fully paginated. */
  async custom(params?: GetCustomFiltersParams): Promise<Filter[]> {
    const result = await this.paginate(
      "/api/v2/filter/custom-filters",
      "filters",
      filterSchema,
      params,
      "GET /filter/custom-filters",
    );
    return narrow<Filter[]>(result);
  }
}
