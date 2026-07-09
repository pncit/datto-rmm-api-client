import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = resolve(__dirname, "../../src/generated/schemas");

/** Recursively lists every `.zod.ts` file under `dir`. */
function listZodFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listZodFiles(fullPath));
    } else if (entry.name.endsWith(".zod.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

// `toLenientField` (src/validation/schema-leniency.ts) makes every named object field
// independently tolerate null/absent, which also relaxes a union branch's own discriminator
// requiredness -- a payload matching no branch's real shape would match the first (now
// effectively all-optional) branch instead of failing. That is sound only while no generated
// response schema declares a `z.union`/`z.discriminatedUnion`. This was previously a one-time,
// manually-run `grep` verifying the assumption; this test turns it into a build-breaking
// regression guard so a future spec refresh or hand-written override
// (`src/schema-overrides.ts`, Phase 6) that introduces a response union fails loudly here instead
// of silently mismatching branches at runtime (project-lead-r1-f1).
describe("generated response schema union-freedom invariant", () => {
  test("no schema under src/generated/schemas/** declares a z.union or z.discriminatedUnion", () => {
    const zodFiles = listZodFiles(SCHEMAS_DIR);
    // Sanity check on the check itself: fail loudly if the directory layout changes underneath
    // this test rather than silently passing over zero files.
    expect(zodFiles.length).toBeGreaterThan(0);

    const offendingFiles = zodFiles.filter((file) => {
      const source = readFileSync(file, "utf-8");
      return /\bzod\.(union|discriminatedUnion)\(/.test(source);
    });

    expect(offendingFiles).toEqual([]);
  });
});
