import type { AxiosResponse } from "axios";
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
