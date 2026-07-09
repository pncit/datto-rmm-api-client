import nock from "nock";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AuditResource } from "@/client/resources/audit-resource";

import { BASE_URL, makeResource as makeResourceOf } from "./test-harness";

function makeResource() {
  return makeResourceOf(AuditResource);
}

describe("AuditResource", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it("getPrinterAudit() hits GET /api/v2/audit/printer/{deviceUid}", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/audit/printer/dev-1")
      .reply(200, { portalUrl: "https://portal", printer: { printedPageCount: 42 } });
    const { resource, descriptors } = makeResource();

    const result = await resource.getPrinterAudit("dev-1");

    expect(result).toEqual({
      portalUrl: "https://portal",
      printer: { printedPageCount: 42 },
    });
    expect(descriptors).toEqual([{ kind: "read" }]);
    expect(scope.isDone()).toBe(true);
  });

  it("getEsxiHostAudit() hits GET /api/v2/audit/esxihost/{deviceUid}", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/audit/esxihost/dev-2")
      .reply(200, { systemInfo: { manufacturer: "Dell", numberOfSnapshots: 2 } });
    const { resource } = makeResource();

    const result = await resource.getEsxiHostAudit("dev-2");

    expect(result).toEqual({
      systemInfo: { manufacturer: "Dell", numberOfSnapshots: 2 },
    });
    expect(scope.isDone()).toBe(true);
  });

  it("getDeviceAudit() hits GET /api/v2/audit/device/{deviceUid}", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/audit/device/dev-3")
      .reply(200, { systemInfo: { manufacturer: "HP", username: "user1" } });
    const { resource } = makeResource();

    const result = await resource.getDeviceAudit("dev-3");

    expect(result).toEqual({
      systemInfo: { manufacturer: "HP", username: "user1" },
    });
    expect(scope.isDone()).toBe(true);
  });

  it("getDeviceAuditSoftware() paginates GET /api/v2/audit/device/{deviceUid}/software", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/audit/device/dev-3/software")
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 1,
          prevPageUrl: null,
          nextPageUrl: null,
        },
        software: [{ name: "Chrome", version: "120.0" }],
      });
    const { resource } = makeResource();

    const result = await resource.getDeviceAuditSoftware("dev-3");

    expect(result).toEqual([{ name: "Chrome", version: "120.0" }]);
    expect(scope.isDone()).toBe(true);
  });

  it("getDeviceAuditByMacAddress() hits the bare-array endpoint and drops a malformed item (R7)", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/audit/device/macAddress/AA-BB-CC-DD-EE-FF")
      .reply(200, [
        { systemInfo: { manufacturer: "Lenovo" } },
        { systemInfo: "not-an-object" },
      ]);
    const { resource, descriptors, logger } = makeResource();

    const result = await resource.getDeviceAuditByMacAddress(
      "AA-BB-CC-DD-EE-FF",
    );

    expect(result).toEqual([{ systemInfo: { manufacturer: "Lenovo" } }]);
    expect(descriptors).toEqual([{ kind: "read" }]);
    expect(scope.isDone()).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      "dropped invalid response array items",
      expect.objectContaining({ dropped: 1, total: 2 }),
    );
  });
});
