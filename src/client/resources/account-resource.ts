import { z } from "zod";

import { getUserAccountResponse } from "../../generated/schemas/-v2-account/-v2-account.zod";
import type { Account } from "../../generated/types/account";
import type { Component } from "../../generated/types/component";
import type { DnetSiteMappingsDto } from "../../generated/types/dnetSiteMappingsDto";
import type { GetAccountVariablesParams } from "../../generated/types/getAccountVariablesParams";
import type { GetComponentsParams } from "../../generated/types/getComponentsParams";
import type { GetDnetSiteMappingsParams } from "../../generated/types/getDnetSiteMappingsParams";
import type { GetUserAccountDevicesParams } from "../../generated/types/getUserAccountDevicesParams";
import type { Variable } from "../../generated/types/variable";
import {
  type AccountVariableCreateInput,
  type AccountVariableUpdateInput,
  createAccountVariableWriteBodySchema,
  deviceSchema,
  updateAccountVariableWriteBodySchema,
} from "../../schema-overrides";
import type { Device } from "../../schema-overrides";

import { BaseResource } from "./base-resource";
import { narrow } from "./narrow";
import { variableSchema } from "./variable-schema";
import { voidResponseSchema } from "./void-response";

/** `GET /api/v2/account/components`'s item schema (`Component`, with its nested
 * `ComponentVariable[]`). No UDF/alertContext/enum defect to reconcile — a plain mirror of the
 * generated shape, scoped to this resource file since (unlike `Variable`) no other Phase 7
 * resource shares it. */
export const componentSchema = z.object({
  id: z.number().optional(),
  credentialsRequired: z.boolean().optional(),
  uid: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  categoryCode: z.string().optional(),
  variables: z
    .array(
      z.object({
        name: z.string().optional(),
        defaultVal: z.string().optional(),
        type: z.string().optional(),
        direction: z.boolean().optional(),
        description: z.string().optional(),
        variablesIdx: z.number().optional(),
      }),
    )
    .optional(),
});

/** `GET /api/v2/account/dnet-site-mappings`'s item schema (`DnetSiteMappingsDto`). Scoped to
 * this resource file — not shared elsewhere in this phase. */
export const dnetSiteMappingSchema = z.object({
  id: z.number().optional(),
  uid: z.string().optional(),
  accountUid: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  dattoNetworkingNetworkIds: z.array(z.number()).optional(),
  portalUrl: z.string().optional(),
});

/**
 * `client.account` (R1, R2, design "Public surface"): the authenticated user's account —
 * self, the account-wide device listing (the retired `getAccountDevices`' pinned replacement,
 * `client.account.devices()` — design Decision 5), account-scoped variables, components, and
 * dnet site mappings.
 *
 * **Deliberately excludes** three account-tag (`-v2-account.zod.ts`) operations, each rehomed to
 * the namespace that matches its concept over its raw path prefix (mirroring the design's own
 * `client.alerts.openForSite(siteUid)` example, which rehomes a site-tag alert read into
 * `AlertResource`):
 * - `getSites` → `SiteResource.list()` (Phase 7 Step 2; the plan's own "site list/get" phrasing
 *   pins the site collection to the `sites` namespace, matching the design's plural-namespace
 *   naming rule — there is no historical-parity constraint pulling it toward `account`, unlike
 *   `devices()`, whose exact `client.account.devices()` shape design Decision 5 pins by name).
 * - `getUserAccountOpenAlerts` / `getUserAccountClosedAlerts` → `AlertResource.open()` /
 *   `AlertResource.resolved()` (Phase 7 Step 4) — every alert read, regardless of which resource
 *   scopes it, lives under `alerts` per the design's explicit `openForSite` precedent.
 * - `getUsers` → deferred to Phase 8's `UserResource` ("user reads", design's plural `users`
 *   namespace) rather than implemented here, since its natural conceptual home is the resource
 *   named for the entity it returns, not the tag Datto's spec happens to group it under.
 */
export class AccountResource extends BaseResource {
  /** `GET /api/v2/account` — the authenticated user's account data. */
  async get(): Promise<Account> {
    const result = await this.httpGet(
      "/api/v2/account",
      getUserAccountResponse,
      "GET /account",
    );
    return narrow<Account>(result);
  }

  /**
   * `GET /api/v2/account/devices` — the account-wide device listing, fully paginated. Pinned
   * replacement for the retired `getAccountDevices` (design Decision 5,
   * `client.account.devices()`).
   */
  async devices(params?: GetUserAccountDevicesParams): Promise<Device[]> {
    const result = await this.paginate(
      "/api/v2/account/devices",
      "devices",
      deviceSchema,
      params,
      "GET /account/devices",
    );
    return narrow<Device[]>(result);
  }

  /** `GET /api/v2/account/variables` — account-scoped variables, fully paginated. */
  async variables(params?: GetAccountVariablesParams): Promise<Variable[]> {
    const result = await this.paginate(
      "/api/v2/account/variables",
      "variables",
      variableSchema,
      params,
      "GET /account/variables",
    );
    return narrow<Variable[]>(result);
  }

  /** `PUT /api/v2/account/variable` (`account-variable-set`): creates an account variable. */
  async createVariable(body: AccountVariableCreateInput): Promise<void> {
    await this.httpPut(
      "/api/v2/account/variable",
      body,
      createAccountVariableWriteBodySchema,
      voidResponseSchema,
      "PUT /account/variable",
      "account-variable-set",
    );
  }

  /**
   * `POST /api/v2/account/variable/{variableId}` (`account-variable-set`): updates the account
   * variable identified by `variableId`.
   */
  async updateVariable(
    variableId: number,
    body: AccountVariableUpdateInput,
  ): Promise<void> {
    await this.httpPost(
      `/api/v2/account/variable/${variableId}`,
      body,
      updateAccountVariableWriteBodySchema,
      voidResponseSchema,
      "POST /account/variable/{variableId}",
      "account-variable-set",
    );
  }

  /**
   * `DELETE /api/v2/account/variable/{variableId}`: deletes the account variable identified by
   * `variableId`. No dedicated `WriteOpKey` exists for a variable *delete* (Phase 5's table only
   * names the create/update-covering `account-variable-set`, flagged in Phase 6's remaining-risks
   * as a decision left to Phase 7/8); this reuses `account-variable-set`, consistent with the
   * design's own "variable mutations" grouping language (design "Dual-layer rate limiter") — a
   * delete is one more mutation of the same rate-limited operation family, not a distinct one.
   */
  deleteVariable(variableId: number): Promise<void> {
    return this.httpDelete(
      `/api/v2/account/variable/${variableId}`,
      "account-variable-set",
    );
  }

  /** `GET /api/v2/account/components` — the account's components, fully paginated. */
  async components(params?: GetComponentsParams): Promise<Component[]> {
    const result = await this.paginate(
      "/api/v2/account/components",
      "components",
      componentSchema,
      params,
      "GET /account/components",
    );
    return narrow<Component[]>(result);
  }

  /**
   * `GET /api/v2/account/dnet-site-mappings` — the account's sites mapped to their Datto
   * Networking network ids, fully paginated.
   */
  async dnetSiteMappings(
    params?: GetDnetSiteMappingsParams,
  ): Promise<DnetSiteMappingsDto[]> {
    const result = await this.paginate(
      "/api/v2/account/dnet-site-mappings",
      "dnetSiteMappings",
      dnetSiteMappingSchema,
      params,
      "GET /account/dnet-site-mappings",
    );
    return narrow<DnetSiteMappingsDto[]>(result);
  }
}
