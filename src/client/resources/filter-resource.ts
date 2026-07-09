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
 * **No write operations exist for this namespace.** Direct enumeration of the committed
 * `spec/openapi.json` confirms the `-v2-filter` tag declares only the two reads below — no
 * create/delete operation exists at all, so no `WriteOpKey` entries exist for it either.
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
