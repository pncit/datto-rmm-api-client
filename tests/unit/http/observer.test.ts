import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import { describe, expect, it, vi } from "vitest";

import {
  dattoHttpObserverSchema,
  type DattoHttpErrorEvent,
  type DattoHttpObserver,
  type DattoHttpRequestEvent,
  type DattoHttpResponseEvent,
} from "@/http/http-observer";
import {
  captureRequest,
  fireError,
  fireRequest,
  fireResponse,
  invokeObserver,
  normalizeHeaders,
} from "@/http/observer";
import type { DattoLogger } from "@/logging/logger";

function fakeLogger(): DattoLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function fakeAxiosResponse(overrides: Partial<AxiosResponse> = {}): AxiosResponse {
  return {
    status: 200,
    statusText: "OK",
    headers: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: {} as any,
    data: undefined,
    ...overrides,
  } as AxiosResponse;
}

describe("normalizeHeaders", () => {
  it("flattens an AxiosHeaders instance to a plain record", () => {
    const headers = new AxiosHeaders();
    headers.set("Content-Type", "application/json");
    headers.set("Authorization", "Bearer abc123");

    expect(normalizeHeaders(headers)).toEqual(headers.toJSON());
  });

  it("passes a plain object through unchanged", () => {
    const headers = { "x-custom": "value" };

    expect(normalizeHeaders(headers)).toEqual(headers);
  });

  it("returns an empty object when headers are absent", () => {
    expect(normalizeHeaders(undefined)).toEqual({});
  });
});

describe("captureRequest", () => {
  it("uppercases the method", () => {
    const capture = captureRequest({
      method: "get",
      url: "https://api.example.com/foo",
      headers: {},
      body: undefined,
    });

    expect(capture.method).toBe("GET");
  });

  it("defaults to GET when method is undefined", () => {
    const capture = captureRequest({
      method: undefined,
      url: "https://api.example.com/foo",
      headers: {},
      body: undefined,
    });

    expect(capture.method).toBe("GET");
  });

  it("normalizes an AxiosHeaders argument", () => {
    const headers = new AxiosHeaders();
    headers.set("X-Test", "value");

    const capture = captureRequest({
      method: "post",
      url: "https://api.example.com/foo",
      headers,
      body: { a: 1 },
    });

    expect(capture.headers).toEqual(headers.toJSON());
  });

  it("preserves the absolute url it is handed verbatim", () => {
    const url = "https://zinfandel-api.example.com/api/v2/account";
    const capture = captureRequest({
      method: "get",
      url,
      headers: {},
      body: undefined,
    });

    expect(capture.url).toBe(url);
  });

  it("stamps a numeric startedAt", () => {
    const before = Date.now();
    const capture = captureRequest({
      method: "get",
      url: "https://api.example.com/foo",
      headers: {},
      body: undefined,
    });
    const after = Date.now();

    expect(typeof capture.startedAt).toBe("number");
    expect(capture.startedAt).toBeGreaterThanOrEqual(before);
    expect(capture.startedAt).toBeLessThanOrEqual(after);
  });
});

/** A stand-in event shape for `invokeObserver`'s generic-over-`E` tests below — any object shape
 * works since `invokeObserver` never inspects the event, it only forwards it to `fn`. */
type TestEvent = { some: string };

