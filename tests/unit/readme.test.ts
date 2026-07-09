import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { OPERATION_MAP } from "@/client/operation-map";

/**
 * Guards the README against drift from the actual public surface (R18, plan Phase 10 "Tests").
 * `OPERATION_MAP` is the same authoritative `{ method, path } -> client.<ns>.<method>` table
 * `tests/unit/client/coverage-map.test.ts` verifies against the committed spec and the real
 * resource implementations (Phase 8) — deriving the expected namespace set from it here, rather
 * than a hand-duplicated literal list, means a future namespace rename/addition that updates the
 * map but not the README fails this test instead of shipping a stale doc.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const README_PATH = resolve(__dirname, "../../README.md");

/**
 * Slices the README down to the text belonging to a single `### \`client.<ns>\`` section (from
 * that heading up to, but excluding, the next `##`/`###` heading). Scoping assertions to this
 * slice — rather than searching the whole document — is what makes the per-namespace checks below
 * a real drift guard: a method name shared across namespaces (`get`, `list`, `variables`, …) can no
 * longer be satisfied by an identically-named sibling documented elsewhere.
 */
function namespaceSection(readme: string, ns: string): string {
  const headingRe = new RegExp(`^### \`client\\.${ns}\`\\s*$`, "m");
  const headingMatch = headingRe.exec(readme);
  if (!headingMatch) {
    return "";
  }
  const sectionStart = headingMatch.index + headingMatch[0].length;
  const rest = readme.slice(sectionStart);
  const nextHeadingMatch = /^#{2,3} /m.exec(rest);
  const sectionEnd = nextHeadingMatch
    ? sectionStart + nextHeadingMatch.index
    : readme.length;
  return readme.slice(sectionStart, sectionEnd);
}

/**
 * Finds the single markdown table row (a line starting with `` | `method( `` once trimmed)
 * documenting the given method within a namespace section. The README intentionally uses
 * friendlier path-parameter names than the spec's own placeholders (e.g. the doc's
 * `/api/v2/device/{uid}` for the spec's `/v2/device/{deviceUid}`), so this locates the row by
 * method name only; path/verb matching (below) tolerates the placeholder-name difference.
 */
function findMethodRow(section: string, method: string): string | undefined {
  return section
    .split("\n")
    .find((line) => line.trim().startsWith(`| \`${method}(`));
}

/** Escapes a literal path segment for embedding in a `RegExp`. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds a `RegExp` that matches the given spec path with every `{paramName}` placeholder
 * generalized to `\{[A-Za-z]+\}`, so a documented row using a different (friendlier) placeholder
 * name for the same path shape still matches (e.g. spec `{deviceUid}` vs. documented `{uid}`).
 */
function pathPattern(specPath: string): RegExp {
  const generalized = specPath
    .split(/(\{[^}]+\})/)
    .map((segment) =>
      /^\{[^}]+\}$/.test(segment)
        ? "\\{[A-Za-z]+\\}"
        : escapeRegExp(segment),
    )
    .join("");
  return new RegExp(`/api${generalized}(?![\\w{])`);
}

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

  it.each(OPERATION_MAP)(
    "documents $ns.$method as $specMethod /api$specPath",
    ({ ns, method, specMethod, specPath }) => {
      const section = namespaceSection(readme, ns);
      expect(section).not.toBe("");

      const row = findMethodRow(section, method);
      expect(
        row,
        `expected a table row documenting \`${method}(\` under client.${ns}`,
      ).toBeDefined();

      expect(row).toContain(specMethod.toUpperCase());
      expect(row).toMatch(pathPattern(specPath));
    },
  );

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
