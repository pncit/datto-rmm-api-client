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
    collector.trackExamined("devices", 10);
    collector.record(
      "widened response enum",
      "deviceClass",
      "rmmnetworkdevice",
      "devices",
    );
    collector.record(
      "widened response enum",
      "deviceClass",
      "rmmnetworkdevice",
      "devices",
    );
    collector.record(
      "widened response enum",
      "deviceClass",
      "quantumdevice",
      "devices",
    );
    collector.record(
      "stripped unknown response property",
      "extra",
      undefined,
      "devices",
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

  it("defaults a group's total to 1 when record() is called without a collectionKey", () => {
    const collector = new DiagnosticsCollector();
    collector.record("stripped unknown response property", "extra");

    const sink = vi.fn();
    collector.flush(sink, "ctx");

    expect(sink).toHaveBeenCalledWith(
      "stripped unknown response property",
      expect.objectContaining({ total: 1 }),
    );
  });

  it("defaults a group's total to 1 when its collectionKey was never tracked", () => {
    // Guards against a collectionKey that's passed to record() but whose corresponding array was,
    // for whatever reason, never visited by trackExamined -- should not surface as `total: 0` or
    // `NaN`, but fall back to the same "no known collection" default as an omitted key.
    const collector = new DiagnosticsCollector();
    collector.record("stripped unknown response property", "extra", undefined, "never-tracked");

    const sink = vi.fn();
    collector.flush(sink, "ctx");

    expect(sink).toHaveBeenCalledWith(
      "stripped unknown response property",
      expect.objectContaining({ total: 1 }),
    );
  });

  it("resolves total from the sum of every trackExamined call for the same collectionKey", () => {
    // Mirrors a nested array revisited once per outer element (e.g. `alerts[i].responseActions`
    // once per alert): each visit's length must accumulate into one running total, not overwrite
    // it and not take the max of the individual visits.
    const collector = new DiagnosticsCollector();
    collector.trackExamined("alerts.responseActions", 2);
    collector.trackExamined("alerts.responseActions", 3);
    collector.trackExamined("alerts.responseActions", 1);
    collector.record(
      "widened response enum",
      "alerts.responseActions.actionType",
      "unknownAction",
      "alerts.responseActions",
    );

    const sink = vi.fn();
    collector.flush(sink, "ctx");

    expect(sink).toHaveBeenCalledWith(
      "widened response enum",
      expect.objectContaining({ count: 1, total: 6 }),
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
    collector.trackExamined("k", 5);
    collector.record("event", "field", "a", "k");
    collector.record("event", "field", undefined, "k");

    const sink = vi.fn();
    collector.flush(sink, "ctx");

    expect(sink).toHaveBeenCalledTimes(2);
  });

  it("does not collide two distinct (message, field, value) triples whose text could concatenate identically", () => {
    // `field`/`value` are wire-derived and unconstrained: a naive `\`${message} ${field} ${value}\``
    // join could merge these two distinct triples onto the same string. JSON.stringify-based
    // keying must keep them separate.
    const collector = new DiagnosticsCollector();
    collector.record("event", "a b", "c");
    collector.record("event", "a", "b c");

    const sink = vi.fn();
    collector.flush(sink, "ctx");

    expect(sink).toHaveBeenCalledTimes(2);
  });

  it("clears all groups and examined counts after flush", () => {
    const collector = new DiagnosticsCollector();
    collector.trackExamined("k", 5);
    collector.record("stripped unknown response property", "extra", undefined, "k");

    const sink = vi.fn();
    collector.flush(sink, "ctx");
    expect(collector.isEmpty).toBe(true);

    sink.mockClear();
    // Re-recording against the now-forgotten key falls back to the "no known collection" default,
    // proving `examined` was cleared alongside `groups`.
    collector.record("stripped unknown response property", "extra", undefined, "k");
    collector.flush(sink, "ctx");
    expect(sink).toHaveBeenCalledWith(
      "stripped unknown response property",
      expect.objectContaining({ total: 1 }),
    );
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
    collector.trackExamined("items", 4);
    collector.record("dropped invalid response item", "items", undefined, "items");

    const warn = vi.fn();
    const logger = { debug: vi.fn(), warn };
    collector.flush((message, meta) => logger.warn(message, meta), "ctx");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(logger.debug).not.toHaveBeenCalled();
  });
});
