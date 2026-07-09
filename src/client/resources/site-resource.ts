import { z } from "zod";

import {
  getSiteResponse,
  getSiteSettingsResponse,
  updateProxyResponse,
} from "../../generated/schemas/-v2-site/-v2-site.zod";
import type { CreateSiteRequest } from "../../generated/types/createSiteRequest";
import type { DeviceNetworkInterface } from "../../generated/types/deviceNetworkInterface";
import type { Filter } from "../../generated/types/filter";
import type { GetSiteDeviceFiltersParams } from "../../generated/types/getSiteDeviceFiltersParams";
import type { GetSiteDevicesParams } from "../../generated/types/getSiteDevicesParams";
import type { GetSiteDevicesWithNetworkInterfaceParams } from "../../generated/types/getSiteDevicesWithNetworkInterfaceParams";
import type { GetSiteVariablesParams } from "../../generated/types/getSiteVariablesParams";
import type { GetSitesParams } from "../../generated/types/getSitesParams";
import type { Site } from "../../generated/types/site";
import type { SiteRequest } from "../../generated/types/siteRequest";
import type { SiteSettings } from "../../generated/types/siteSettings";
import type { Variable } from "../../generated/types/variable";
import {
  deviceSchema,
  type SiteProxyInput,
  type SiteVariableCreateInput,
  type SiteVariableUpdateInput,
  createSiteVariableWriteBodySchema,
  siteCreateBodySchema,
  siteUpdateBodySchema,
  updateProxyWriteBodySchema,
  updateSiteVariableWriteBodySchema,
} from "../../schema-overrides";
import type { Device } from "../../schema-overrides";

import { BaseResource } from "./base-resource";
import { filterSchema } from "./filter-schema";
import { narrow } from "./narrow";
import { variableSchema } from "./variable-schema";
import { voidResponseSchema } from "./void-response";

/**
 * `GET /api/v2/site/{siteUid}/devices/network-interface`'s item schema (`DeviceNetworkInterface`
 * — a *smaller*, distinct shape from the full `Device` entity `paginate` reuses for
 * `devices()`/`account.devices()`: it carries a network-interface list, not UDFs/audit/patch
 * data). No UDF/alertContext/enum defect of its own to reconcile — a plain mirror of the
 * generated shape, scoped to this resource file since nothing else in this phase shares it.
 *
 * Exported only so `tests/generated/schema-mirror-pin.ts` can pin it against
 * `DeviceNetworkInterface` — not resource API. Phase 8's `src/index.ts` barrel must export only
 * the `*Resource` classes and `DattoRmmClient`, never `export *` from this module, so this stays
 * out of the published surface.
 *
 * @internal
 */
export const deviceNetworkInterfaceSchema = z.object({
  id: z.number().optional(),
  uid: z.string().optional(),
  siteId: z.number().optional(),
  siteUid: z.string().optional(),
  siteName: z.string().optional(),
  deviceType: z
    .object({ category: z.string().optional(), type: z.string().optional() })
    .optional(),
  hostname: z.string().optional(),
  intIpAddress: z.string().optional(),
  extIpAddress: z.string().optional(),
  nics: z
    .array(
      z.object({
        instance: z.string().optional(),
        ipv4: z.string().optional(),
        ipv6: z.string().optional(),
        macAddress: z.string().optional(),
        type: z.string().optional(),
      }),
    )
    .optional(),
});

