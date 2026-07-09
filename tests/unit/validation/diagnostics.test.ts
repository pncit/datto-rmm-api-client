import { describe, expect, it, vi } from "vitest";

import { DiagnosticsCollector } from "../../../src/validation/diagnostics";

describe("DiagnosticsCollector", () => {
  it("starts empty", () => {
    const collector = new DiagnosticsCollector();
    expect(collector.isEmpty).toBe(true);
  });

  it("is not empty after a record", () => {
    const collector = new DiagnosticsCollector();
    collector.record("stripped unknown response property", "extra");
    expect(collector.isEmpty).toBe(false);
  });

  it("flushes one line per distinct (message, field, value) group", () => {
    const collector = new DiagnosticsCollector();
    collector.record(
      "widened response enum",
      "deviceClass",
      "rmmnetworkdevice",
      10,
    );
    collector.record(
      "widened response enum",
      "deviceClass",
      "rmmnetworkdevice",
      10,
    );
    collector.record(
      "widened response enum",
      "deviceClass",
      "quantumdevice",
      10,
    );
    collector.record(
      "stripped unknown response property",
      "extra",
      undefined,
      10,
    );

    const sink = vi.fn();
    collector.flush(sink, "GET /device");

    expect(sink).toHaveBeenCalledTimes(3);
    expect(sink).toHaveBeenCalledWith(
      "widened response enum",
      expect.objectContaining({
        context: "GET /device",
        field: "deviceClass",
        value: "rmmnetworkdevice",
        count: 2,
        total: 10,
      }),
    );
    expect(sink).toHaveBeenCalledWith(
      "widened response enum",
      expect.objectContaining({
        field: "deviceClass",
        value: "quantumdevice",
        count: 1,
        total: 10,
      }),
    );
    expect(sink).toHaveBeenCalledWith(
      "stripped unknown response property",
      expect.objectContaining({ field: "extra", count: 1, total: 10 }),
    );
  });

  it("defaults a group's total to 1 when record() is called without one", () => {
    const collector = new DiagnosticsCollector();
    collector.record("stripped unknown response property", "extra");

    const sink = vi.fn();
    collector.flush(sink, "ctx");

    expect(sink).toHaveBeenCalledWith(
      "stripped unknown response property",
      expect.objectContaining({ total: 1 }),
    );
  });

  it("takes the largest total recorded for a group", () => {
    const collector = new DiagnosticsCollector();
    collector.record(
      "stripped unknown response property",
      "extra",
      undefined,
      3,
    );
    collector.record(
      "stripped unknown response property",
      "extra",
      undefined,
      5,
    );
    collector.record(
      "stripped unknown response property",
      "extra",
      undefined,
      2,
    );

    const sink = vi.fn();
    collector.flush(sink, "ctx");

    expect(sink).toHaveBeenCalledWith(
      "stripped unknown response property",
      expect.objectContaining({ count: 3, total: 5 }),
    );
  });

  it("omits `value` from meta when a group was recorded without one", () => {
    const collector = new DiagnosticsCollector();
    collector.record("stripped unknown response property", "extra");

    const sink = vi.fn();
    collector.flush(sink, "ctx");

    expect(sink.mock.calls[0]?.[1]).not.toHaveProperty("value");
  });

  it("keeps groups without a value separate from groups with one, for the same message/field", () => {
    // Not a realistic call pattern for the two real event kinds (each always passes the same
    // `value` presence), but proves the dedup key does not collide a valued group with an
    // unvalued one at the same (message, field).
    const collector = new DiagnosticsCollector();
    collector.record("event", "field", "a", 5);
    collector.record("event", "field", undefined, 5);

    const sink = vi.fn();
    collector.flush(sink, "ctx");

    expect(sink).toHaveBeenCalledTimes(2);
  });

  it("clears all groups after flush", () => {
    const collector = new DiagnosticsCollector();
    collector.record("stripped unknown response property", "extra");

    const sink = vi.fn();
    collector.flush(sink, "ctx");
    expect(collector.isEmpty).toBe(true);

    sink.mockClear();
    collector.flush(sink, "ctx");
    expect(sink).not.toHaveBeenCalled();
  });

  it("flush is a no-op when nothing was recorded", () => {
    const collector = new DiagnosticsCollector();
    const sink = vi.fn();
    collector.flush(sink, "ctx");
    expect(sink).not.toHaveBeenCalled();
  });

  it("supports a level-specific sink so callers can reuse flush at a different log level", () => {
    // Mirrors how Phase 6's per-item drop path (R7, `warn`) can reuse this class unmodified.
    const collector = new DiagnosticsCollector();
    collector.record("dropped invalid response item", "items", undefined, 4);

    const warn = vi.fn();
    const logger = { debug: vi.fn(), warn };
    collector.flush((message, meta) => logger.warn(message, meta), "ctx");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(logger.debug).not.toHaveBeenCalled();
  });
});
