import type { GetDeviceOpenAlertsParams } from "../../generated/types/getDeviceOpenAlertsParams";
import type { GetDeviceResolvedAlertsParams } from "../../generated/types/getDeviceResolvedAlertsParams";
import type { GetSiteOpenAlertsParams } from "../../generated/types/getSiteOpenAlertsParams";
import type { GetSiteResolvedAlertsParams } from "../../generated/types/getSiteResolvedAlertsParams";
import type { GetUserAccountClosedAlertsParams } from "../../generated/types/getUserAccountClosedAlertsParams";
import type { GetUserAccountOpenAlertsParams } from "../../generated/types/getUserAccountOpenAlertsParams";
import { alertSchema } from "../../schema-overrides";
import type { Alert } from "../../schema-overrides";

import { BaseResource } from "./base-resource";
import { narrow } from "./narrow";
import { voidResponseSchema } from "./void-response";

/**
 * `client.alerts` (R1, R2, design "Public surface"): every alert read and write, regardless of
 * which resource scope (`account`/`site`/`device`) the underlying spec path/tag groups it under.
 *
 * This is a deliberate concept-over-path grouping, not a literal port of Datto's own tag
 * structure — the design's public surface names it explicitly (`const alerts = await
 * client.alerts.openForSite(siteUid);`), rehoming `getSiteOpenAlerts`/`getSiteResolvedAlerts`
 * (tagged `-v2-site` in the committed spec) and their account-/device-scoped counterparts
 * (tagged `-v2-account`/`-v2-device`) all under this one namespace rather than splitting alert
 * reads across `account`/`sites`/`devices`. `get`/`resolve`/`mute`/`unmute` are the only
 * operations genuinely tagged `-v2-alert`; the six paginated reads below (`open`/`resolved` ×
 * account/site/device) are gathered here from three other tag files by the same design intent.
 *
 * `mute`/`unmute` are implemented even though the spec marks both `deprecated` ("Alerts can no
 * longer be muted/un-muted, as of the 8.9.0 release") — R1 requires covering the entire
 * documented v2 surface, deprecated or not; the plan's own Phase 7 Step 4 text ("resolve(uid)
 * (alert-resolve), muting") names both explicitly.
 */
export class AlertResource extends BaseResource {
  /** `GET /api/v2/alert/{uid}` — data for one alert. */
  async get(uid: string): Promise<Alert> {
    const result = await this.httpGet(
      `/api/v2/alert/${uid}`,
      alertSchema,
      "GET /alert/{uid}",
    );
    return narrow<Alert>(result);
  }

  /** `POST /api/v2/alert/{uid}/resolve` (`alert-resolve`): resolves the alert. Pinned replacement
   * shape design's public surface names (`client.alerts.resolve(alertUid)`). */
  async resolve(uid: string): Promise<void> {
    await this.httpPost(
      `/api/v2/alert/${uid}/resolve`,
      voidResponseSchema,
      "POST /alert/{uid}/resolve",
      "alert-resolve",
    );
  }

  /** `POST /api/v2/alert/{uid}/mute` (`alert-mute`). @deprecated Per the spec: "Alerts can no
   * longer be muted, as of the 8.9.0 release." Still implemented — R1 covers the full documented
   * surface regardless of deprecation. */
  async mute(uid: string): Promise<void> {
    await this.httpPost(
      `/api/v2/alert/${uid}/mute`,
      voidResponseSchema,
      "POST /alert/{uid}/mute",
      "alert-mute",
    );
  }

  /** `POST /api/v2/alert/{uid}/unmute` (`alert-unmute`). @deprecated Per the spec: "Alerts can no
   * longer be un-muted, as of the 8.9.0 release." Still implemented — see {@link mute}'s doc. */
  async unmute(uid: string): Promise<void> {
    await this.httpPost(
      `/api/v2/alert/${uid}/unmute`,
      voidResponseSchema,
      "POST /alert/{uid}/unmute",
      "alert-unmute",
    );
  }

  /** `GET /api/v2/account/alerts/open` — every open alert in the account, fully paginated. */
  async open(params?: GetUserAccountOpenAlertsParams): Promise<Alert[]> {
    const result = await this.paginate(
      "/api/v2/account/alerts/open",
      "alerts",
      alertSchema,
      params,
      "GET /account/alerts/open",
    );
    return narrow<Alert[]>(result);
  }

  /** `GET /api/v2/account/alerts/resolved` — every resolved alert in the account, fully
   * paginated. */
  async resolved(params?: GetUserAccountClosedAlertsParams): Promise<Alert[]> {
    const result = await this.paginate(
      "/api/v2/account/alerts/resolved",
      "alerts",
      alertSchema,
      params,
      "GET /account/alerts/resolved",
    );
    return narrow<Alert[]>(result);
  }

  /** `GET /api/v2/site/{siteUid}/alerts/open` — every open alert for the given site, fully
   * paginated. Matches design's public-surface example exactly. */
  async openForSite(
    siteUid: string,
    params?: GetSiteOpenAlertsParams,
  ): Promise<Alert[]> {
    const result = await this.paginate(
      `/api/v2/site/${siteUid}/alerts/open`,
      "alerts",
      alertSchema,
      params,
      "GET /site/{siteUid}/alerts/open",
    );
    return narrow<Alert[]>(result);
  }

  /** `GET /api/v2/site/{siteUid}/alerts/resolved` — every resolved alert for the given site,
   * fully paginated. */
  async resolvedForSite(
    siteUid: string,
    params?: GetSiteResolvedAlertsParams,
  ): Promise<Alert[]> {
    const result = await this.paginate(
      `/api/v2/site/${siteUid}/alerts/resolved`,
      "alerts",
      alertSchema,
      params,
      "GET /site/{siteUid}/alerts/resolved",
    );
    return narrow<Alert[]>(result);
  }

  /** `GET /api/v2/device/{deviceUid}/alerts/open` — every open alert for the given device, fully
   * paginated. */
  async openForDevice(
    deviceUid: string,
    params?: GetDeviceOpenAlertsParams,
  ): Promise<Alert[]> {
    const result = await this.paginate(
      `/api/v2/device/${deviceUid}/alerts/open`,
      "alerts",
      alertSchema,
      params,
      "GET /device/{deviceUid}/alerts/open",
    );
    return narrow<Alert[]>(result);
  }

  /** `GET /api/v2/device/{deviceUid}/alerts/resolved` — every resolved alert for the given
   * device, fully paginated. */
  async resolvedForDevice(
    deviceUid: string,
    params?: GetDeviceResolvedAlertsParams,
  ): Promise<Alert[]> {
    const result = await this.paginate(
      `/api/v2/device/${deviceUid}/alerts/resolved`,
      "alerts",
      alertSchema,
      params,
      "GET /device/{deviceUid}/alerts/resolved",
    );
    return narrow<Alert[]>(result);
  }
}