/**
 * `client.sites` (R1, R2, design "Public surface", plan Phase 7 Step 2 "site list/get, site
 * devices, site variables"): the site collection and every site-scoped read/write except
 * alerts, which — per the design's explicit `client.alerts.openForSite(siteUid)` example — live
 * under `AlertResource` regardless of which resource scopes the read (`getSiteOpenAlerts` /
 * `getSiteResolvedAlerts` are therefore *not* implemented here).
 *
 * **`list()` houses the account-wide site collection** (`GET /api/v2/account/sites`,
 * Datto's own `-v2-account.zod.ts` tag) rather than `AccountResource` — the plan's own "site
 * list/get" phrasing pins the collection to this namespace (see `account-resource.ts`'s doc for
 * why this differs from `account.devices()`, which design Decision 5 pins by name instead).
 *
 * **`deleteVariable()`/`deleteProxy()` reuse an existing `WriteOpKey`** (`site-variable-set` /
 * `device-proxy-set` respectively) rather than a dedicated delete-specific key — Phase 6's
 * remaining-risks section explicitly left this decision to Phase 7/8, "consistent with the
 * design's own 'variable mutations'/'proxy... mutations' grouping language." A delete is one
 * more mutation of the same rate-limited operation family as its create/update counterpart, not
 * a distinct one warranting its own bucket.
 */
export class SiteResource extends BaseResource {
  /** `GET /api/v2/account/sites` — every site in the account, fully paginated. */
  async list(params?: GetSitesParams): Promise<Site[]> {
    const result = await this.paginate(
      "/api/v2/account/sites",
      "sites",
      getSiteResponse,
      params,
      "GET /account/sites",
    );
    return narrow<Site[]>(result);
  }

  /** `GET /api/v2/site/{siteUid}` — data for one site, including its device counts. */
  async get(siteUid: string): Promise<Site> {
    const result = await this.httpGet(
      `/api/v2/site/${siteUid}`,
      getSiteResponse,
      "GET /site/{siteUid}",
    );
    return narrow<Site>(result);
  }

  /** `PUT /api/v2/site` (`site-create`): creates a new site in the account. */
  async create(body: CreateSiteRequest): Promise<Site> {
    const result = await this.httpPut(
      "/api/v2/site",
      body,
      siteCreateBodySchema,
      getSiteResponse,
      "PUT /site",
      "site-create",
    );
    return narrow<Site>(result);
  }

  /** `POST /api/v2/site/{siteUid}` (`site-update`): updates the site identified by `siteUid`. The
   * response is the same `Site` shape `get()`/`create()` validate — reused directly rather than
   * hand-mirrored (`updateResponse`/`getSiteResponse` are the identical generated shape). */
  async update(siteUid: string, body: SiteRequest): Promise<Site> {
    const result = await this.httpPost(
      `/api/v2/site/${siteUid}`,
      body,
      siteUpdateBodySchema,
      getSiteResponse,
      "POST /site/{siteUid}",
      "site-update",
    );
    return narrow<Site>(result);
  }

  /** `GET /api/v2/site/{siteUid}/devices` — the site's devices, fully paginated. Reuses the
   * reconciled `deviceSchema` (design "Schema-override module": "Every other Device-shaped
   * response … is structurally the same Device entity, so this one reconciled schema is reused
   * everywhere a Device is validated"). */
  async devices(
    siteUid: string,
    params?: GetSiteDevicesParams,
  ): Promise<Device[]> {
    const result = await this.paginate(
      `/api/v2/site/${siteUid}/devices`,
      "devices",
      deviceSchema,
      params,
      "GET /site/{siteUid}/devices",
    );
    return narrow<Device[]>(result);
  }

  /** `GET /api/v2/site/{siteUid}/devices/network-interface` — the site's devices' network
   * interface data, fully paginated (a smaller shape than the full `Device` entity — see
   * {@link deviceNetworkInterfaceSchema}'s doc). */
  async devicesWithNetworkInterface(
    siteUid: string,
    params?: GetSiteDevicesWithNetworkInterfaceParams,
  ): Promise<DeviceNetworkInterface[]> {
    const result = await this.paginate(
      `/api/v2/site/${siteUid}/devices/network-interface`,
      "devices",
      deviceNetworkInterfaceSchema,
      params,
      "GET /site/{siteUid}/devices/network-interface",
    );
    return narrow<DeviceNetworkInterface[]>(result);
  }

