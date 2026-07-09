import { describe, expect, test } from "vitest";

import {
  SECRET_KEY_PATTERNS,
  sanitizeValue,
} from "../../../scripts/sanitize-fixtures.mjs";

describe("sanitizeValue", () => {
  test("redacts every udf* field to null at the top level while preserving every other field", () => {
    const raw = {
      uid: "device-uid-1",
      hostname: "PC1",
      udf: {
        udf1: "S3CR3T-VALUE",
        udf2: null,
        udf300: "ANOTHER-SECRET",
      },
    };

    const sanitized = sanitizeValue(raw) as typeof raw;

    expect(sanitized).toEqual({
      uid: "device-uid-1",
      hostname: "PC1",
      udf: {
        udf1: null,
        udf2: null,
        udf300: null,
      },
    });
  });

  test("redacts a udf* key at any nesting depth, not just directly under a udf record", () => {
    const raw = {
      devices: [
        { uid: "d1", udf: { udf5: "SECRET-5" } },
        { uid: "d2", udf: { udf5: null } },
      ],
    };

    const sanitized = sanitizeValue(raw) as typeof raw;

    expect(sanitized.devices[0]?.udf.udf5).toBeNull();
    expect(sanitized.devices[1]?.udf.udf5).toBeNull();
    expect(sanitized.devices[0]?.uid).toBe("d1");
  });

  test("preserves the full key set and every non-secret value's shape unchanged", () => {
    const raw = {
      pageDetails: {
        count: 1,
        totalCount: 1,
        prevPageUrl: "",
        nextPageUrl: "",
      },
      devices: [
        {
          uid: "d1",
          hostname: "PC1",
          online: true,
          lastSeen: 1721131200000,
          antivirus: {
            antivirusProduct: "Windows Defender",
            antivirusStatus: "RunningAndUpToDate",
          },
          udf: { udf1: "raw-secret" },
        },
      ],
    };

    const sanitized = sanitizeValue(raw) as typeof raw;

    // Same key set and structure as the input -- only udf* values changed.
    expect(Object.keys(sanitized)).toEqual(Object.keys(raw));
    expect(Object.keys(sanitized.devices[0]!)).toEqual(
      Object.keys(raw.devices[0]!),
    );
    expect(sanitized.pageDetails).toEqual(raw.pageDetails);
    expect(sanitized.devices[0]!.hostname).toBe("PC1");
    expect(sanitized.devices[0]!.online).toBe(true);
    expect(sanitized.devices[0]!.lastSeen).toBe(1721131200000);
    expect(sanitized.devices[0]!.antivirus).toEqual(raw.devices[0]!.antivirus);
    expect(sanitized.devices[0]!.udf.udf1).toBeNull();
  });

  test("preserves an already-null udf value's null position (idempotent on null)", () => {
    const raw = { udf: { udf1: null } };

    expect(sanitizeValue(raw)).toEqual({ udf: { udf1: null } });
  });

  test("is idempotent: sanitizing an already-sanitized value changes nothing further", () => {
    const raw = { udf: { udf1: "S3CR3T" }, hostname: "PC1" };

    const once = sanitizeValue(raw);
    const twice = sanitizeValue(once);

    expect(twice).toEqual(once);
  });

  test("does not redact a non-udf key that merely contains 'udf' as a substring", () => {
    const raw = { udfDescription: "not a udf field", udf1: "S3CR3T" };

    const sanitized = sanitizeValue(raw) as typeof raw;

    expect(sanitized.udfDescription).toBe("not a udf field");
    expect(sanitized.udf1).toBeNull();
  });

  test("SECRET_KEY_PATTERNS matches udf1..udf300 and nothing else representative", () => {
    expect(SECRET_KEY_PATTERNS.some((pattern) => pattern.test("udf1"))).toBe(
      true,
    );
    expect(SECRET_KEY_PATTERNS.some((pattern) => pattern.test("udf300"))).toBe(
      true,
    );
    expect(SECRET_KEY_PATTERNS.some((pattern) => pattern.test("uid"))).toBe(
      false,
    );
    expect(
      SECRET_KEY_PATTERNS.some((pattern) => pattern.test("apiSecretKey")),
    ).toBe(false);
  });
});
