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

import { BaseResource, coerceSchema } from "@/client/resources/base-resource";
import type { DattoLogger } from "@/logging/logger";
import type { RateDescriptor } from "@/rate-limit/rate-limiter";
import type { WriteOpKey } from "@/rate-limit/rate-limits";

const BASE_URL = "https://zinfandel-api.example.com";

function createMockLogger(): DattoLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** A bare axios instance (no rate limiter / retry / auth stack — those are Phase 5 concerns
 * exercised in `http-client.test.ts`) that records every request's `rateDescriptor` before nock
 * intercepts the actual call, so each primitive's descriptor-tagging can be asserted directly. */
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

/** Exposes `BaseResource`'s protected primitives as public methods for direct testing. */
class TestResource extends BaseResource {
  get<T>(
    path: string,
    schema: z.ZodType<T>,
    context: string,
    params?: Record<string, unknown>,
  ) {
    return this.httpGet(path, schema, context, params);
  }

  getArray<T>(
    path: string,
    itemSchema: z.ZodType<T>,
    context: string,
    params?: Record<string, unknown>,
  ) {
    return this.httpGetArray(path, itemSchema, context, params);
  }

  postEmpty<T>(
    path: string,
    schema: z.ZodType<T>,
    context: string,
    opKey: WriteOpKey,
  ) {
    return this.httpPost(path, schema, context, opKey);
  }

  postWithBody<TBody, TResponse>(
    path: string,
    body: TBody,
    bodySchema: z.ZodType<TBody>,
    responseSchema: z.ZodType<TResponse>,
    context: string,
    opKey: WriteOpKey,
  ) {
    return this.httpPost(
      path,
      body,
      bodySchema,
      responseSchema,
      context,
      opKey,
    );
  }

  putEmpty<T>(
    path: string,
    schema: z.ZodType<T>,
    context: string,
    opKey: WriteOpKey,
  ) {
    return this.httpPut(path, schema, context, opKey);
  }

  putWithBody<TBody, TResponse>(
    path: string,
    body: TBody,
    bodySchema: z.ZodType<TBody>,
    responseSchema: z.ZodType<TResponse>,
    context: string,
    opKey: WriteOpKey,
  ) {
    return this.httpPut(path, body, bodySchema, responseSchema, context, opKey);
  }

  patchWithBody<TBody, TResponse>(
    path: string,
    body: TBody,
    bodySchema: z.ZodType<TBody>,
    responseSchema: z.ZodType<TResponse>,
    context: string,
    opKey: WriteOpKey,
  ) {
    return this.httpPatch(
      path,
      body,
      bodySchema,
      responseSchema,
      context,
      opKey,
    );
  }

  del(path: string, opKey: WriteOpKey) {
    return this.httpDelete(path, opKey);
  }

  request<T>(data: T, schema: z.ZodType<T>) {
    return this.validateRequest(data, schema);
  }

  response<T>(data: unknown, schema: z.ZodType<T>, context: string) {
    return this.validateResponse(data, schema, context);
  }

  arrayResponse<T>(data: unknown, schema: z.ZodType<T>, context: string) {
    return this.validateArrayResponse(data, schema, context);
  }
}