describe("invokeObserver", () => {
  it("is a no-op when the callback is undefined", () => {
    const logger = fakeLogger();

    expect(() =>
      invokeObserver<TestEvent>(logger, "onRequest", undefined, {
        some: "event",
      }),
    ).not.toThrow();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("swallows a synchronous throw and logs exactly one warn naming the callback", () => {
    const logger = fakeLogger();
    const fn = (() => {
      throw new Error("callback boom");
    }) as unknown as (event: TestEvent) => void;

    expect(() =>
      invokeObserver(logger, "onError", fn, { some: "event" }),
    ).not.toThrow();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("onError"),
      expect.objectContaining({ callback: "onError" }),
    );
  });

  it("swallows a returned rejected promise and logs one warn naming the callback, with no unhandled rejection", async () => {
    const logger = fakeLogger();
    const fn = (() =>
      Promise.reject(new Error("async boom"))) as unknown as (
      event: TestEvent,
    ) => void;

    expect(() =>
      invokeObserver(logger, "onResponse", fn, { some: "event" }),
    ).not.toThrow();

    // Flush the microtask queue so the attached rejection handler runs.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("onResponse"),
      expect.objectContaining({ callback: "onResponse" }),
    );
  });

  it("never awaits — returns before a slow-resolving callback promise settles", () => {
    const logger = fakeLogger();
    let settled = false;
    const fn = (() =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          settled = true;
          resolve();
        }, 50);
      })) as unknown as (event: TestEvent) => void;

    invokeObserver(logger, "onRequest", fn, { some: "event" });

    expect(settled).toBe(false);
  });

  it("guards a throwing logger.warn so it neither escapes nor leaves an unhandled rejection (Cluster 3)", async () => {
    const throwingLogger: DattoLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(() => {
        throw new Error("logger itself is broken");
      }),
      error: vi.fn(),
    };

    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      // Synchronous-throw path: a throwing logger.warn must not escape invokeObserver.
      const throwingFn = (() => {
        throw new Error("callback boom");
      }) as unknown as (event: TestEvent) => void;
      expect(() =>
        invokeObserver(throwingLogger, "onError", throwingFn, {
          some: "event",
        }),
      ).not.toThrow();

      // Rejected-promise path: a throwing logger.warn inside the .then rejection handler must
      // not produce an unhandled rejection.
      const rejectingFn = (() =>
        Promise.reject(new Error("async boom"))) as unknown as (
        event: TestEvent,
      ) => void;
      expect(() =>
        invokeObserver(throwingLogger, "onResponse", rejectingFn, {
          some: "event",
        }),
      ).not.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(unhandledRejections).toHaveLength(0);
  });
});

