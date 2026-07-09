import { z } from "zod";

import {
  getDeviceAuditByMacAddressResponseItem,
  getDeviceAuditResponse,
  getEsxiHostAuditResponse,
  getPrinterAuditResponse,
} from "../../generated/schemas/-v2-audit/-v2-audit.zod";
import type { DeviceAudit } from "../../generated/types/deviceAudit";
import type { ESXiHostAudit } from "../../generated/types/eSXiHostAudit";
import type { GetDeviceAuditSoftwareParams } from "../../generated/types/getDeviceAuditSoftwareParams";
import type { PrinterAudit } from "../../generated/types/printerAudit";
import type { Software } from "../../generated/types/software";

import { BaseResource } from "./base-resource";
import { narrow } from "./narrow";

/**
 * `GET /api/v2/audit/device/{deviceUid}/software`'s item schema (`Software`). No UDF/
 * alertContext/enum defect to reconcile — a plain mirror of the generated shape (no enum field at
 * all), scoped to this resource file since nothing else shares it.
 *
 * @internal Exported only so `tests/generated/schema-mirror-pin.ts` can pin it against
 * `Software` — not resource API. The `src/index.ts` barrel must never `export *` from this
 * module.
 */
export const softwareSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
});

/**
 * `client.audit` (R1, R2, design "Public surface", plan Phase 8 Step 1: "audit-*fetch* operations
 * (device/printer/ESXi audit; singular namespace per the design's naming rule)"): every
 * audit-fetch read, genuinely tagged `-v2-audit` in the committed spec — no cross-tag rehoming
 * here (unlike `alerts`).
 *
 * Each device-class-specific audit read (`getPrinterAudit`/`getEsxiHostAudit`/`getDeviceAudit`)
 * validates against its own distinct generated response schema — the spec models printer/ESXi/
 * generic-device audit data as three unrelated shapes, not one polymorphic entity, so there is no
 * shared item schema to factor out here the way `Device`/`Filter`/`Variable` are shared elsewhere.
 */
export class AuditResource extends BaseResource {
  /** `GET /api/v2/audit/printer/{deviceUid}` — audit data for a printer-class device. */
  async getPrinterAudit(deviceUid: string): Promise<PrinterAudit> {
    const result = await this.httpGet(
      `/api/v2/audit/printer/${deviceUid}`,
      getPrinterAuditResponse,
      "GET /audit/printer/{deviceUid}",
    );
    return narrow<PrinterAudit>(result);
  }

  /** `GET /api/v2/audit/esxihost/{deviceUid}` — audit data for an esxihost-class device. */
  async getEsxiHostAudit(deviceUid: string): Promise<ESXiHostAudit> {
    const result = await this.httpGet(
      `/api/v2/audit/esxihost/${deviceUid}`,
      getEsxiHostAuditResponse,
      "GET /audit/esxihost/{deviceUid}",
    );
    return narrow<ESXiHostAudit>(result);
  }

  /** `GET /api/v2/audit/device/{deviceUid}` — audit data for a generic (device-class) device. */
  async getDeviceAudit(deviceUid: string): Promise<DeviceAudit> {
    const result = await this.httpGet(
      `/api/v2/audit/device/${deviceUid}`,
      getDeviceAuditResponse,
      "GET /audit/device/{deviceUid}",
    );
    return narrow<DeviceAudit>(result);
  }

  /** `GET /api/v2/audit/device/{deviceUid}/software` — the device's audited software inventory,
   * fully paginated. */
  async getDeviceAuditSoftware(
    deviceUid: string,
    params?: GetDeviceAuditSoftwareParams,
  ): Promise<Software[]> {
    const result = await this.paginate(
      `/api/v2/audit/device/${deviceUid}/software`,
      "software",
      softwareSchema,
      params,
      "GET /audit/device/{deviceUid}/software",
    );
    return narrow<Software[]>(result);
  }

  /** `GET /api/v2/audit/device/macAddress/{macAddress}` — audit data for every device (usually
   * zero or one) matching the given MAC address, mirroring `DeviceResource.getByMacAddress`'s
   * shape. A bare, non-paginated top-level array, so this uses `httpGetArray` rather than
   * `paginate` — per-item leniency without a cursor. */
  async getDeviceAuditByMacAddress(
    macAddress: string,
  ): Promise<DeviceAudit[]> {
    const result = await this.httpGetArray(
      `/api/v2/audit/device/macAddress/${macAddress}`,
      getDeviceAuditByMacAddressResponseItem,
      "GET /audit/device/macAddress/{macAddress}",
    );
    return narrow<DeviceAudit[]>(result);
  }
}