describe("BaseResource", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe("httpGet", () => {
    it("tags the request { kind: 'read' } and validates the response leniently", async () => {
      const scope = nock(BASE_URL)
        .get("/foo")
        .reply(200, { name: "Alice", extra: "stripped" });
      const { instance, descriptors } = createTrackedAxios();
      const logger = createMockLogger();
      const resource = new TestResource(instance, logger);

      const result = await resource.get(
        "/foo",
        z.object({ name: z.string() }),
        "GET /foo",
      );

      expect(result).toEqual({ name: "Alice" });
      expect(descriptors).toEqual([{ kind: "read" }]);
      expect(scope.isDone()).toBe(true);
    });

    it("forwards query params", async () => {
      const scope = nock(BASE_URL)
        .get("/foo")
        .query({ active: "true" })
        .reply(200, { name: "Alice" });
      const { instance } = createTrackedAxios();
      const resource = new TestResource(instance, createMockLogger());

      await resource.get("/foo", z.object({ name: z.string() }), "GET /foo", {
        active: "true",
      });

      expect(scope.isDone()).toBe(true);
    });
  });

  describe("httpGetArray", () => {
    it("tags the request { kind: 'read' } and validates each item leniently", async () => {
      const scope = nock(BASE_URL)
        .get("/device/uid-1/audit/mac/00:11:22:33:44:55")
        .reply(200, [{ name: "Alice", extra: "stripped" }, { name: "Bob" }]);
      const { instance, descriptors } = createTrackedAxios();
      const resource = new TestResource(instance, createMockLogger());

      const result = await resource.getArray(
        "/device/uid-1/audit/mac/00:11:22:33:44:55",
        z.object({ name: z.string() }),
        "GET /device/{uid}/audit/mac/{mac}",
      );

      expect(result).toEqual([{ name: "Alice" }, { name: "Bob" }]);
      expect(descriptors).toEqual([{ kind: "read" }]);
      expect(scope.isDone()).toBe(true);
    });

    it("drops a malformed item instead of failing the whole call (R7)", async () => {
      const scope = nock(BASE_URL)
        .get("/device/uid-1/audit/mac/00:11:22:33:44:55")
        .reply(200, [{ name: "Alice" }, { name: 42 }]);
      const { instance } = createTrackedAxios();
      const logger = createMockLogger();
      const resource = new TestResource(instance, logger);

      const result = await resource.getArray(
        "/device/uid-1/audit/mac/00:11:22:33:44:55",
        z.object({ name: z.string() }),
        "GET /device/{uid}/audit/mac/{mac}",
      );

      expect(result).toEqual([{ name: "Alice" }]);
      expect(logger.warn).toHaveBeenCalledWith(
        "dropped invalid response array items",
        expect.objectContaining({ dropped: 1, total: 2 }),
      );
      expect(scope.isDone()).toBe(true);
    });

    it("forwards query params", async () => {
      const scope = nock(BASE_URL)
        .get("/device/uid-1/audit/mac/00:11:22:33:44:55")
        .query({ active: "true" })
        .reply(200, []);
      const { instance } = createTrackedAxios();
      const resource = new TestResource(instance, createMockLogger());

      await resource.getArray(
        "/device/uid-1/audit/mac/00:11:22:33:44:55",
        z.object({ name: z.string() }),
        "GET /device/{uid}/audit/mac/{mac}",
        { active: "true" },
      );

      expect(scope.isDone()).toBe(true);
    });
  });

  describe("httpPost", () => {
    it("(bodiless) sends no body and tags { kind: 'write', opKey }", async () => {
      const scope = nock(BASE_URL)
        .post("/alert/uid-1/resolve")
        .reply(200, { resolved: true });
      const { instance, descriptors } = createTrackedAxios();
      const resource = new TestResource(instance, createMockLogger());

      const result = await resource.postEmpty(
        "/alert/uid-1/resolve",
        z.object({ resolved: z.boolean() }),
        "POST /alert/{uid}/resolve",
        "alert-resolve",
      );

      expect(result).toEqual({ resolved: true });
      expect(descriptors).toEqual([{ kind: "write", opKey: "alert-resolve" }]);
      expect(scope.isDone()).toBe(true);
    });

    it("(body-carrying) validates the body against bodySchema before sending", async () => {
      const scope = nock(BASE_URL)
        .post("/device/uid-1/udf", { udf5: "value" })
        .reply(200, {});
      const { instance, descriptors } = createTrackedAxios();
      const resource = new TestResource(instance, createMockLogger());

      await resource.postWithBody(
        "/device/uid-1/udf",
        { udf5: "value" },
        z.object({ udf5: z.string() }),
        z.object({}),
        "POST /device/{uid}/udf",
        "device-udf-set",
      );

      expect(descriptors).toEqual([{ kind: "write", opKey: "device-udf-set" }]);
      expect(scope.isDone()).toBe(true);
    });

    it("throws DattoValidationError('request') without sending when the body fails validation", async () => {
      const scope = nock(BASE_URL).post("/device/uid-1/udf").reply(200, {});
      const { instance } = createTrackedAxios();
      const resource = new TestResource(instance, createMockLogger());

      await expect(
        resource.postWithBody(
          "/device/uid-1/udf",
          { udf5: 5 } as unknown as { udf5: string },
          z.object({ udf5: z.string() }),
          z.object({}),
          "POST /device/{uid}/udf",
          "device-udf-set",
        ),
      ).rejects.toMatchObject({
        name: "DattoValidationError",
        stage: "request",
      });
      expect(scope.isDone()).toBe(false);
    });
  });

  describe("httpPut", () => {
    it("(bodiless) sends no body — e.g. device-move, whose target is entirely path-carried", async () => {
      const scope = nock(BASE_URL)
        .put("/device/uid-1/site/site-2")
        .reply(200, {});
      const { instance, descriptors } = createTrackedAxios();
      const resource = new TestResource(instance, createMockLogger());

      await resource.putEmpty(
        "/device/uid-1/site/site-2",
        z.object({}),
        "PUT /device/{uid}/site/{siteUid}",
        "device-move",
      );

      expect(descriptors).toEqual([{ kind: "write", opKey: "device-move" }]);
      expect(scope.isDone()).toBe(true);
    });

    it("(body-carrying) validates and sends the body — e.g. site-create", async () => {
      const scope = nock(BASE_URL)
        .put("/site", { name: "New Site" })
        .reply(200, { uid: "site-3" });
      const { instance } = createTrackedAxios();
      const resource = new TestResource(instance, createMockLogger());

      const result = await resource.putWithBody(
        "/site",
        { name: "New Site" },
        z.object({ name: z.string() }),
        z.object({ uid: z.string() }),
        "PUT /site",
        "site-create",
      );

      expect(result).toEqual({ uid: "site-3" });
      expect(scope.isDone()).toBe(true);
    });
  });

  describe("httpPatch", () => {
    it("validates and sends the body, tagging { kind: 'write', opKey }", async () => {
      const scope = nock(BASE_URL)
        .patch("/whatever", { a: 1 })
        .reply(200, { ok: true });
      const { instance, descriptors } = createTrackedAxios();
      const resource = new TestResource(instance, createMockLogger());

      const result = await resource.patchWithBody(
        "/whatever",
        { a: 1 },
        z.object({ a: z.number() }),
        z.object({ ok: z.boolean() }),
        "PATCH /whatever",
        "device-warranty-set",
      );

      expect(result).toEqual({ ok: true });
      expect(descriptors).toEqual([
        { kind: "write", opKey: "device-warranty-set" },
      ]);
      expect(scope.isDone()).toBe(true);
    });
  });

  describe("httpDelete", () => {
    it("sends no body/response validation and tags { kind: 'write', opKey }", async () => {
      const scope = nock(BASE_URL).delete("/filter/uid-1").reply(204);
      const { instance, descriptors } = createTrackedAxios();
      const resource = new TestResource(instance, createMockLogger());

      const result = await resource.del("/filter/uid-1", "filter-delete");

      expect(result).toBeUndefined();
      expect(descriptors).toEqual([{ kind: "write", opKey: "filter-delete" }]);
      expect(scope.isDone()).toBe(true);
    });
  });

  describe("validateRequest", () => {
    it("throws DattoValidationError('request') on an unknown key", () => {
      const { instance } = createTrackedAxios();
      const resource = new TestResource(instance, createMockLogger());
      const schema = z.strictObject({ name: z.string() });

      expect(() =>
        resource.request(
          { name: "a", extra: "b" } as unknown as { name: string },
          schema,
        ),
      ).toThrowError(
        expect.objectContaining({
          name: "DattoValidationError",
          stage: "request",
        }),
      );
    });

    it("throws DattoValidationError('request') on a missing required field", () => {
      const { instance } = createTrackedAxios();
      const resource = new TestResource(instance, createMockLogger());
      const schema = z.strictObject({ name: z.string() });

      expect(() =>
        resource.request({} as unknown as { name: string }, schema),
      ).toThrowError(
        expect.objectContaining({
          name: "DattoValidationError",
          stage: "request",
        }),
      );
    });

    it("returns the validated data on success", () => {
      const { instance } = createTrackedAxios();
      const resource = new TestResource(instance, createMockLogger());
      const schema = z.strictObject({ name: z.string() });

      expect(resource.request({ name: "a" }, schema)).toEqual({ name: "a" });
    });
  });

  describe("validateResponse", () => {
    it("strips unknown keys and returns the rest", () => {
      const { instance } = createTrackedAxios();
      const resource = new TestResource(instance, createMockLogger());
      const schema = z.object({ name: z.string() });

      const result = resource.response(
        { name: "Alice", extra: "stripped" },
        schema,
        "test",
      );

      expect(result).toEqual({ name: "Alice" });
    });

    it("throws DattoValidationError('response') when validation fails", () => {
      const { instance } = createTrackedAxios();
      const resource = new TestResource(instance, createMockLogger());
      const schema = z.object({ name: z.string() });

      expect(() =>
        resource.response({ name: 42 }, schema, "test"),
      ).toThrowError(
        expect.objectContaining({
          name: "DattoValidationError",
          stage: "response",
        }),
      );
    });
  });

  describe("validateArrayResponse", () => {
    it("drops one bad item, keeps the rest, and emits exactly one aggregated warn", () => {
      const { instance } = createTrackedAxios();
      const logger = createMockLogger();
      const resource = new TestResource(instance, logger);
      const schema = z.object({ name: z.string() });

      const result = resource.arrayResponse(
        [{ name: "Alice" }, { name: 42 }, { name: "Bob" }],
        schema,
        "test-context",
      );

      expect(result).toEqual([{ name: "Alice" }, { name: "Bob" }]);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        "dropped invalid response array items",
        expect.objectContaining({
          context: "test-context",
          dropped: 1,
          total: 3,
        }),
      );
    });

    it("produces a single warn summary even when every item is invalid", () => {
      const { instance } = createTrackedAxios();
      const logger = createMockLogger();
      const resource = new TestResource(instance, logger);
      const schema = z.object({ name: z.string() });

      const result = resource.arrayResponse(
        [{ name: 1 }, { name: 2 }, { name: 3 }],
        schema,
        "test-context",
      );

      expect(result).toEqual([]);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        "dropped invalid response array items",
        expect.objectContaining({ dropped: 3, total: 3 }),
      );
    });

    it("never leaks a dropped item's raw wire value, in the message or in meta (R20 invariant)", () => {
      const { instance } = createTrackedAxios();
      const logger = createMockLogger();
      const resource = new TestResource(instance, logger);
      // A real string wire value, of the wrong type for the schema (schema expects a number),
      // so it actually enters `dropped[].error` via zod's prettified error text — the one path
      // that could carry a raw value into `meta` outside the UDF-key-based masker's reach.
      const schema = z.object({ udf1: z.number() });

      resource.arrayResponse(
        [{ udf1: "S3CR3T-RAW-WIRE-VALUE" }],
        schema,
        "ctx",
      );

      expect(logger.warn).toHaveBeenCalledTimes(1);
      const [message, meta] = (logger.warn as ReturnType<typeof vi.fn>).mock
        .calls[0]!;
      expect(message).toBe("dropped invalid response array items");
      expect(message).not.toContain("S3CR3T-RAW-WIRE-VALUE");
      // `meta` (and specifically `firstErrors`, the only place a per-item zod error rides) must
      // not carry the raw value either — zod's `prettifyError` emits type names/paths, never the
      // parsed value itself, but this asserts that invariant directly rather than trusting it.
      expect(JSON.stringify(meta)).not.toContain("S3CR3T-RAW-WIRE-VALUE");
    });

    it("emits a distinct warn (not a silent empty result) when data is present but not an array", () => {
      const { instance } = createTrackedAxios();
      const logger = createMockLogger();
      const resource = new TestResource(instance, logger);
      const schema = z.object({ name: z.string() });

      const result = resource.arrayResponse(
        { name: "not an array" },
        schema,
        "test-context",
      );

      expect(result).toEqual([]);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        "response array field was not an array",
        expect.objectContaining({
          context: "test-context",
          receivedType: "object",
        }),
      );
    });

    it("emits the same distinct warn when the array field is entirely absent (undefined)", () => {
      const { instance } = createTrackedAxios();
      const logger = createMockLogger();
      const resource = new TestResource(instance, logger);
      const schema = z.object({ name: z.string() });

      const result = resource.arrayResponse(undefined, schema, "test-context");

      expect(result).toEqual([]);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        "response array field was not an array",
        expect.objectContaining({
          context: "test-context",
          receivedType: "undefined",
        }),
      );
    });

    it("emits nothing when data is a genuinely empty array", () => {
      const { instance } = createTrackedAxios();
      const logger = createMockLogger();
      const resource = new TestResource(instance, logger);
      const schema = z.object({ name: z.string() });

      const result = resource.arrayResponse([], schema, "test-context");

      expect(result).toEqual([]);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("emits nothing when every item validates", () => {
      const { instance } = createTrackedAxios();
      const logger = createMockLogger();
      const resource = new TestResource(instance, logger);
      const schema = z.object({ name: z.string() });

      const result = resource.arrayResponse(
        [{ name: "Alice" }],
        schema,
        "test-context",
      );

      expect(result).toEqual([{ name: "Alice" }]);
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("coerceSchema", () => {
    it("is a type-only cast: the returned schema still validates against its real (runtime) shape", () => {
      const schema = z.object({ name: z.string() });
      const coerced = coerceSchema<{ name: string }>(schema);

      expect(coerced.safeParse({ name: "Alice" }).success).toBe(true);
    });
  });
});
