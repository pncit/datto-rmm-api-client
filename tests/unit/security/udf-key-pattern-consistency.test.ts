import { describe, expect, it } from "vitest";

import { UDF_KEY } from "@/logging/mask";
import { UDF_KEY_PATTERN } from "@/schema-overrides";

import { SECRET_KEY_PATTERNS } from "../../../scripts/sanitize-fixtures.mjs";

/**
 * "What is a UDF key" is a security-relevant invariant defined independently in three places:
 * - `src/logging/mask.ts`'s `UDF_KEY` — the in-log control (R20).
 * - `src/schema-overrides/device-overrides.ts`'s `UDF_KEY_PATTERN` — the reconciled `udf` record
 *   schema's key shape (R8).
 * - `scripts/sanitize-fixtures.mjs`'s `SECRET_KEY_PATTERNS` — the at-rest control (R17).
 *
 * The at-rest and in-log controls are two halves of one guarantee — no UDF secret ever escapes,
 * whether logged or committed — so a future edit that widens or narrows one without the others
 * would silently reopen exactly the gap both exist to close (a value masked in logs but committed
 * raw, or redacted at rest but leaked in a log line). This test mechanically pins all three to the
 * same key set instead of relying on three maintainers noticing a drift independently.
 */
describe("UDF key pattern lockstep (R8, R17, R20)", () => {
  const REPRESENTATIVE_KEYS = [
    "udf1",
    "udf9",
    "udf10",
    "udf42",
    "udf299",
    "udf300",
    "udf0",
    "uid",
    "hostname",
    "udf",
    "udfDescription",
    "apiSecretKey",
    "UDF1",
    "udf-1",
    "udf1a",
    "",
  ];

  it.each(REPRESENTATIVE_KEYS)(
    "all three UDF-key controls agree on %j",
    (key) => {
      const inLog = UDF_KEY.test(key);
      const schemaShape = UDF_KEY_PATTERN.test(key);
      const atRest = SECRET_KEY_PATTERNS.some((pattern: RegExp) =>
        pattern.test(key),
      );

      expect(schemaShape).toBe(inLog);
      expect(atRest).toBe(inLog);
    },
  );

  it("at least one representative key actually matches (guards against a vacuously-passing comparison)", () => {
    expect(REPRESENTATIVE_KEYS.some((key) => UDF_KEY.test(key))).toBe(true);
  });
});
