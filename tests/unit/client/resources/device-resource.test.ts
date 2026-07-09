import nock from "nock";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DeviceResource } from "@/client/resources/device-resource";
import { withUdfMasking } from "@/logging/mask";
import type { DeviceUdfInput } from "@/schema-overrides";

import {
  BASE_URL,
  createMockLogger,
  createTrackedAxios,
  makeResource as makeResourceOf,
} from "./test-harness";

function makeResource(logger = createMockLogger()) {
  return makeResourceOf(DeviceResource, logger);
}

describe("DeviceResource", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it("get() hits GET /api/v2/device/{uid} and validates through the reconciled Device schema", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/device/dev-1")
      .reply(200, {
        uid: "dev-1",
        hostname: "PC1",
        deviceClass: "rmmnetworkdevice",
        udf: { udf1: "value1" },
      });
    const { resource, descriptors } = makeResource();

    const result = await resource.get("dev-1");

    expect(result).toEqual({
      uid: "dev-1",
      hostname: "PC1",
      deviceClass: "rmmnetworkdevice",
      udf: { udf1: "value1" },
    });
    expect(descriptors).toEqual([{ kind: "read" }]);
    expect(scope.isDone()).toBe(true);
  });

  it("getById() hits GET /api/v2/device/id/{deviceId}", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/device/id/42")
      .reply(200, { id: 42, uid: "dev-1", hostname: "PC1" });
    const { resource } = makeResource();

    const result = await resource.getById(42);

    expect(result).toEqual({ id: 42, uid: "dev-1", hostname: "PC1" });
    expect(scope.isDone()).toBe(true);
  });

  it("getByMacAddress() hits the bare-array endpoint and drops a malformed item without failing the call (R7)", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/device/macAddress/AA:BB:CC:DD:EE:FF")
      .reply(200, [
        { uid: "dev-1", hostname: "PC1" },
        { uid: 12345 }, // malformed: uid must be a string
      ]);
    const { resource, descriptors, logger } = makeResource();

    const result = await resource.getByMacAddress("AA:BB:CC:DD:EE:FF");

    expect(result).toEqual([{ uid: "dev-1", hostname: "PC1" }]);
    expect(descriptors).toEqual([{ kind: "read" }]);
    expect(logger.warn).toHaveBeenCalledWith(
      "dropped invalid response array items",
      expect.objectContaining({ dropped: 1, total: 2 }),
    );
    expect(scope.isDone()).toBe(true);
  });

  it("move() PUTs /api/v2/device/{uid}/site/{siteUid} with no body and tags device-move", async () => {
    const scope = nock(BASE_URL)
      .put("/api/v2/device/dev-1/site/site-2")
      .reply(200);
    const { resource, descriptors } = makeResource();

    await resource.move("dev-1", "site-2");

    expect(descriptors).toEqual([{ kind: "write", opKey: "device-move" }]);
    expect(scope.isDone()).toBe(true);
  });

  it("createJob() PUTs /api/v2/device/{uid}/quickjob and tags device-job-create", async () => {
    const scope = nock(BASE_URL)
      .put("/api/v2/device/dev-1/quickjob", {
        jobName: "Reboot",
        jobComponent: { componentUid: "comp-1" },
      })
      .reply(200, { job: { uid: "job-1", status: "active" } });
    const { resource, descriptors } = makeResource();

    const result = await resource.createJob("dev-1", {
      jobName: "Reboot",
      jobComponent: { componentUid: "comp-1" },
    });

    expect(result).toEqual({ job: { uid: "job-1", status: "active" } });
    expect(descriptors).toEqual([
      { kind: "write", opKey: "device-job-create" },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it("createJob() rejects a body missing the spec-required jobComponent", async () => {
    const { resource } = makeResource();

    await expect(
      resource.createJob("dev-1", {
        jobName: "Reboot",
      } as unknown as Parameters<DeviceResource["createJob"]>[1]),
    ).rejects.toMatchObject({ name: "DattoValidationError", stage: "request" });
  });

  it("setUdf() POSTs the corrected /api/v2/device/{uid}/udf endpoint, tags device-udf-set, and rejects an empty body", async () => {
    const scope = nock(BASE_URL)
      .post("/api/v2/device/dev-1/udf", { udf5: "new-value" })
      .reply(200);
    const { resource, descriptors } = makeResource();

    await resource.setUdf("dev-1", { udf5: "new-value" });

    expect(descriptors).toEqual([{ kind: "write", opKey: "device-udf-set" }]);
    expect(scope.isDone()).toBe(true);

    const { resource: resource2 } = makeResource();
    await expect(
      resource2.setUdf("dev-1", {} as unknown as DeviceUdfInput),
    ).rejects.toMatchObject({ name: "DattoValidationError", stage: "request" });
  });

  it("routes a real leniency diagnostic through the constructor-injected masked logger, which still masks a raw UDF value logged through that same instance (R20 end-to-end)", async () => {
    // `setUdf()`'s own response is validated against `voidResponseSchema` (`z.unknown()`), whose
    // `cleanAndDiagnoseResponse` default case never records a diagnostic — there is no leniency
    // event this specific write can ever produce for `parseLenient` to log, with or without
    // masking (confirmed: `DiagnosticsCollector.flush` only emits when a group was recorded), so
    // it cannot itself organically drive a log call. `get()`'s response, by contrast, is
    // validated against the real reconciled `Device` schema, so a genuinely unrecognized
    // top-level property organically produces a real "stripped unknown response property"
    // `debug` call through the actual `BaseResource` → `parseLenient` path — proving the
    // constructor-injected `maskedLogger`, not some other unwrapped logger, is what `BaseResource`
    // actually logs through.
    nock(BASE_URL)
      .get("/api/v2/device/dev-1")
      .reply(200, {
        uid: "dev-1",
        udf: { udf1: "S3CR3T-VALUE" },
        somethingUnrecognized: "triggers a real leniency diagnostic",
      });
    const sink = createMockLogger();
    const maskedLogger = withUdfMasking(sink);
    const { instance } = createTrackedAxios();
    const resource = new DeviceResource(instance, maskedLogger);

    await resource.get("dev-1");

    expect(sink.debug).toHaveBeenCalledWith(
      "stripped unknown response property",
      expect.objectContaining({ field: "somethingUnrecognized" }),
    );

    // That real diagnostic never carries `udf`'s own value (schema-leniency deliberately omits a
    // stripped key's value — see `objectCatchall`'s doc), so it alone can't prove masking
    // actually redacts a UDF value. Confirm the same `maskedLogger` reference `BaseResource` just
    // logged through still does: a raw UDF value logged through it comes out redacted, never raw.
    maskedLogger.debug("simulated leniency diagnostic", {
      udf1: "S3CR3T-VALUE",
    });

    expect(sink.debug).toHaveBeenLastCalledWith(
      "simulated leniency diagnostic",
      { udf1: expect.stringMatching(/^\[redacted - \d+ characters\]$/) },
    );
    for (const method of ["debug", "info", "warn", "error"] as const) {
      for (const call of (sink[method] as ReturnType<typeof vi.fn>).mock
        .calls) {
        expect(JSON.stringify(call)).not.toContain("S3CR3T-VALUE");
      }
    }
  });

  it("setWarranty() POSTs /api/v2/device/{uid}/warranty, tags device-warranty-set, and accepts a null warrantyDate", async () => {
    const scope = nock(BASE_URL)
      .post("/api/v2/device/dev-1/warranty", { warrantyDate: null })
      .reply(200);
    const { resource, descriptors } = makeResource();

    await resource.setWarranty("dev-1", { warrantyDate: null });

    expect(descriptors).toEqual([
      { kind: "write", opKey: "device-warranty-set" },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it("setWarranty() rejects an all-omitted body", async () => {
    const { resource } = makeResource();

    await expect(
      resource.setWarranty(
        "dev-1",
        {} as unknown as Parameters<DeviceResource["setWarranty"]>[1],
      ),
    ).rejects.toMatchObject({ name: "DattoValidationError", stage: "request" });
  });
});
