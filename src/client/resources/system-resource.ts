import {
  getPaginationConfigurationsResponse,
  getResponse as getRequestRateResponse,
  getStatusResponse,
} from "../../generated/schemas/-v2-system/-v2-system.zod";
import type { PaginationConfiguration } from "../../generated/types/paginationConfiguration";
import type { RateStatusResponse } from "../../generated/types/rateStatusResponse";
import type { StatusResponse } from "../../generated/types/statusResponse";

import { BaseResource } from "./base-resource";
import { narrow } from "./narrow";

/**
 * `client.system` (R1, R2, R11, design "Public surface", plan Phase 8 Step 5: "requestRate()
 * (GET /api/v2/system/request_rate) and other system reads. Exposed for consumers to reconcile
 * against the live budget; the client does not call it at init."): system-wide reads, genuinely
 * tagged `-v2-system` in the committed spec. Singular namespace per the design's naming rule
 * (`account`/`system` are the genuine singletons; `audit` is the third singular exception,
 * documented on `AuditResource`).
 */
export class SystemResource extends BaseResource {
  /** `GET /api/v2/system/status` — the system's status (version, status, start date). Per the
   * spec's own operation doc, "An API access token is not necessary" for this one read — this
   * client always sends one anyway (the shared axios instance has no unauthenticated mode), which
   * Datto's server tolerates since the doc only says a token isn't *required*, not that one is
   * rejected. */
  async status(): Promise<StatusResponse> {
    const result = await this.httpGet(
      "/api/v2/system/status",
      getStatusResponse,
      "GET /system/status",
    );
    return narrow<StatusResponse>(result);
  }

  /** `GET /api/v2/system/request_rate` (design "Dual-layer rate limiter"): the authenticated
   * account's real server-side rate-limit budget, letting a consumer reconcile against it — the
   * client's own local limiter is seeded from the committed static table (`src/rate-limit/
   * rate-limits.ts`) and never calls this at init. Pinned name, matching the design's
   * public-surface example (`const rate = await client.system.requestRate();`). */
  async requestRate(): Promise<RateStatusResponse> {
    const result = await this.httpGet(
      "/api/v2/system/request_rate",
      getRequestRateResponse,
      "GET /system/request_rate",
    );
    return narrow<RateStatusResponse>(result);
  }

  /** `GET /api/v2/system/pagination` — the account's pagination configuration (the default/max
   * page size every other paginated read is subject to). */
  async paginationConfiguration(): Promise<PaginationConfiguration> {
    const result = await this.httpGet(
      "/api/v2/system/pagination",
      getPaginationConfigurationsResponse,
      "GET /system/pagination",
    );
    return narrow<PaginationConfiguration>(result);
  }
}