describe("invokeObserver on a schema-parsed callback (R7 regression — f1/f2)", () => {
  // These callbacks are obtained THROUGH dattoHttpObserverSchema.parse, not hand-built raw
  // functions — this is the path the wired client actually uses (validated.httpObserver).
  // A wrapping/validating schema (e.g. zod's z.function) would defeat R7 here; this test must
  // fail against such a schema and pass against a non-wrapping, shape-only one.

  const requestEvent: DattoHttpRequestEvent = {
    method: "GET",
    url: "https://api.example.com/foo",
    headers: {},
    body: undefined,
  };

  const responseEvent: DattoHttpResponseEvent = {
    method: "GET",
    url: "https://api.example.com/foo",
    requestHeaders: {},
    requestBody: undefined,
    statusCode: 200,
    responseHeaders: {},
    responseBody: undefined,
    durationMs: 5,
  };

  it("does not warn when a parsed callback returns a non-undefined value", () => {
    const logger = fakeLogger();
    const received: unknown[] = [];
    const parsed = dattoHttpObserverSchema.parse({
      // Idiomatic value-returning callback: Array#push returns the new length (a number).
      onRequest: (event: unknown) => received.push(event),
    });

    invokeObserver(logger, "onRequest", parsed.onRequest, requestEvent);

    expect(received).toEqual([requestEvent]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("produces no unhandled rejection and exactly one warn for a parsed async-rejecting callback", async () => {
    const logger = fakeLogger();
    const parsed = dattoHttpObserverSchema.parse({
      onResponse: async () => {
        throw new Error("async boom");
      },
    });

    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      expect(() =>
        invokeObserver(logger, "onResponse", parsed.onResponse, responseEvent),
      ).not.toThrow();

      // Flush the microtask queue so any attached/unhandled rejection surfaces.
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(unhandledRejections).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("onResponse"),
      expect.objectContaining({ callback: "onResponse" }),
    );
  });

  it("delivers the consumer's original function reference, unchanged, through parse", () => {
    const onRequest = (event: unknown): void => {
      void event;
    };

    const parsed = dattoHttpObserverSchema.parse({ onRequest });

    expect(parsed.onRequest).toBe(onRequest);
  });
});

describe("fireRequest", () => {
  const capture = {
    method: "GET",
    url: "https://api.example.com/foo",
    headers: { "x-test": "value" },
    body: { a: 1 },
    startedAt: Date.now(),
  };

  it("assembles the DattoHttpRequestEvent from the capture", () => {
    const events: DattoHttpRequestEvent[] = [];
    const observer: DattoHttpObserver = { onRequest: (event) => events.push(event) };

    fireRequest(undefined, observer, capture);

    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.method).toBe(capture.method);
    expect(event.url).toBe(capture.url);
    expect(event.headers).toEqual(capture.headers);
    expect(event.body).toEqual(capture.body);
  });

  it("is a no-op when observer is absent", () => {
    expect(() => fireRequest(undefined, undefined, capture)).not.toThrow();
  });

  it("is a no-op when observer carries no onRequest callback", () => {
    expect(() =>
      fireRequest(undefined, { onResponse: () => {} }, capture),
    ).not.toThrow();
  });
});

describe("fireResponse", () => {
  const capture = {
    method: "POST",
    url: "https://api.example.com/foo",
    headers: { "x-test": "value" },
    body: { a: 1 },
    startedAt: Date.now() - 10,
  };

  it("assembles the DattoHttpResponseEvent, normalizing AxiosHeaders and computing durationMs", () => {
    const events: DattoHttpResponseEvent[] = [];
    const observer: DattoHttpObserver = { onResponse: (event) => events.push(event) };
    const response = fakeAxiosResponse({
      status: 200,
      headers: new AxiosHeaders({ "content-type": "application/json" }),
      data: { ok: true },
    });

    fireResponse(undefined, observer, capture, response);

    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.method).toBe(capture.method);
    expect(event.url).toBe(capture.url);
    expect(event.requestHeaders).toEqual(capture.headers);
    expect(event.requestBody).toEqual(capture.body);
    expect(event.statusCode).toBe(200);
    expect(event.responseHeaders).toEqual(
      (response.headers as AxiosHeaders).toJSON(),
    );
    expect(event.responseBody).toEqual({ ok: true });
    expect(event.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("is a no-op when observer is absent", () => {
    const response = fakeAxiosResponse();
    expect(() =>
      fireResponse(undefined, undefined, capture, response),
    ).not.toThrow();
  });

  it("is a no-op when observer carries no onResponse callback", () => {
    const response = fakeAxiosResponse();
    expect(() =>
      fireResponse(undefined, { onRequest: () => {} }, capture, response),
    ).not.toThrow();
  });
});

describe("fireError", () => {
  const capture = {
    method: "GET",
    url: "https://api.example.com/foo",
    headers: {},
    body: undefined,
    startedAt: Date.now(),
  };

  it("hands off the exact AxiosError instance to onError.error, unchanged", () => {
    const events: DattoHttpErrorEvent[] = [];
    const observer: DattoHttpObserver = { onError: (event) => events.push(event) };
    const response = fakeAxiosResponse({
      status: 500,
      headers: new AxiosHeaders({ "x-request-id": "abc" }),
      data: { message: "boom" },
    });
    const err = new AxiosError(
      "Request failed",
      "ERR_BAD_RESPONSE",
      undefined,
      undefined,
      response,
    );

    fireError(undefined, observer, capture, err);

    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.error).toBe(err);
    expect(event.statusCode).toBe(500);
    expect(event.responseHeaders).toEqual(
      (response.headers as AxiosHeaders).toJSON(),
    );
    expect(event.responseBody).toEqual({ message: "boom" });
  });

  it("hands off a plain non-axios Error unchanged, with no response fields", () => {
    const events: DattoHttpErrorEvent[] = [];
    const observer: DattoHttpObserver = { onError: (event) => events.push(event) };
    const err = new Error("network down");

    fireError(undefined, observer, capture, err);

    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.error).toBe(err);
    expect(event.statusCode).toBeUndefined();
    expect(event.responseHeaders).toBeUndefined();
    expect(event.responseBody).toBeUndefined();
  });

  it("is a no-op when observer is absent", () => {
    expect(() =>
      fireError(undefined, undefined, capture, new Error("boom")),
    ).not.toThrow();
  });
});
