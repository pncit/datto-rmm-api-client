import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import axios from "axios";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import { BaseResource } from "@/client/resources/base-resource";
import { withUdfMasking } from "@/logging/mask";
import type { DattoLogger } from "@/logging/logger";
import {
  alertSchema,
  deviceSchema,
  OVERRIDE_ENTITIES,
  type Alert,
  type Device,
} from "@/schema-overrides";
import { enumFieldPaths } from "@/validation/schema-leniency";

/**
 * Fixture-validation suite (Phase 9, R5/R7/R8/R17/R20/R1): proves the generated + reconciled
 * schemas validate against realistic captured shapes exercising every leniency path the design
 * names — nullability, unknown keys, per-item drop, open enums, epoch-ms timestamps,
 * `udf1…udf300`, `@class` alert contexts — and that build-time and runtime enum widening cover
 * the exact same field set at every depth.
 *
 * Fixtures under `tests/fixtures/` are two kinds:
 * - **Real captures** (`device.json`, `devicesPage1.json`, `devicesPage2.json`, `devicesPage.json`)
 *   — moved here in Phase 8, kept as-is per the plan's assumption that their only non-null UDF
 *   values (`udf1: "value1"`/`"value2"`) are benign and safe to commit.
 * - **Synthesized** (every other fixture this phase adds) — deliberately encode a specific
 *   observed-defect pattern from the design; every synthetic UDF value uses the
 *   `SYNTHETIC-UDF-<n>` marker so it reads as obviously fabricated, never real, data.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "../fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8"));
}

function createMockLogger(): DattoLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/**
 * Exposes `BaseResource`'s protected leniency primitives directly, with no HTTP/nock involved —
 * this suite validates fixture *data* against the reconciled schemas through the exact same
 * `validateResponse`/`validateArrayResponse` → `parseLenient` path every `*Resource` method
 * (Phase 7/8) funnels through, never a parallel/duplicated validation call. The axios instance is
 * never actually used to make a request (`validateResponse`/`validateArrayResponse` take already-
 * parsed data), so a bare, unconfigured instance is sufficient.
 */
class FixtureValidator extends BaseResource {
  validateOne<T>(data: unknown, schema: z.ZodType<T>, context: string) {
    return this.validateResponse(data, schema, context);
  }
  validateMany<T>(data: unknown, schema: z.ZodType<T>, context: string) {
    return this.validateArrayResponse(data, schema, context);
  }
}

function makeValidator(
  logger: DattoLogger = createMockLogger(),
): FixtureValidator {
  return new FixtureValidator(axios.create(), logger);
}

// ---------------------------------------------------------------------------
// Fixture inventories
// ---------------------------------------------------------------------------

/** Real captures plus the synthesized rmmnetworkdevice/UDF-300 fixture — every fixture that is a
 * single `Device` value (not a paginated envelope). */
const SINGLE_DEVICE_FIXTURES = ["device.json", "device-rmmnetworkdevice.json"];

/** Real captures — each a `{ pageDetails, devices: [<one clean device>] }` envelope. */
const DEVICE_PAGE_FIXTURES = [
  "devicesPage.json",
  "devicesPage1.json",
  "devicesPage2.json",
];

/** One fixture per real observed `alertContext` `@class` discriminator (design "Current State" /
 * plan Phase 9 Step 1). */
const ALERT_CONTEXT_FIXTURES = [
  "alert-context-comp-script.json",
  "alert-context-eventlog.json",
  "alert-context-patch.json",
  "alert-context-antivirus.json",
  "alert-context-online-offline-status.json",
  "alert-context-perf-resource-usage.json",
];

// ---------------------------------------------------------------------------
// Every fixture validates leniently (R5, R8, R17)
// ---------------------------------------------------------------------------

