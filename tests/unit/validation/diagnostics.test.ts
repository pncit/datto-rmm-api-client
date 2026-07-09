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

  it("flushes one debug line per distinct (message, field, value) group", () => {
    const collector = new DiagnosticsCollector();
    collector.record(
      "widened response enum",
      "deviceClass",
      "rmmnetworkdevice",
    );
    collector.record(
      "widened response enum",
      "deviceClass",
      "rmmnetworkdevice",
    );
    collector.record("widened response enum", "deviceClass", "quantumdevice");
    collector.record("stripped unknown response property", "extra");

    const debug = vi.fn();
    collector.flush({ debug }, "GET /device", 10);

    expect(debug).toHaveBeenCalledTimes(3);
    expect(debug).toHaveBeenCalledWith(
      "widened response enum",
      expect.objectContaining({
        context: "GET /device",
        field: "deviceClass",
        value: "rmmnetworkdevice",
        count: 2,
        total: 10,
      }),
    );
    expect(debug).toHaveBeenCalledWith(
      "widened response enum",
      expect.objectContaining({
        field: "deviceClass",
        value: "quantumdevice",
        count: 1,
        total: 10,
      }),
    );
    expect(debug).toHaveBeenCalledWith(
      "stripped unknown response property",
      expect.objectContaining({ field: "extra", count: 1, total: 10 }),
    );
  });

  it("omits `value` from meta when a group was recorded without one", () => {
    const collector = new DiagnosticsCollector();
    collector.record("stripped unknown response property", "extra");

    const debug = vi.fn();
    collector.flush({ debug }, "ctx", 1);

    expect(debug.mock.calls[0]?.[1]).not.toHaveProperty("value");
  });

  it("keeps groups without a value separate from groups with one, for the same message/field", () => {
    // Not a realistic call pattern for the two real event kinds (each always passes the same
    // `value` presence), but proves the dedup key does not collide a valued group with an
    // unvalued one at the same (message, field).
    const collector = new DiagnosticsCollector();
    collector.record("event", "field", "a");
    collector.record("event", "field");

    const debug = vi.fn();
    collector.flush({ debug }, "ctx", 5);

    expect(debug).toHaveBeenCalledTimes(2);
  });

  it("clears all groups after flush", () => {
    const collector = new DiagnosticsCollector();
    collector.record("stripped unknown response property", "extra");

    const debug = vi.fn();
    collector.flush({ debug }, "ctx", 1);
    expect(collector.isEmpty).toBe(true);

    debug.mockClear();
    collector.flush({ debug }, "ctx", 1);
    expect(debug).not.toHaveBeenCalled();
  });

  it("flush is a no-op when nothing was recorded", () => {
    const collector = new DiagnosticsCollector();
    const debug = vi.fn();
    collector.flush({ debug }, "ctx", 0);
    expect(debug).not.toHaveBeenCalled();
  });
});
