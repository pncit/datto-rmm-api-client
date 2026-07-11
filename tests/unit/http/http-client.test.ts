import axios, { type AxiosResponse } from "axios";
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

import { DEFAULT_RETRY, MAX_RETRY_AFTER_MS } from "@/defaults";
import { DattoApiError } from "@/errors";
import { createHttpClient, isRateLimitBlock } from "@/http/http-client";
import type {
  DattoHttpErrorEvent,
  DattoHttpObserver,
  DattoHttpRequestEvent,
  DattoHttpResponseEvent,
} from "@/http/http-observer";
import { MultiWindowRateLimiter } from "@/rate-limit/rate-limiter";

const BASE_URL = "https://zinfandel-api.example.com";

function client(
  overrides: Partial<Parameters<typeof createHttpClient>[0]> = {},
) {
  return createHttpClient({
    apiUrl: BASE_URL,
    rateLimiter: new MultiWindowRateLimiter(),
    ...overrides,
  });
}

describe("createHttpClient", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it("returns the body on a 2xx response", async () => {
    const scope = nock(BASE_URL).get("/foo").reply(200, { ok: true });

    const response = await client().get("/foo", {
      rateDescriptor: { kind: "read" },
    });

    expect(response.data).toEqual({ ok: true });
    expect(scope.isDone()).toBe(true);
  });

  it("honors a 429 Retry-After header in delta-seconds form by retrying after the delay", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .reply(429, { message: "slow down" }, { "Retry-After": "1" })
      .get("/foo")
      .reply(200, { ok: true });

    const response = await client().get("/foo", {
      rateDescriptor: { kind: "read" },
    });

    expect(response.data).toEqual({ ok: true });
    expect(scope.isDone()).toBe(true);
  }, 10_000);

  it("honors a 429 Retry-After header in HTTP-date form by retrying after the delay", async () => {
    const retryAt = new Date(Date.now() + 1000).toUTCString();
    const scope = nock(BASE_URL)
      .get("/foo")
      .reply(429, { message: "slow down" }, { "Retry-After": retryAt })
      .get("/foo")
      .reply(200, { ok: true });

    const response = await client().get("/foo", {
      rateDescriptor: { kind: "read" },
    });

    expect(response.data).toEqual({ ok: true });
    expect(scope.isDone()).toBe(true);
  }, 10_000);

  it("falls back to computed backoff when Retry-After is unparseable", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .reply(
        429,
        { message: "slow down" },
        { "Retry-After": "not-a-valid-header" },
      )
      .get("/foo")
      .reply(200, { ok: true });

    const response = await client({
      retry: { baseDelayMs: 1, maxDelayMs: 5 },
    }).get("/foo", {
      rateDescriptor: { kind: "read" },
    });

    expect(response.data).toEqual({ ok: true });
    expect(scope.isDone()).toBe(true);
  });

  it("throws DattoApiError with retryAfterMs instead of sleeping when Retry-After exceeds MAX_RETRY_AFTER_MS", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .reply(429, { message: "slow down" }, { "Retry-After": "86400" });

    const start = Date.now();
    const error = await client()
      .get("/foo", { rateDescriptor: { kind: "read" } })
      .catch((e: unknown) => e);
    const elapsedMs = Date.now() - start;

    expect(error).toBeInstanceOf(DattoApiError);
    expect((error as DattoApiError).statusCode).toBe(429);
    expect((error as DattoApiError).retryAfterMs).toBe(86_400 * 1000);
    expect((error as DattoApiError).retryAfterMs).toBeGreaterThan(
      MAX_RETRY_AFTER_MS,
    );
    // Must not have actually slept for the (bounded-out) wait.
    expect(elapsedMs).toBeLessThan(MAX_RETRY_AFTER_MS);
    expect(scope.isDone()).toBe(true);
  });

  it("throws DattoApiError classified ip-block for a 403 carrying a rate/block marker", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .reply(403, { message: "IP blocked due to rate limit violations" });

    const error = await client()
      .get("/foo", { rateDescriptor: { kind: "read" } })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DattoApiError);
    expect((error as DattoApiError).statusCode).toBe(403);
    expect((error as DattoApiError).code).toBe("ip-block");
    expect((error as DattoApiError).response).toEqual({
      message: "IP blocked due to rate limit violations",
    });
    expect(scope.isDone()).toBe(true);
  });

  it("classifies ip-block via a Retry-After header alone, without a body wording match, and carries its retryAfterMs/requestId", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .reply(
        403,
        { message: "insufficient scope" },
        { "Retry-After": "5", "x-request-id": "req-403-block" },
      );

    const error = await client()
      .get("/foo", { rateDescriptor: { kind: "read" } })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DattoApiError);
    expect((error as DattoApiError).code).toBe("ip-block");
    expect((error as DattoApiError).retryAfterMs).toBe(5000);
    expect((error as DattoApiError).requestId).toBe("req-403-block");
    expect(scope.isDone()).toBe(true);
  });

  it("carries a server-supplied request id on a 403 without a rate/block marker", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .reply(
        403,
        { message: "insufficient scope" },
        { "x-request-id": "req-403-forbidden" },
      );

    const error = await client()
      .get("/foo", { rateDescriptor: { kind: "read" } })
      .catch((e: unknown) => e);

    expect((error as DattoApiError).code).toBe("forbidden");
    expect((error as DattoApiError).retryAfterMs).toBeUndefined();
    expect((error as DattoApiError).requestId).toBe("req-403-forbidden");
    expect(scope.isDone()).toBe(true);
  });

  it("throws DattoApiError classified forbidden for a 403 without a rate/block marker", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .reply(403, { message: "insufficient scope" });

    const error = await client()
      .get("/foo", { rateDescriptor: { kind: "read" } })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DattoApiError);
    expect((error as DattoApiError).statusCode).toBe(403);
    expect((error as DattoApiError).code).toBe("forbidden");
    expect((error as DattoApiError).response).toEqual({
      message: "insufficient scope",
    });
    expect(scope.isDone()).toBe(true);
  });

  it("never retries a 403", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .reply(403, { message: "insufficient scope" });

    await client()
      .get("/foo", { rateDescriptor: { kind: "read" } })
      .catch(() => undefined);

    // Only one interceptor registered — if the client had retried, this would fail (no
    // matching interceptor left for a second request).
    expect(scope.isDone()).toBe(true);
  });

  it("retries a 5xx exactly DEFAULT_RETRY.maxAttempts times, bounded by DEFAULT_RETRY.baseDelayMs/maxDelayMs", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .times(DEFAULT_RETRY.maxAttempts)
      .reply(503, { message: "unavailable" });

    const start = Date.now();
    const error = await client()
      .get("/foo", { rateDescriptor: { kind: "read" } })
      .catch((e: unknown) => e);
    const elapsedMs = Date.now() - start;

    expect(error).toBeInstanceOf(DattoApiError);
    expect((error as DattoApiError).statusCode).toBe(503);
    expect(scope.isDone()).toBe(true);

    // 2 retries: baseDelayMs + baseDelayMs*2 (no jitter), well under a generous ceiling.
    const expectedMinDelay =
      DEFAULT_RETRY.baseDelayMs + DEFAULT_RETRY.baseDelayMs * 2;
    expect(elapsedMs).toBeGreaterThanOrEqual(expectedMinDelay - 50);
  });

  it("clamps exponential backoff at retry.maxDelayMs instead of growing unbounded", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .times(3)
      .reply(503, { message: "unavailable" });

    const start = Date.now();
    const error = await client({
      retry: { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 250 },
    })
      .get("/foo", { rateDescriptor: { kind: "read" } })
      .catch((e: unknown) => e);
    const elapsedMs = Date.now() - start;

    expect(error).toBeInstanceOf(DattoApiError);
    expect((error as DattoApiError).statusCode).toBe(503);
    expect(scope.isDone()).toBe(true);

    // Uncapped delays would be 200ms + 400ms = 600ms; the second retry's delay must be
    // clamped to maxDelayMs (250ms), for a clamped total of 200ms + 250ms = 450ms.
    expect(elapsedMs).toBeGreaterThanOrEqual(450 - 50);
    expect(elapsedMs).toBeLessThan(550);
  });

  it("throws DattoApiError with retryAfterMs when 429 retries are exhausted", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .times(DEFAULT_RETRY.maxAttempts)
      .reply(
        429,
        { message: "slow down" },
        { "Retry-After": "0", "x-request-id": "req-429-exhausted" },
      );

    const error = await client()
      .get("/foo", { rateDescriptor: { kind: "read" } })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DattoApiError);
    expect((error as DattoApiError).statusCode).toBe(429);
    expect((error as DattoApiError).retryAfterMs).toBe(0);
    expect((error as DattoApiError).requestId).toBe("req-429-exhausted");
    expect(scope.isDone()).toBe(true);
  });

  it("honors an explicit retry.maxAttempts override over the default", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .once()
      .reply(503, { message: "unavailable" });

    const error = await client({
      retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 5 },
    })
      .get("/foo", { rateDescriptor: { kind: "read" } })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DattoApiError);
    expect(scope.isDone()).toBe(true);
  });

  it("does not retry a plain 4xx (not 429/403)", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .once()
      .reply(404, { message: "not found" });

    const error = await client()
      .get("/foo", { rateDescriptor: { kind: "read" } })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DattoApiError);
    expect((error as DattoApiError).statusCode).toBe(404);
    expect(scope.isDone()).toBe(true);
  });

  it("defaults an untagged request to a read rate-limit descriptor", async () => {
    const rateLimiter = new MultiWindowRateLimiter();
    const acquireSpy = vi.spyOn(rateLimiter, "acquire");
    const scope = nock(BASE_URL).get("/foo").reply(200, { ok: true });

    await createHttpClient({ apiUrl: BASE_URL, rateLimiter }).get("/foo");

    expect(acquireSpy).toHaveBeenCalledWith({ kind: "read" });
    expect(scope.isDone()).toBe(true);
  });

  it("sets the default User-Agent header, appending userAgentExtra when provided", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .matchHeader("User-Agent", "datto-rmm-api-client my-app/1.0")
      .reply(200, { ok: true });

    await client({ userAgentExtra: "my-app/1.0" }).get("/foo", {
      rateDescriptor: { kind: "read" },
    });

    expect(scope.isDone()).toBe(true);
  });

  it("applies the default request timeout when none is configured", () => {
    expect(client().defaults.timeout).toBeGreaterThan(0);
  });

  it("treats a request exceeding timeoutMs as a retryable transport failure", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .delay(50)
      .reply(200, { ok: true })
      .get("/foo")
      .reply(200, { ok: true });

    const response = await client({
      timeoutMs: 10,
      retry: { baseDelayMs: 1, maxDelayMs: 5 },
    }).get("/foo", { rateDescriptor: { kind: "read" } });

    expect(response.data).toEqual({ ok: true });
    expect(scope.isDone()).toBe(true);
  }, 10_000);

  it("does not attach the raw AxiosError (with the Bearer header) as the thrown error's cause", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .times(DEFAULT_RETRY.maxAttempts)
      .reply(503, { message: "unavailable" });

    const error = await client({ retry: { baseDelayMs: 1, maxDelayMs: 5 } })
      .get("/foo", {
        rateDescriptor: { kind: "read" },
        headers: { Authorization: "Bearer super-secret-token" },
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DattoApiError);
    const serializedCause = JSON.stringify((error as DattoApiError).cause);
    expect(serializedCause).not.toContain("super-secret-token");
    expect(scope.isDone()).toBe(true);
  });

  it("invokes onUnauthorized and retries exactly once on a 401, then succeeds", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .reply(401, { message: "token expired" })
      .get("/foo")
      .reply(200, { ok: true });

    const onUnauthorized = vi.fn().mockResolvedValue(undefined);
    const response = await client({ onUnauthorized }).get("/foo", {
      rateDescriptor: { kind: "read" },
    });

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(response.data).toEqual({ ok: true });
    expect(scope.isDone()).toBe(true);
  });

  it("does not retry a 401 more than once even with onUnauthorized configured", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .twice()
      .reply(401, { message: "token expired" });

    const onUnauthorized = vi.fn().mockResolvedValue(undefined);
    const error = await client({ onUnauthorized })
      .get("/foo", { rateDescriptor: { kind: "read" } })
      .catch((e: unknown) => e);

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(DattoApiError);
    expect((error as DattoApiError).statusCode).toBe(401);
    expect(scope.isDone()).toBe(true);
  });

  it("throws a plain DattoApiError for a 401 when no onUnauthorized hook is configured", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .reply(401, { message: "token expired" });

    const error = await client()
      .get("/foo", { rateDescriptor: { kind: "read" } })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DattoApiError);
    expect((error as DattoApiError).statusCode).toBe(401);
    expect(scope.isDone()).toBe(true);
  });

  it("logs a debug event for each backoff retry and a warn event when a 429 wait is abandoned", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const scope = nock(BASE_URL)
      .get("/foo")
      .times(DEFAULT_RETRY.maxAttempts)
      .reply(503, { message: "unavailable" });

    const error = await client({
      logger,
      retry: { baseDelayMs: 1, maxDelayMs: 5 },
    })
      .get("/foo", { rateDescriptor: { kind: "read" } })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DattoApiError);
    expect(logger.debug).toHaveBeenCalled();
    const [, meta] = logger.debug.mock.calls[0]!;
    expect(meta).toMatchObject({ status: 503 });
    expect(scope.isDone()).toBe(true);
  });

  it("propagates an already-typed DattoApiError thrown by an upstream request interceptor unchanged", async () => {
    const instance = client();
    const upstreamError = new DattoApiError(
      "Datto RMM authentication failed",
      { statusCode: 503, response: { message: "grant unavailable" } },
    );
    instance.interceptors.request.use(() => {
      throw upstreamError;
    });

    const error = await instance
      .get("/foo", { rateDescriptor: { kind: "read" } })
      .catch((e: unknown) => e);

    expect(error).toBe(upstreamError);
    expect((error as DattoApiError).statusCode).toBe(503);
    expect((error as DattoApiError).response).toEqual({
      message: "grant unavailable",
    });
  });

  it("logs a warn event when a 429 wait exceeds MAX_RETRY_AFTER_MS", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const scope = nock(BASE_URL)
      .get("/foo")
      .reply(429, { message: "slow down" }, { "Retry-After": "86400" });

    await client({ logger })
      .get("/foo", { rateDescriptor: { kind: "read" } })
      .catch((e: unknown) => e);

    expect(logger.warn).toHaveBeenCalled();
    expect(scope.isDone()).toBe(true);
  });
});

