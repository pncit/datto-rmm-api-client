import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import { describe, expect, it, vi } from "vitest";

import type { DattoHttpErrorEvent, DattoHttpObserver } from "@/http/http-observer";
import {
  captureRequest,
  fireError,
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

describe("invokeObserver", () => {
  it("is a no-op when the callback is undefined", () => {
    const logger = fakeLogger();

    expect(() =>
      invokeObserver(logger, "onRequest", undefined, {}),
    ).not.toThrow();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("swallows a synchronous throw and logs exactly one warn naming the callback", () => {
    const logger = fakeLogger();
    const fn = (() => {
      throw new Error("callback boom");
    }) as unknown as (event: never) => void;

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
      event: never,
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
      })) as unknown as (event: never) => void;

    invokeObserver(logger, "onRequest", fn, {});

    expect(settled).toBe(false);
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
