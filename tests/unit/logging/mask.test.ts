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

    expect(sink).toHaveBeenCalledWith("no meta here", undefined);
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
});
