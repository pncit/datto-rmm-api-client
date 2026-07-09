import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { OPERATION_MAP } from "@/client/operation-map";

const __dirname = dirname(fileURLToPath(import.meta.url));
const README_PATH = resolve(__dirname, "../../README.md");

/**
 * Guards the README against drift from the actual public surface (R18, plan Phase 10 "Tests").
 * `OPERATION_MAP` is the same authoritative `{ method, path } -> client.<ns>.<method>` table
 * `tests/unit/client/coverage-map.test.ts` verifies against the committed spec and the real
 * resource implementations (Phase 8) — deriving the expected namespace set from it here, rather
 * than a hand-duplicated literal list, means a future namespace rename/addition that updates the
 * map but not the README fails this test instead of shipping a stale doc.
 */
describe("README", () => {
  const readme = readFileSync(README_PATH, "utf8");
  const namespaces = [...new Set(OPERATION_MAP.map((entry) => entry.ns))];

  it("documents all ten resource namespaces", () => {
    expect(namespaces).toHaveLength(10);
  });

  it.each(namespaces)(
    "has a namespace → endpoint map section for client.%s",
    (ns) => {
      expect(readme).toContain(`\`client.${ns}\``);
    },
  );

  it.each(namespaces)("documents at least one method for client.%s", (ns) => {
    const methodsForNs = OPERATION_MAP.filter((entry) => entry.ns === ns).map(
      (entry) => entry.method,
    );
    const hasDocumentedMethod = methodsForNs.some((method) =>
      readme.includes(`\`${method}(`),
    );
    expect(hasDocumentedMethod).toBe(true);
  });

  it("documents the throwing error hierarchy", () => {
    expect(readme).toContain("DattoApiError");
    expect(readme).toContain("DattoValidationError");
  });

  it("documents the UDF-masking guarantee", () => {
    expect(readme.toLowerCase()).toContain("redacted");
  });

  it("documents the 0.1.x -> 1.0.0 upgrade path", () => {
    expect(readme).toContain("Upgrading from 0.1.x");
  });
});
