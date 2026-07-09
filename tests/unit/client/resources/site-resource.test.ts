import axios from "axios";
import nock from "nock";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { SiteResource } from "@/client/resources/site-resource";
import type { DattoLogger } from "@/logging/logger";
import type { RateDescriptor } from "@/rate-limit/rate-limiter";
import type { CreateSiteRequest } from "@/generated/types/createSiteRequest";
import type { SiteRequest } from "@/generated/types/siteRequest";

const BASE_URL = "https://zinfandel-api.example.com";

function createMockLogger(): DattoLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createTrackedAxios() {
  const instance = axios.create({ baseURL: BASE_URL });
  const descriptors: RateDescriptor[] = [];
  instance.interceptors.request.use((config) => {
    if (config.rateDescriptor) {
      descriptors.push(config.rateDescriptor);
    }
    return config;
  });
  return { instance, descriptors };
}

function makeResource() {
  const { instance, descriptors } = createTrackedAxios();
  const logger = createMockLogger();
  return { resource: new SiteResource(instance, logger), descriptors, logger };
}

describe("SiteResource", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it("list() paginates GET /api/v2/account/sites (the site collection, not AccountResource)", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/account/sites")
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 1,
          prevPageUrl: null,
          nextPageUrl: null,
        },
        sites: [{ uid: "site-1", name: "HQ", notes: null }],
      });
    const { resource, descriptors } = makeResource();

    const result = await resource.list();

    expect(result).toEqual([{ uid: "site-1", name: "HQ", notes: null }]);
    expect(descriptors).toEqual([{ kind: "read" }]);
    expect(scope.isDone()).toBe(true);
  });

  it("get() hits GET /api/v2/site/{siteUid}", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/site/site-1")
      .reply(200, { uid: "site-1", name: "HQ" });
    const { resource } = makeResource();

    const result = await resource.get("site-1");

    expect(result).toEqual({ uid: "site-1", name: "HQ" });
    expect(scope.isDone()).toBe(true);
  });

  it("create() PUTs /api/v2/site, tags site-create, and rejects a malformed body", async () => {
    const scope = nock(BASE_URL)
      .put("/api/v2/site", { name: "New Site" })
      .reply(200, { uid: "site-2", name: "New Site" });
    const { resource, descriptors } = makeResource();

    const result = await resource.create({ name: "New Site" });

    expect(result).toEqual({ uid: "site-2", name: "New Site" });
    expect(descriptors).toEqual([{ kind: "write", opKey: "site-create" }]);
    expect(scope.isDone()).toBe(true);

    const { resource: resource2 } = makeResource();
    await expect(
      resource2.create({
        description: "no name",
      } as unknown as CreateSiteRequest),
    ).rejects.toMatchObject({ name: "DattoValidationError", stage: "request" });
  });

  it("update() POSTs /api/v2/site/{siteUid}, tags site-update, and rejects a malformed body", async () => {
    const scope = nock(BASE_URL)
      .post("/api/v2/site/site-1", { name: "Renamed HQ" })
      .reply(200, { uid: "site-1", name: "Renamed HQ" });
    const { resource, descriptors } = makeResource();

    const result = await resource.update("site-1", { name: "Renamed HQ" });

    expect(result).toEqual({ uid: "site-1", name: "Renamed HQ" });
    expect(descriptors).toEqual([{ kind: "write", opKey: "site-update" }]);
    expect(scope.isDone()).toBe(true);

    const { resource: resource2 } = makeResource();
    await expect(
      resource2.update("site-1", {
        description: "no name",
      } as unknown as SiteRequest),
    ).rejects.toMatchObject({ name: "DattoValidationError", stage: "request" });
  });

  it("devices() paginates GET /api/v2/site/{siteUid}/devices via the reconciled Device schema", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/site/site-1/devices")
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 1,
          prevPageUrl: null,
          nextPageUrl: null,
        },
        devices: [{ uid: "dev-1", hostname: "PC1" }],
      });
    const { resource } = makeResource();

    const result = await resource.devices("site-1");

    expect(result).toEqual([{ uid: "dev-1", hostname: "PC1" }]);
    expect(scope.isDone()).toBe(true);
  });

  it("devicesWithNetworkInterface() paginates GET /api/v2/site/{siteUid}/devices/network-interface", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/site/site-1/devices/network-interface")
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 1,
          prevPageUrl: null,
          nextPageUrl: null,
        },
        devices: [
          { uid: "dev-1", hostname: "PC1", nics: [{ macAddress: "AA:BB" }] },
        ],
      });
    const { resource } = makeResource();

    const result = await resource.devicesWithNetworkInterface("site-1");

    expect(result).toEqual([
      { uid: "dev-1", hostname: "PC1", nics: [{ macAddress: "AA:BB" }] },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it("variables() paginates GET /api/v2/site/{siteUid}/variables", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/site/site-1/variables")
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 1,
          prevPageUrl: null,
          nextPageUrl: null,
        },
        variables: [{ id: 1, name: "FOO" }],
      });
    const { resource } = makeResource();

    const result = await resource.variables("site-1");

    expect(result).toEqual([{ id: 1, name: "FOO" }]);
    expect(scope.isDone()).toBe(true);
  });

  it("createVariable() PUTs /api/v2/site/{siteUid}/variable and tags site-variable-set", async () => {
    const scope = nock(BASE_URL)
      .put("/api/v2/site/site-1/variable", { name: "FOO" })
      .reply(200);
    const { resource, descriptors } = makeResource();

    await resource.createVariable("site-1", { name: "FOO" });

    expect(descriptors).toEqual([
      { kind: "write", opKey: "site-variable-set" },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it("updateVariable() rejects an all-omitted body", async () => {
    const { resource } = makeResource();

    await expect(
      resource.updateVariable("site-1", 1, {}),
    ).rejects.toMatchObject({
      name: "DattoValidationError",
      stage: "request",
    });
  });

  it("deleteVariable() DELETEs /api/v2/site/{siteUid}/variable/{variableId} and reuses site-variable-set", async () => {
    const scope = nock(BASE_URL)
      .delete("/api/v2/site/site-1/variable/1")
      .reply(200);
    const { resource, descriptors } = makeResource();

    await resource.deleteVariable("site-1", 1);

    expect(descriptors).toEqual([
      { kind: "write", opKey: "site-variable-set" },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it("settings() hits GET /api/v2/site/{siteUid}/settings", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/site/site-1/settings")
      .reply(200, { generalSettings: { name: "HQ" } });
    const { resource } = makeResource();

    const result = await resource.settings("site-1");

    expect(result).toEqual({ generalSettings: { name: "HQ" } });
    expect(scope.isDone()).toBe(true);
  });

  it("deviceFilters() paginates GET /api/v2/site/{siteUid}/filters", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/site/site-1/filters")
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 1,
          prevPageUrl: null,
          nextPageUrl: null,
        },
        filters: [{ id: 1, name: "Windows", type: "custom" }],
      });
    const { resource } = makeResource();

    const result = await resource.deviceFilters("site-1");

    expect(result).toEqual([{ id: 1, name: "Windows", type: "custom" }]);
    expect(scope.isDone()).toBe(true);
  });

  it("updateProxy() POSTs /api/v2/site/{siteUid}/settings/proxy, tags device-proxy-set, and rejects an all-omitted body", async () => {
    const scope = nock(BASE_URL)
      .post("/api/v2/site/site-1/settings/proxy", { host: "proxy.example.com" })
      .reply(200, { proxySettings: { host: "proxy.example.com" } });
    const { resource, descriptors } = makeResource();

    const result = await resource.updateProxy("site-1", {
      host: "proxy.example.com",
    });

    expect(result).toEqual({ proxySettings: { host: "proxy.example.com" } });
    expect(descriptors).toEqual([{ kind: "write", opKey: "device-proxy-set" }]);
    expect(scope.isDone()).toBe(true);

    const { resource: resource2 } = makeResource();
    await expect(resource2.updateProxy("site-1", {})).rejects.toMatchObject({
      name: "DattoValidationError",
      stage: "request",
    });
  });

  it("deleteProxy() DELETEs /api/v2/site/{siteUid}/settings/proxy and reuses device-proxy-set", async () => {
    const scope = nock(BASE_URL)
      .delete("/api/v2/site/site-1/settings/proxy")
      .reply(204);
    const { resource, descriptors } = makeResource();

    await resource.deleteProxy("site-1");

    expect(descriptors).toEqual([{ kind: "write", opKey: "device-proxy-set" }]);
    expect(scope.isDone()).toBe(true);
  });
});
