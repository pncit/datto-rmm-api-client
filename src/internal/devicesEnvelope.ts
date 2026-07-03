import { z } from "zod/v4";
import { PaginationDataSchema } from "../schemas.js";

/**
 * Structural "envelope" for a devices page: validates `pageDetails` exactly as
 * `DevicesPageSchema` does, but treats `devices` as an array of opaque elements — each device
 * is validated separately (via `validateItems`/`DeviceSchema` in client.ts), not by this schema.
 *
 * `devices` stays optional, matching `DevicesPageSchema`, so a legitimate zero-device page that
 * omits `devices` is not falsely rejected as a protocol error.
 *
 * This module is deliberately NOT re-exported by src/index.ts: the envelope is an internal
 * detail of the pagination path, not part of the public API surface (mirrors how
 * `validateItems`/`toProblemError` stay non-public in the also-un-barrelled `validation.ts`).
 */
export const DevicesEnvelopeSchema = z.object({
  pageDetails: PaginationDataSchema.optional(),
  devices: z.array(z.unknown()).optional(),
});

export type DevicesEnvelope = z.infer<typeof DevicesEnvelopeSchema>;