describe("every committed fixture validates leniently", () => {
  it.each(SINGLE_DEVICE_FIXTURES)(
    "%s validates through the reconciled Device schema",
    (name) => {
      const data = loadFixture(name);
      const validator = makeValidator();

      expect(() =>
        validator.validateOne(data, deviceSchema, `fixture:${name}`),
      ).not.toThrow();
    },
  );

  it.each(DEVICE_PAGE_FIXTURES)(
    "%s's device page validates with nothing dropped",
    (name) => {
      const data = loadFixture(name) as { devices: unknown[] };
      const logger = createMockLogger();
      const validator = makeValidator(logger);

      const result = validator.validateMany(
        data.devices,
        deviceSchema,
        `fixture:${name}`,
      );

      expect(result).toHaveLength(data.devices.length);
      expect(logger.warn).not.toHaveBeenCalledWith(
        "dropped invalid response array items",
        expect.anything(),
      );
    },
  );

  // Validates each @class fixture through the reconciled Alert schema *and* asserts its own
  // context-specific fields survive the catchall override (R8), in one per-fixture assertion --
  // a preserved field implies a successful parse, so a separate "just doesn't throw" case would
  // only restate a subset of this one, and running per-fixture (rather than a manual `for` loop)
  // keeps each fixture's failure isolated and named in the test output.
  it.each(ALERT_CONTEXT_FIXTURES)(
    "%s validates through the reconciled Alert schema and its @class-specific fields survive",
    (name) => {
      const data = loadFixture(name) as {
        alertContext: Record<string, unknown>;
      };
      const validator = makeValidator();

      const result = validator.validateOne(
        data,
        alertSchema,
        `fixture:${name}`,
      ) as Alert & { alertContext: Record<string, unknown> };

      for (const [key, value] of Object.entries(data.alertContext)) {
        expect(result.alertContext[key]).toEqual(value);
      }
    },
  );

  it("device-rmmnetworkdevice.json's synthetic udf300 marker and deviceClass survive validation untouched", () => {
    const validator = makeValidator();

    const result = validator.validateOne(
      loadFixture("device-rmmnetworkdevice.json"),
      deviceSchema,
      "fixture:device-rmmnetworkdevice.json",
    ) as Device;

    expect(result.deviceClass).toBe("rmmnetworkdevice");
    expect(result.udf?.udf300).toBe("SYNTHETIC-UDF-300");
    // "many nulls" (design's observed reality) tolerated, not coerced away or rejected.
    expect(result.operatingSystem).toBeNull();
    expect(result.antivirus).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Per-item collection drop (R7)
// ---------------------------------------------------------------------------

describe("a malformed collection item is dropped; the rest survive (R7)", () => {
  it("devices-page-with-malformed-item.json: the item with a non-string uid is dropped", () => {
    const data = loadFixture("devices-page-with-malformed-item.json") as {
      devices: unknown[];
    };
    const logger = createMockLogger();
    const validator = makeValidator(logger);

    const result = validator.validateMany(
      data.devices,
      deviceSchema,
      "fixture:devices-page-with-malformed-item.json",
    );

    expect(result).toHaveLength(1);
    expect((result[0] as Device).uid).toBe("device-uid-601");
    expect(logger.warn).toHaveBeenCalledWith(
      "dropped invalid response array items",
      expect.objectContaining({ dropped: 1, total: 2 }),
    );
  });

  it("alerts-page-with-malformed-item.json: the item with a non-string alertUid is dropped", () => {
    const data = loadFixture("alerts-page-with-malformed-item.json") as {
      alerts: unknown[];
    };
    const logger = createMockLogger();
    const validator = makeValidator(logger);

    const result = validator.validateMany(
      data.alerts,
      alertSchema,
      "fixture:alerts-page-with-malformed-item.json",
    );

    expect(result).toHaveLength(1);
    expect((result[0] as Alert).alertUid).toBe("alert-uid-701");
    expect(logger.warn).toHaveBeenCalledWith(
      "dropped invalid response array items",
      expect.objectContaining({ dropped: 1, total: 2 }),
    );
  });
});

// ---------------------------------------------------------------------------
// Build-time and runtime open-enum widening cover the same field set (R5)
// ---------------------------------------------------------------------------

describe("open-enum widening: build-time and runtime cover the same field set at every depth (R5)", () => {
  it("Device: a truly novel value type-checks at every enum depth (top-level and nested)", () => {
    // Each assignment only type-checks (`npm run typecheck`) if the reconciled `Device` type
    // carries the codemod-widened `(string & {})` graft at that exact depth (Phase 6 Step 3 --
    // `Pick<GeneratedDevice, 'deviceClass' | 'antivirus' | 'patchManagement'>`). "quantumdevice"
    // etc. are deliberately NOT declared enum members -- unlike the fixture's real
    // `deviceClass: 'rmmnetworkdevice'`, these prove the *type*, not just the runtime value, is
    // open.
    const deviceClass: Device["deviceClass"] = "quantumdevice";
    const antivirusStatus: NonNullable<Device["antivirus"]>["antivirusStatus"] =
      "QuantumAV";
    const patchStatus: NonNullable<Device["patchManagement"]>["patchStatus"] =
      "QuantumPatch";

    expect(deviceClass).toBe("quantumdevice");
    expect(antivirusStatus).toBe("QuantumAV");
    expect(patchStatus).toBe("QuantumPatch");
  });

  it("Alert: a truly novel value type-checks at every enum depth (top-level and nested)", () => {
    const priority: Alert["priority"] = "QuantumPriority";
    const actionType: NonNullable<
      Alert["responseActions"]
    >[number]["actionType"] = "QUANTUM_ACTION";

    expect(priority).toBe("QuantumPriority");
    expect(actionType).toBe("QUANTUM_ACTION");
  });

  it("Device: the rmmnetworkdevice fixture's already-real widened value survives parseLenient without being dropped", () => {
    const validator = makeValidator();

    const result = validator.validateOne(
      loadFixture("device-rmmnetworkdevice.json"),
      deviceSchema,
      "fixture:device-rmmnetworkdevice.json",
    ) as Device;

    expect(result.deviceClass).toBe("rmmnetworkdevice");
  });

  it("Alert: a novel (undeclared) priority value survives parseLenient without being dropped", () => {
    const validator = makeValidator();

    const result = validator.validateOne(
      { alertUid: "alert-uid-novel-priority", priority: "QuantumPriority" },
      alertSchema,
      "novel-priority",
    ) as Alert;

    expect(result.priority).toBe("QuantumPriority");
  });
});

// ---------------------------------------------------------------------------
// Recursive WIDENED_FIELDS completeness guard (Phase 6 Step 3 gate)
// ---------------------------------------------------------------------------

/**
 * A `widenedFields` entry that is deliberately listed despite having no enum of its own at the
 * time this guard was written — e.g. a field grafted for a reason other than an enum. Empty
 * today: both `DEVICE_WIDENED_FIELDS` and `ALERT_WIDENED_FIELDS` are enum-motivated end to end
 * (see `src/schema-overrides/device-overrides.ts`/`alert-overrides.ts`). Any future entry that is
 * genuinely enum-free must be added here, with a comment saying why, rather than silently making
 * the reverse assertion below vacuous for that entry.
 */
const NO_ENUM_WIDENED_FIELDS: ReadonlySet<string> = new Set();

describe("WIDENED_FIELDS completeness guard", () => {
  it("every enum field's containing top-level property is listed in its entity's WIDENED_FIELDS constant", () => {
    let enumFieldsChecked = 0;

    for (const entry of OVERRIDE_ENTITIES) {
      const widenedFields: readonly string[] = entry.widenedFields;
      const paths = enumFieldPaths(entry.schema);

      for (const path of paths) {
        const topLevel = path.split(".")[0]!;
        expect(widenedFields).toContain(topLevel);
      }

      enumFieldsChecked += paths.length;
    }

    // Sanity check on the guard itself: fail loudly if OVERRIDE_ENTITIES or enumFieldPaths ever
    // returns nothing to check, rather than silently passing over zero assertions.
    expect(enumFieldsChecked).toBeGreaterThan(0);
  });

  it("every WIDENED_FIELDS entry actually corresponds to an enum-bearing field (the reverse direction)", () => {
    // The forward direction above proves widenedFields is a SUPERSET of the real enum fields. A
    // stale or mistaken entry with no enum of its own would still pass that direction, yet would
    // silently undo that field's reconciliation: `Omit<..., K> & Pick<Generated, K>` re-grafts the
    // field from the un-reconciled generated type, discarding any non-enum reconciliation (e.g. a
    // nullability widening) `deviceResponseSchema`/`alertResponseSchema` applied to it. This
    // direction closes that gap by proving widenedFields is also a SUBSET of the real enum fields
    // (modulo the explicit, documented `NO_ENUM_WIDENED_FIELDS` allowlist above).
    for (const entry of OVERRIDE_ENTITIES) {
      const topLevelEnumFields = [
        ...new Set(
          enumFieldPaths(entry.schema).map((path) => path.split(".")[0]!),
        ),
      ];

      for (const widenedField of entry.widenedFields) {
        if (NO_ENUM_WIDENED_FIELDS.has(widenedField)) {
          continue;
        }
        expect(topLevelEnumFields).toContain(widenedField);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// UDF masking against real fixture data (R20)
// ---------------------------------------------------------------------------

describe("UDF masking never emits a raw fixture UDF value (R20)", () => {
  it("logging the rmmnetworkdevice fixture's udf payload through the masked logger never leaks the synthetic marker", () => {
    const data = loadFixture("device-rmmnetworkdevice.json") as {
      udf: Record<string, unknown>;
    };
    const sink = createMockLogger();
    const maskedLogger = withUdfMasking(sink);

    // Logs the fixture's own real udf payload through the masking boundary directly -- the shape
    // a real leniency diagnostic or resource log call would carry in `meta` per the R20 invariant
    // (masking scrubs `meta`, never the message string -- src/logging/mask.ts). The fixture
    // validates cleanly (asserted in the "every committed fixture validates leniently" block
    // above), so driving it through `validateResponse` here would emit no diagnostic at all and
    // prove nothing about masking; this test's job is masking, not validation, so it exercises the
    // masked logger directly against the fixture's genuine udf data.
    maskedLogger.debug("diagnostic carrying fixture udf data", {
      udf: data.udf,
    });

    for (const method of ["debug", "info", "warn", "error"] as const) {
      for (const call of (sink[method] as ReturnType<typeof vi.fn>).mock
        .calls) {
        expect(JSON.stringify(call)).not.toContain("SYNTHETIC-UDF-300");
      }
    }
  });
});