/** Discriminated-union tuple for captured observer events — indexing narrows via the
 * discriminant (`event[0]`), so recovering the concrete payload never needs an `as` cast. */
type ObserverEvent =
  | ["request", DattoHttpRequestEvent]
  | ["response", DattoHttpResponseEvent]
  | ["error", DattoHttpErrorEvent];

function requestPayload(event: ObserverEvent | undefined): DattoHttpRequestEvent {
  if (!event || event[0] !== "request") {
    throw new Error(`expected a "request" event, got ${event?.[0] ?? "undefined"}`);
  }
  return event[1];
}

function responsePayload(event: ObserverEvent | undefined): DattoHttpResponseEvent {
  if (!event || event[0] !== "response") {
    throw new Error(`expected a "response" event, got ${event?.[0] ?? "undefined"}`);
  }
  return event[1];
}

function errorPayload(event: ObserverEvent | undefined): DattoHttpErrorEvent {
  if (!event || event[0] !== "error") {
    throw new Error(`expected an "error" event, got ${event?.[0] ?? "undefined"}`);
  }
  return event[1];
}

describe("createHttpClient — httpObserver", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  /**
   * Builds an instrumented client and — mirroring `AuthManager.attachTo`, which registers its
   * Bearer request interceptor on the shared instance *after* `createHttpClient` returns — adds
   * a Bearer request interceptor after the fact, so the observer (registered first, inside
   * `createHttpClient`) still observes it under axios's LIFO ordering (design Decision 5).
   */
  function observerClient(
    httpObserver: DattoHttpObserver,
    overrides: Partial<Parameters<typeof createHttpClient>[0]> = {},
  ) {
    const instance = createHttpClient({
      apiUrl: BASE_URL,
      rateLimiter: new MultiWindowRateLimiter(),
      httpObserver,
      ...overrides,
    });
    instance.interceptors.request.use((requestConfig) => {
      requestConfig.headers.set("Authorization", "Bearer test-token");
      return requestConfig;
    });
    return instance;
  }

  it("fires onRequest then onResponse for a 2xx read, observing the Bearer header and a numeric durationMs", async () => {
    const scope = nock(BASE_URL).get("/foo").reply(200, { ok: true });
    const events: ObserverEvent[] = [];
    const observer: DattoHttpObserver = {
      onRequest: (e) => events.push(["request", e]),
      onResponse: (e) => events.push(["response", e]),
    };

    const response = await observerClient(observer).get("/foo", {
      rateDescriptor: { kind: "read" },
    });

    expect(response.data).toEqual({ ok: true });
    expect(events.map(([kind]) => kind)).toEqual(["request", "response"]);
    const requestEvent = requestPayload(events[0]);
    expect(requestEvent.headers.Authorization).toBe("Bearer test-token");
    const responseEvent = responsePayload(events[1]);
    expect(responseEvent.statusCode).toBe(200);
    expect(responseEvent.responseBody).toEqual({ ok: true });
    expect(typeof responseEvent.durationMs).toBe("number");
    expect(responseEvent.durationMs).toBeGreaterThanOrEqual(0);
    expect(scope.isDone()).toBe(true);
  });

  it("fires onRequest twice and yields onError(429) then onResponse(200) across a retried attempt", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .reply(429, { message: "slow down" }, { "Retry-After": "0" })
      .get("/foo")
      .reply(200, { ok: true });

    const events: ObserverEvent[] = [];
    const observer: DattoHttpObserver = {
      onRequest: (e) => events.push(["request", e]),
      onResponse: (e) => events.push(["response", e]),
      onError: (e) => events.push(["error", e]),
    };

    const response = await observerClient(observer).get("/foo", {
      rateDescriptor: { kind: "read" },
    });

    expect(response.data).toEqual({ ok: true });
    expect(events.map(([kind]) => kind)).toEqual([
      "request",
      "error",
      "request",
      "response",
    ]);
    const errorEvent = errorPayload(events[1]);
    expect(errorEvent.statusCode).toBe(429);
    const responseEvent = responsePayload(events[3]);
    expect(responseEvent.statusCode).toBe(200);
    expect(scope.isDone()).toBe(true);
  }, 10_000);

  it("fires onRequest, onError(401), onRequest, onResponse(200) for a transparently-retried 401 with an onUnauthorized hook", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .reply(401, { message: "unauthorized" })
      .get("/foo")
      .reply(200, { ok: true });

    const events: ObserverEvent[] = [];
    const observer: DattoHttpObserver = {
      onRequest: (e) => events.push(["request", e]),
      onResponse: (e) => events.push(["response", e]),
      onError: (e) => events.push(["error", e]),
    };
    const onUnauthorized = vi.fn().mockResolvedValue(undefined);

    const response = await observerClient(observer, { onUnauthorized }).get(
      "/foo",
      { rateDescriptor: { kind: "read" } },
    );

    expect(response.data).toEqual({ ok: true });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(events.map(([kind]) => kind)).toEqual([
      "request",
      "error",
      "request",
      "response",
    ]);
    const errorEvent = errorPayload(events[1]);
    expect(errorEvent.statusCode).toBe(401);
    const responseEvent = responsePayload(events[3]);
    expect(responseEvent.statusCode).toBe(200);
    expect(scope.isDone()).toBe(true);
  });

  it("delivers a JSON write's body/requestBody as the pre-serialization object, not the serialized string", async () => {
    const scope = nock(BASE_URL)
      .post("/foo", { name: "widget" })
      .reply(201, { id: 1 });
    const requestEvents: DattoHttpRequestEvent[] = [];
    let responseEvent: DattoHttpResponseEvent | undefined;
    const observer: DattoHttpObserver = {
      onRequest: (e) => requestEvents.push(e),
      onResponse: (e) => {
        responseEvent = e;
      },
    };

    await observerClient(observer).post(
      "/foo",
      { name: "widget" },
      { rateDescriptor: { kind: "write" } },
    );

    expect(requestEvents).toHaveLength(1);
    expect(requestEvents[0]!.body).toEqual({ name: "widget" });
    expect(typeof requestEvents[0]!.body).not.toBe("string");
    // The terminal event's requestHeaders/requestBody are the same stashed capture onRequest saw
    // for this attempt — not a re-read of axios's post-transformRequest `response.config`.
    expect(responseEvent?.requestHeaders).toEqual(requestEvents[0]!.headers);
    expect(responseEvent?.requestBody).toEqual({ name: "widget" });
    expect(scope.isDone()).toBe(true);
  });

  it("delivers the absolute resolved URL on every event, never a bare relative path", async () => {
    const scope = nock(BASE_URL).get("/foo/bar").reply(200, { ok: true });
    const urls: string[] = [];
    const observer: DattoHttpObserver = {
      onRequest: (e) => urls.push(e.url),
      onResponse: (e) => urls.push(e.url),
    };

    await observerClient(observer).get("/foo/bar", {
      rateDescriptor: { kind: "read" },
    });

    expect(urls).toEqual([`${BASE_URL}/foo/bar`, `${BASE_URL}/foo/bar`]);
    expect(scope.isDone()).toBe(true);
  });

  it("includes the serialized params query string in the observed url, matching what axios dispatches (instance.getUri)", async () => {
    const scope = nock(BASE_URL)
      .get("/devices")
      .query({ siteId: "42", filter: "online" })
      .reply(200, { ok: true });
    const requestEvents: DattoHttpRequestEvent[] = [];
    const observer: DattoHttpObserver = {
      onRequest: (e) => requestEvents.push(e),
    };

    await observerClient(observer).get("/devices", {
      params: { siteId: "42", filter: "online" },
      rateDescriptor: { kind: "read" },
    });

    expect(requestEvents).toHaveLength(1);
    expect(requestEvents[0]!.url).toBe(
      `${BASE_URL}/devices?siteId=42&filter=online`,
    );
    expect(scope.isDone()).toBe(true);
  });

  it("observes a paginate-style first page's params-carried query string in url, mirroring BaseResource.paginate's first request", async () => {
    // Mirrors `BaseResource.paginate`'s first-page dispatch — `this.axios.get(startPath, { params:
    // pageParams, rateDescriptor })` — which is the one page whose cursor/filter state travels via
    // `params:` rather than being pre-inlined into the URL (subsequent pages inline
    // `pathname + search` from the server's `nextPageUrl` into `url` directly).
    const scope = nock(BASE_URL)
      .get("/audit-log")
      .query({ pageSize: "100" })
      .reply(200, { pageDetails: { nextPageUrl: null }, entries: [] });
    const requestEvents: DattoHttpRequestEvent[] = [];
    const observer: DattoHttpObserver = {
      onRequest: (e) => requestEvents.push(e),
    };

    await observerClient(observer).get("/audit-log", {
      params: { pageSize: 100 },
      rateDescriptor: { kind: "read" },
    });

    expect(requestEvents).toHaveLength(1);
    expect(requestEvents[0]!.url).toBe(`${BASE_URL}/audit-log?pageSize=100`);
    expect(scope.isDone()).toBe(true);
  });

  it("fires onError with the raw thrown error and no statusCode for a transport failure (no response)", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .times(DEFAULT_RETRY.maxAttempts)
      .replyWithError("boom");
    const errorEvents: DattoHttpErrorEvent[] = [];
    const observer: DattoHttpObserver = { onError: (e) => errorEvents.push(e) };

    const error = await observerClient(observer, {
      retry: { baseDelayMs: 1, maxDelayMs: 5 },
    })
      .get("/foo", { rateDescriptor: { kind: "read" } })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DattoApiError);
    expect(errorEvents.length).toBe(DEFAULT_RETRY.maxAttempts);
    for (const event of errorEvents) {
      expect(event.statusCode).toBeUndefined();
      expect(event.error).not.toBeInstanceOf(DattoApiError);
      expect(axios.isAxiosError(event.error)).toBe(true);
    }
    expect(scope.isDone()).toBe(true);
  });

  it("fires onError whose error is the raw AxiosError with statusCode present for a non-2xx", async () => {
    const scope = nock(BASE_URL)
      .get("/foo")
      .once()
      .reply(404, { message: "not found" });
    const errorEvents: DattoHttpErrorEvent[] = [];
    const observer: DattoHttpObserver = { onError: (e) => errorEvents.push(e) };

    const error = await observerClient(observer)
      .get("/foo", { rateDescriptor: { kind: "read" } })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DattoApiError);
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.statusCode).toBe(404);
    expect(errorEvents[0]!.error).not.toBeInstanceOf(DattoApiError);
    expect(axios.isAxiosError(errorEvents[0]!.error)).toBe(true);
    expect(scope.isDone()).toBe(true);
  });

  it("excludes rate-limiter throttle wait from durationMs", async () => {
    const rateLimiter = new MultiWindowRateLimiter();
    vi.spyOn(rateLimiter, "acquire").mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 200)),
    );
    const scope = nock(BASE_URL).get("/foo").reply(200, { ok: true });
    let responseEvent: DattoHttpResponseEvent | undefined;
    const observer: DattoHttpObserver = {
      onResponse: (e) => {
        responseEvent = e;
      },
    };

    await observerClient(observer, { rateLimiter }).get("/foo", {
      rateDescriptor: { kind: "read" },
    });

    expect(responseEvent).toBeDefined();
    expect(responseEvent!.durationMs).toBeLessThan(150);
    expect(scope.isDone()).toBe(true);
  }, 10_000);

  it("delivers a terminal onError to an onError-only observer on a dispatched non-2xx, with requestHeaders/requestBody/durationMs from the stash", async () => {
    const scope = nock(BASE_URL)
      .post("/foo", { name: "widget" })
      .reply(500, { message: "boom" });
    const errorEvents: DattoHttpErrorEvent[] = [];
    const observer: DattoHttpObserver = { onError: (e) => errorEvents.push(e) };

    const error = await observerClient(observer, { retry: { maxAttempts: 1 } })
      .post(
        "/foo",
        { name: "widget" },
        { rateDescriptor: { kind: "write" } },
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DattoApiError);
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.requestHeaders.Authorization).toBe(
      "Bearer test-token",
    );
    expect(errorEvents[0]!.requestBody).toEqual({ name: "widget" });
    expect(typeof errorEvents[0]!.durationMs).toBe("number");
    expect(scope.isDone()).toBe(true);
  });

  it("swallows a throwing onRequest and a rejecting onResponse without altering the request outcome, logging one warn each", async () => {
    const scope = nock(BASE_URL).get("/foo").reply(200, { ok: true });
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const observer: DattoHttpObserver = {
      onRequest: () => {
        throw new Error("boom");
      },
      onResponse: () => Promise.reject(new Error("nope")),
    };

    const response = await observerClient(observer, { logger }).get("/foo", {
      rateDescriptor: { kind: "read" },
    });
    // Flush the microtask queue so the rejected onResponse's swallow-warn has run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(response.data).toEqual({ ok: true });
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(scope.isDone()).toBe(true);
  });

  it("registers no interceptor and does not stash a capture when httpObserver is absent", async () => {
    const scope = nock(BASE_URL).get("/foo").reply(200, { ok: true });
    const instance = createHttpClient({
      apiUrl: BASE_URL,
      rateLimiter: new MultiWindowRateLimiter(),
    });

    const response = await instance.get("/foo", {
      rateDescriptor: { kind: "read" },
    });

    expect(response.data).toEqual({ ok: true });
    expect(response.config.__dattoObserverCapture).toBeUndefined();
    expect(scope.isDone()).toBe(true);
  });
});

describe("isRateLimitBlock", () => {
  it("is false for an undefined response", () => {
    expect(isRateLimitBlock(undefined)).toBe(false);
  });

  it("is true when the response carries a Retry-After header, even without a body wording match", () => {
    expect(
      isRateLimitBlock({
        status: 403,
        statusText: "Forbidden",
        data: { message: "insufficient scope" },
        headers: { "Retry-After": "5" },
        config: {} as AxiosResponse["config"],
      } as AxiosResponse),
    ).toBe(true);
  });
});
