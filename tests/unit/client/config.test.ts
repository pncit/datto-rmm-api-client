import { describe, expect, it } from "vitest";

import { dattoRmmClientConfigSchema } from "../../../src/client/datto-client-config";
import type { DattoHttpRequestEvent } from "../../../src/http/http-observer";

const MINIMAL_CONFIG = {
  apiUrl: "https://zinfandel-api.centrastage.net",
  apiKey: "key",
  apiSecret: "secret",
};

describe("dattoRmmClientConfigSchema", () => {
  it("accepts a minimal valid config", () => {
    const result = dattoRmmClientConfigSchema.safeParse(MINIMAL_CONFIG);
    expect(result.success).toBe(true);
  });

  it("accepts a fully populated config", () => {
    const result = dattoRmmClientConfigSchema.safeParse({
      ...MINIMAL_CONFIG,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      userAgentExtra: "my-integration/1.0",
      tokenRefreshPct: 25,
      retry: { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 2000 },
      rateLimit: {
        readLimit: 600,
        writeAggregateLimit: 600,
        windowSeconds: 60,
      },
      httpObserver: {
        onRequest: () => {},
        onResponse: () => {},
        onError: () => {},
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an httpObserver with all three raw callbacks, still invocable after parsing", () => {
    const received: unknown[] = [];
    const result = dattoRmmClientConfigSchema.safeParse({
      ...MINIMAL_CONFIG,
      httpObserver: {
        onRequest: (event: unknown) => {
          received.push(event);
        },
        onResponse: (event: unknown) => {
          received.push(event);
        },
        onError: (event: unknown) => {
          received.push(event);
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const { httpObserver } = result.data;
    const rawEvent: DattoHttpRequestEvent = {
      method: "GET",
      url: "https://api.example.com/foo",
      headers: {},
      body: { secret: "bearer-token-value" },
    };
    httpObserver?.onRequest?.(rawEvent);

    // Identity, not just structural equality: parsing must neither clone the payload nor
    // substitute the callback with a wrapper that reconstructs its argument.
    expect(received).toHaveLength(1);
    expect(received[0]).toBe(rawEvent);
  });

  it("rejects an httpObserver carrying an unknown key", () => {
    const result = dattoRmmClientConfigSchema.safeParse({
      ...MINIMAL_CONFIG,
      httpObserver: { onRequest: () => {}, somethingElse: true },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an httpObserver whose callback is not a function", () => {
    const result = dattoRmmClientConfigSchema.safeParse({
      ...MINIMAL_CONFIG,
      httpObserver: { onRequest: "not-a-function" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown top-level key", () => {
    const result = dattoRmmClientConfigSchema.safeParse({
      ...MINIMAL_CONFIG,
      somethingUnexpected: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed apiUrl", () => {
    const result = dattoRmmClientConfigSchema.safeParse({
      ...MINIMAL_CONFIG,
      apiUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty apiKey/apiSecret", () => {
    expect(
      dattoRmmClientConfigSchema.safeParse({ ...MINIMAL_CONFIG, apiKey: "" })
        .success,
    ).toBe(false);
    expect(
      dattoRmmClientConfigSchema.safeParse({ ...MINIMAL_CONFIG, apiSecret: "" })
        .success,
    ).toBe(false);
  });

  it("rejects the retired 0.1.x validationMode field", () => {
    const result = dattoRmmClientConfigSchema.safeParse({
      ...MINIMAL_CONFIG,
      validationMode: "strict",
    });
    expect(result.success).toBe(false);
  });

  it("rejects the retired 0.1.x autoRefresh field", () => {
    const result = dattoRmmClientConfigSchema.safeParse({
      ...MINIMAL_CONFIG,
      autoRefresh: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a never-supported axiosInstance field", () => {
    const result = dattoRmmClientConfigSchema.safeParse({
      ...MINIMAL_CONFIG,
      axiosInstance: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown key inside the retry sub-object", () => {
    const result = dattoRmmClientConfigSchema.safeParse({
      ...MINIMAL_CONFIG,
      retry: { maxAttempts: 3, defaultWriteLimit: 100 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a defaultWriteLimit override on the rateLimit sub-object (R14 anti-pattern)", () => {
    const result = dattoRmmClientConfigSchema.safeParse({
      ...MINIMAL_CONFIG,
      rateLimit: { defaultWriteLimit: 100 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects tokenRefreshPct outside 0..100", () => {
    expect(
      dattoRmmClientConfigSchema.safeParse({
        ...MINIMAL_CONFIG,
        tokenRefreshPct: -1,
      }).success,
    ).toBe(false);
    expect(
      dattoRmmClientConfigSchema.safeParse({
        ...MINIMAL_CONFIG,
        tokenRefreshPct: 101,
      }).success,
    ).toBe(false);
  });
});