  /** `GET /api/v2/site/{siteUid}/variables` — the site's variables, fully paginated. */
  async variables(
    siteUid: string,
    params?: GetSiteVariablesParams,
  ): Promise<Variable[]> {
    const result = await this.paginate(
      `/api/v2/site/${siteUid}/variables`,
      "variables",
      variableSchema,
      params,
      "GET /site/{siteUid}/variables",
    );
    return narrow<Variable[]>(result);
  }

  /** `PUT /api/v2/site/{siteUid}/variable` (`site-variable-set`): creates a site variable. */
  async createVariable(
    siteUid: string,
    body: SiteVariableCreateInput,
  ): Promise<void> {
    await this.httpPut(
      `/api/v2/site/${siteUid}/variable`,
      body,
      createSiteVariableWriteBodySchema,
      voidResponseSchema,
      "PUT /site/{siteUid}/variable",
      "site-variable-set",
    );
  }

  /** `POST /api/v2/site/{siteUid}/variable/{variableId}` (`site-variable-set`): updates the site
   * variable identified by `variableId`. */
  async updateVariable(
    siteUid: string,
    variableId: number,
    body: SiteVariableUpdateInput,
  ): Promise<void> {
    await this.httpPost(
      `/api/v2/site/${siteUid}/variable/${variableId}`,
      body,
      updateSiteVariableWriteBodySchema,
      voidResponseSchema,
      "POST /site/{siteUid}/variable/{variableId}",
      "site-variable-set",
    );
  }

  /** `DELETE /api/v2/site/{siteUid}/variable/{variableId}`: deletes the site variable identified
   * by `variableId`. Reuses `site-variable-set` — see this class's doc. */
  deleteVariable(siteUid: string, variableId: number): Promise<void> {
    return this.httpDelete(
      `/api/v2/site/${siteUid}/variable/${variableId}`,
      "site-variable-set",
    );
  }

  /** `GET /api/v2/site/{siteUid}/settings` — the site's settings (general/proxy/mail-recipient
   * configuration). */
  async settings(siteUid: string): Promise<SiteSettings> {
    const result = await this.httpGet(
      `/api/v2/site/${siteUid}/settings`,
      getSiteSettingsResponse,
      "GET /site/{siteUid}/settings",
    );
    return narrow<SiteSettings>(result);
  }

  /** `GET /api/v2/site/{siteUid}/filters` — the site's device filters, fully paginated. */
  async deviceFilters(
    siteUid: string,
    params?: GetSiteDeviceFiltersParams,
  ): Promise<Filter[]> {
    const result = await this.paginate(
      `/api/v2/site/${siteUid}/filters`,
      "filters",
      filterSchema,
      params,
      "GET /site/{siteUid}/filters",
    );
    return narrow<Filter[]>(result);
  }

  /** `POST /api/v2/site/{siteUid}/settings/proxy` (`device-proxy-set` — the opKey name Phase 5
   * pinned from `system/request_rate`'s `operationWriteStatus`, even though this operation is
   * site-scoped, not device-scoped; a documented naming quirk this phase does not rename): creates
   * or updates the site's proxy settings. */
  async updateProxy(
    siteUid: string,
    body: SiteProxyInput,
  ): Promise<SiteSettings> {
    const result = await this.httpPost(
      `/api/v2/site/${siteUid}/settings/proxy`,
      body,
      updateProxyWriteBodySchema,
      updateProxyResponse,
      "POST /site/{siteUid}/settings/proxy",
      "device-proxy-set",
    );
    return narrow<SiteSettings>(result);
  }

  /** `DELETE /api/v2/site/{siteUid}/settings/proxy` (`device-proxy-set` — see
   * {@link updateProxy}'s doc; reused for the delete counterpart per this class's doc): deletes
   * the site's proxy settings. */
  deleteProxy(siteUid: string): Promise<void> {
    return this.httpDelete(
      `/api/v2/site/${siteUid}/settings/proxy`,
      "device-proxy-set",
    );
  }
}
