import { describe, expect, it, vi } from "vitest";

import type { DattoLogger } from "../../../src/logging/logger";
import { withUdfMasking } from "../../../src/logging/mask";

function makeSink(): { logger: DattoLogger; sink: ReturnType<typeof vi.fn> } {
  const sink = vi.fn();
  const logger: DattoLogger = {
    debug: sink,
    info: sink,
    warn: sink,
    error: sink,
  };
  return { logger, sink };
}

describe("withUdfMasking", () => {
  it("redacts every non-null udf* value at any nesting depth and preserves everything else (R20)", () => {
    const { logger, sink } = makeSink();
    const masked = withUdfMasking(logger);

    masked.info("device audit", {
      udf: { udf1: "S3CR3T", udf7: null },
      udf3: 12345,
      udf5: "abcd",
      udf9: { key: "BitLockerRecoveryKey" },
      host: "PC1",
    });

    expect(sink).toHaveBeenCalledTimes(1);
    const [message, meta] = sink.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];

    expect(message).toBe("device audit");
    expect(meta).toEqual({
      udf: { udf1: "[redacted - 6 characters]", udf7: null },
      udf3: "[redacted - 5 characters]",
      udf5: "[redacted - 4 characters]",
      udf9: expect.stringMatching(/^\[redacted - \d+ characters\]$/),
      host: "PC1",
    });

    const serializedCalls = JSON.stringify(sink.mock.calls);
    expect(serializedCalls).not.toContain("S3CR3T");
    expect(serializedCalls).not.toContain("12345");
    expect(serializedCalls).not.toContain("BitLockerRecoveryKey");
  });

  it("passes calls through unchanged when no meta is supplied", () => {
    const { logger, sink } = makeSink();
    const masked = withUdfMasking(logger);

    masked.warn("no meta here");

    expect(sink).toHaveBeenCalledWith("no meta here");
    expect(sink.mock.calls[0]).toHaveLength(1);
  });

  it("forwards a no-meta call to the real console-backed default logger as a single argument", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const masked = withUdfMasking(console);

      masked.info("no meta here");

      expect(info).toHaveBeenCalledTimes(1);
      expect(info.mock.calls[0]).toEqual(["no meta here"]);
    } finally {
      info.mockRestore();
    }
  });

  it("wraps all four log levels independently", () => {
    const debug = vi.fn();
    const info = vi.fn();
    const warn = vi.fn();
    const error = vi.fn();
    const masked = withUdfMasking({ debug, info, warn, error });

    masked.debug("d", { udf1: "x" });
    masked.info("i", { udf1: "x" });
    masked.warn("w", { udf1: "x" });
    masked.error("e", { udf1: "x" });

    expect(debug).toHaveBeenCalledWith("d", {
      udf1: "[redacted - 1 characters]",
    });
    expect(info).toHaveBeenCalledWith("i", {
      udf1: "[redacted - 1 characters]",
    });
    expect(warn).toHaveBeenCalledWith("w", {
      udf1: "[redacted - 1 characters]",
    });
    expect(error).toHaveBeenCalledWith("e", {
      udf1: "[redacted - 1 characters]",
    });
  });

  it("masks a udf value nested inside an array", () => {
    const { logger, sink } = makeSink();
    const masked = withUdfMasking(logger);

    masked.info("devices", {
      devices: [{ udf2: "secret-a" }, { udf2: "secret-b" }],
    });

    expect(sink).toHaveBeenCalledWith("devices", {
      devices: [
        { udf2: "[redacted - 8 characters]" },
        { udf2: "[redacted - 8 characters]" },
      ],
    });
  });

  it("passes a Date and an Error under a non-UDF key through intact", () => {
    const { logger, sink } = makeSink();
    const masked = withUdfMasking(logger);
    const since = new Date("2024-01-01T00:00:00.000Z");
    const err = new Error("boom");

    masked.error("grant failed", { since, err, udf1: "secret" });

    expect(sink).toHaveBeenCalledTimes(1);
    const [, meta] = sink.mock.calls[0] as [string, Record<string, unknown>];
    expect(meta.since).toBe(since);
    expect(meta.err).toBe(err);
    expect((meta.err as Error).message).toBe("boom");
    expect(meta.udf1).toBe("[redacted - 6 characters]");
  });

  it("preserves `this` for a logger whose methods are prototype methods bound at call time", () => {
    class RecordingLogger {
      public calls: Array<[string, Record<string, unknown> | undefined]> = [];
      private readonly prefix = "[test] ";

      debug(message: string, meta?: Record<string, unknown>): void {
        this.calls.push([this.prefix + message, meta]);
      }
      info(message: string, meta?: Record<string, unknown>): void {
        this.calls.push([this.prefix + message, meta]);
      }
      warn(message: string, meta?: Record<string, unknown>): void {
        this.calls.push([this.prefix + message, meta]);
      }
      error(message: string, meta?: Record<string, unknown>): void {
        this.calls.push([this.prefix + message, meta]);
      }
    }

    const instance = new RecordingLogger();
    const masked = withUdfMasking(instance);

    expect(() => masked.info("device audit", { udf1: "secret" })).not.toThrow();

    expect(instance.calls).toEqual([
      ["[test] device audit", { udf1: "[redacted - 6 characters]" }],
    ]);
  });

  it("does not throw or overflow the stack on a circular non-UDF plain object", () => {
    const { logger, sink } = makeSink();
    const masked = withUdfMasking(logger);
    const req: Record<string, unknown> = { id: "req-1" };
    req.self = req;

    expect(() =>
      masked.info("device audit", { req, udf1: "secret" }),
    ).not.toThrow();

    expect(sink).toHaveBeenCalledTimes(1);
    const [, meta] = sink.mock.calls[0] as [string, Record<string, unknown>];
    const scrubbedReq = meta.req as Record<string, unknown>;
    expect(scrubbedReq.id).toBe("req-1");
    expect(scrubbedReq.self).toBe("[circular]");
    expect(meta.udf1).toBe("[redacted - 6 characters]");
  });

  it("does not throw on a circular array reachable from meta", () => {
    const { logger, sink } = makeSink();
    const masked = withUdfMasking(logger);
    const items: unknown[] = ["a"];
    items.push(items);

    expect(() => masked.info("devices", { items })).not.toThrow();

    expect(sink).toHaveBeenCalledTimes(1);
    const [, meta] = sink.mock.calls[0] as [string, Record<string, unknown>];
    const scrubbedItems = meta.items as unknown[];
    expect(scrubbedItems[0]).toBe("a");
    expect(scrubbedItems[1]).toBe("[circular]");
  });

  it("walks a shared (non-circular) object reached via two independent branches", () => {
    const { logger, sink } = makeSink();
    const masked = withUdfMasking(logger);
    const shared = { udf1: "secret" };

    masked.info("shared", { a: shared, b: shared });

    expect(sink).toHaveBeenCalledTimes(1);
    const [, meta] = sink.mock.calls[0] as [string, Record<string, unknown>];
    expect(meta.a).toEqual({ udf1: "[redacted - 6 characters]" });
    expect(meta.b).toEqual({ udf1: "[redacted - 6 characters]" });
  });

  it("never throws on a udf value JSON.stringify cannot serialize", () => {
    const { logger, sink } = makeSink();
    const masked = withUdfMasking(logger);
    const circular: Record<string, unknown> = { self: null };
    circular.self = circular;

    expect(() =>
      masked.info("non-serializable", {
        udf1: 10n,
        udf2: Symbol("secret"),
        udf3: () => "secret",
        udf4: circular,
      }),
    ).not.toThrow();

    expect(sink).toHaveBeenCalledTimes(1);
    const [, meta] = sink.mock.calls[0] as [string, Record<string, unknown>];
    for (const key of ["udf1", "udf2", "udf3", "udf4"]) {
      expect(meta[key]).toEqual(
        expect.stringMatching(/^\[redacted - \d+ characters\]$/),
      );
    }
  });
});
