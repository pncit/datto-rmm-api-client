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
import { z } from "zod";

import { BaseResource } from "@/client/resources/base-resource";
import type { DattoLogger } from "@/logging/logger";
import type { RateDescriptor } from "@/rate-limit/rate-limiter";

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

const deviceSchema = z.object({ uid: z.string(), hostname: z.string() });

class TestResource extends BaseResource {
  walk<T>(
    startPath: string,
    arrayKey: string,
    itemSchema: z.ZodType<T>,
    params: Record<string, unknown> | undefined,
    context: string,
  ) {
    return this.paginate(startPath, arrayKey, itemSchema, params, context);
  }
}

describe("BaseResource.paginate", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it("walks a two-page collection, concatenating items, and stops on a null nextPageUrl", async () => {
    const scope = nock(BASE_URL)
      .get("/account/devices")
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 2,
          prevPageUrl: null,
          nextPageUrl: `${BASE_URL}/account/devices?page=2`,
        },
        devices: [{ uid: "d1", hostname: "host1" }],
      })
      .get("/account/devices")
      .query({ page: "2" })
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 2,
          prevPageUrl: `${BASE_URL}/account/devices?page=1`,
          nextPageUrl: null,
        },
        devices: [{ uid: "d2", hostname: "host2" }],
      });
    const { instance } = createTrackedAxios();
    const resource = new TestResource(instance, createMockLogger());

    const result = await resource.walk(
      "/account/devices",
      "devices",
      deviceSchema,
      undefined,
      "GET /account/devices",
    );

    expect(result).toEqual([
      { uid: "d1", hostname: "host1" },
      { uid: "d2", hostname: "host2" },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it("stops on an empty-string nextPageUrl (the real Datto terminal form)", async () => {
    nock(BASE_URL)
      .get("/account/devices")
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 1,
          prevPageUrl: "",
          nextPageUrl: "",
        },
        devices: [{ uid: "d1", hostname: "host1" }],
      });
    const { instance } = createTrackedAxios();
    const resource = new TestResource(instance, createMockLogger());

    const result = await resource.walk(
      "/account/devices",
      "devices",
      deviceSchema,
      undefined,
      "GET /account/devices",
    );

    expect(result).toEqual([{ uid: "d1", hostname: "host1" }]);
  });

  it("throws DattoValidationError rather than truncating when pageDetails is missing", async () => {
    nock(BASE_URL)
      .get("/account/devices")
      .reply(200, { devices: [{ uid: "d1", hostname: "host1" }] });
    const { instance } = createTrackedAxios();
    const resource = new TestResource(instance, createMockLogger());

    await expect(
      resource.walk(
        "/account/devices",
        "devices",
        deviceSchema,
        undefined,
        "GET /account/devices",
      ),
    ).rejects.toMatchObject({
      name: "DattoValidationError",
      stage: "response",
    });
  });

  it("throws DattoValidationError rather than truncating when nextPageUrl is non-string", async () => {
    nock(BASE_URL)
      .get("/account/devices")
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 1,
          prevPageUrl: null,
          nextPageUrl: 12345,
        },
        devices: [{ uid: "d1", hostname: "host1" }],
      });
    const { instance } = createTrackedAxios();
    const resource = new TestResource(instance, createMockLogger());

    await expect(
      resource.walk(
        "/account/devices",
        "devices",
        deviceSchema,
        undefined,
        "GET /account/devices",
      ),
    ).rejects.toMatchObject({
      name: "DattoValidationError",
      stage: "response",
    });
  });

  it("drops a lenient item on page 2 without aborting the walk", async () => {
    nock(BASE_URL)
      .get("/account/devices")
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 2,
          prevPageUrl: null,
          nextPageUrl: `${BASE_URL}/account/devices?page=2`,
        },
        devices: [{ uid: "d1", hostname: "host1" }],
      })
      .get("/account/devices")
      .query({ page: "2" })
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 2,
          prevPageUrl: `${BASE_URL}/account/devices?page=1`,
          nextPageUrl: null,
        },
        devices: [{ uid: "d2", hostname: 42 }],
      });
    const { instance } = createTrackedAxios();
    const logger = createMockLogger();
    const resource = new TestResource(instance, logger);

    const result = await resource.walk(
      "/account/devices",
      "devices",
      deviceSchema,
      undefined,
      "GET /account/devices",
    );

    expect(result).toEqual([{ uid: "d1", hostname: "host1" }]);
    expect(logger.warn).toHaveBeenCalledWith(
      "dropped invalid response array items",
      expect.objectContaining({ dropped: 1, total: 1 }),
    );
  });

  it("consumes the read rate-limit window once per page fetched", async () => {
    nock(BASE_URL)
      .get("/account/devices")
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 2,
          prevPageUrl: null,
          nextPageUrl: `${BASE_URL}/account/devices?page=2`,
        },
        devices: [{ uid: "d1", hostname: "host1" }],
      })
      .get("/account/devices")
      .query({ page: "2" })
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 2,
          prevPageUrl: `${BASE_URL}/account/devices?page=1`,
          nextPageUrl: null,
        },
        devices: [{ uid: "d2", hostname: "host2" }],
      });
    const { instance, descriptors } = createTrackedAxios();
    const resource = new TestResource(instance, createMockLogger());

    await resource.walk(
      "/account/devices",
      "devices",
      deviceSchema,
      undefined,
      "GET /account/devices",
    );

    expect(descriptors).toEqual([{ kind: "read" }, { kind: "read" }]);
  });

  it("sends the initial params only on the first request — nextPageUrl carries its own query state", async () => {
    nock(BASE_URL)
      .get("/account/devices")
      .query({ resultsPerPage: "1" })
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 2,
          prevPageUrl: null,
          nextPageUrl: `${BASE_URL}/account/devices?page=2`,
        },
        devices: [{ uid: "d1", hostname: "host1" }],
      })
      .get("/account/devices")
      .query({ page: "2" })
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 2,
          prevPageUrl: `${BASE_URL}/account/devices?page=1`,
          nextPageUrl: null,
        },
        devices: [{ uid: "d2", hostname: "host2" }],
      });
    const { instance } = createTrackedAxios();
    const resource = new TestResource(instance, createMockLogger());

    const result = await resource.walk(
      "/account/devices",
      "devices",
      deviceSchema,
      { resultsPerPage: "1" },
      "GET /account/devices",
    );

    expect(result).toHaveLength(2);
  });
});
