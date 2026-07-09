import { createQuickJobResponse } from "../../generated/schemas/-v2-device/-v2-device.zod";
import type { CreateQuickJobRequest } from "../../generated/types/createQuickJobRequest";
import type { CreateQuickJobResponse } from "../../generated/types/createQuickJobResponse";
import {
  deviceJobCreateBodySchema,
  deviceSchema,
  type DeviceUdfInput,
  type DeviceWarrantyInput,
  udfWriteBodySchema,
  warrantyWriteBodySchema,
} from "../../schema-overrides";
import type { Device } from "../../schema-overrides";

import { BaseResource } from "./base-resource";
import { narrow } from "./narrow";
import { voidResponseSchema } from "./void-response";

/**
 * `client.devices` (R1, R2, design "Public surface"): device-scoped reads and writes. Proves the
 * retired 0.1.x replacements design Decision 5 names by exact shape: `client.devices.get(uid)`
 * and `client.devices.setUdf(uid, udf)` — the latter realigned to the corrected
 * `POST /api/v2/device/{uid}/udf` (the "two concrete correctness gaps" design's Current State
 * names; the old `updateDeviceUdfs` wrongly targeted `PATCH /api/v2/account/devices/{uid}/udf`).
 *
 * **Deliberately excludes** device-scoped alert reads (`getDeviceOpenAlerts` /
 * `getDeviceResolvedAlerts`) — per the design's explicit `client.alerts.openForSite(siteUid)`
 * precedent, every alert read lives under `AlertResource` regardless of which resource scopes it
 * (`AlertResource.openForDevice` / `resolvedForDevice`, Phase 7 Step 4).
 *
 * **Proxy writes are not implemented here.** The plan's own Phase 7 Step 3 text ("warranty/proxy
 * writes") is imprecise: the real spec has no device-scoped proxy endpoint at all — proxy
 * settings are site-scoped (`POST`/`DELETE /api/v2/site/{siteUid}/settings/proxy`, confirmed by
 * direct enumeration of `spec/openapi.json`) and are implemented on `SiteResource` instead,
 * reusing the `device-proxy-set` `WriteOpKey` Phase 5 already named for them (see
 * `site-resource.ts`'s `updateProxy`/`deleteProxy` doc). This phase follows the actual API
 * topology over the plan's shorthand phrasing (spirit over literalism).
 */
export class DeviceResource extends BaseResource {
  /** `GET /api/v2/device/{uid}` — data for one device, by its UID. Pinned replacement for the
   * retired `getDeviceByUid` (design Decision 5). */
  async get(uid: string): Promise<Device> {
    const result = await this.httpGet(
      `/api/v2/device/${uid}`,
      deviceSchema,
      "GET /device/{uid}",
    );
    return narrow<Device>(result);
  }

  /** `GET /api/v2/device/id/{deviceId}` — data for one device, by its numeric id. */
  async getById(deviceId: number): Promise<Device> {
    const result = await this.httpGet(
      `/api/v2/device/id/${deviceId}`,
      deviceSchema,
      "GET /device/id/{deviceId}",
    );
    return narrow<Device>(result);
  }

  /** `GET /api/v2/device/macAddress/{macAddress}` — every device (usually zero or one) matching
   * the given MAC address. A bare, non-paginated top-level array (`Device[]`, not an envelope),
   * so this uses `httpGetArray` rather than `paginate` — per-item leniency without a cursor
   * (`BaseResource`'s doc, `./base-resource.ts`, names this exact operation as one of the two
   * real R1 GETs `httpGetArray` exists to serve correctly). */
  async getByMacAddress(macAddress: string): Promise<Device[]> {
    const result = await this.httpGetArray(
      `/api/v2/device/macAddress/${macAddress}`,
      deviceSchema,
      "GET /device/macAddress/{macAddress}",
    );
    return narrow<Device[]>(result);
  }

  /** `PUT /api/v2/device/{uid}/site/{siteUid}` (`device-move`): moves a device to another site.
   * The target site is entirely path-carried — a bodiless write. */
  async move(uid: string, siteUid: string): Promise<void> {
    await this.httpPut(
      `/api/v2/device/${uid}/site/${siteUid}`,
      voidResponseSchema,
      "PUT /device/{uid}/site/{siteUid}",
      "device-move",
    );
  }

  /** `PUT /api/v2/device/{uid}/quickjob` (`device-job-create`): creates a quick job on the
   * device. */
  async createJob(
    uid: string,
    body: CreateQuickJobRequest,
  ): Promise<CreateQuickJobResponse> {
    const result = await this.httpPut(
      `/api/v2/device/${uid}/quickjob`,
      body,
      deviceJobCreateBodySchema,
      createQuickJobResponse,
      "PUT /device/{uid}/quickjob",
      "device-job-create",
    );
    return narrow<CreateQuickJobResponse>(result);
  }

  /** `POST /api/v2/device/{uid}/udf` (`device-udf-set`): sets the device's user-defined fields —
   * the corrected endpoint (design Current State: the old client wrongly targeted
   * `PATCH /api/v2/account/devices/{uid}/udf`). */
  async setUdf(uid: string, udf: DeviceUdfInput): Promise<void> {
    await this.httpPost(
      `/api/v2/device/${uid}/udf`,
      udf,
      udfWriteBodySchema,
      voidResponseSchema,
      "POST /device/{uid}/udf",
      "device-udf-set",
    );
  }

  /** `POST /api/v2/device/{uid}/warranty` (`device-warranty-set`): sets the device's warranty
   * date (or clears it — `warrantyWriteBodySchema` accepts `{ warrantyDate: null }`). */
  async setWarranty(uid: string, body: DeviceWarrantyInput): Promise<void> {
    await this.httpPost(
      `/api/v2/device/${uid}/warranty`,
      body,
      warrantyWriteBodySchema,
      voidResponseSchema,
      "POST /device/{uid}/warranty",
      "device-warranty-set",
    );
  }
}
