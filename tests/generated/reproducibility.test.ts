import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, test, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const SPEC_PATH = resolve(REPO_ROOT, "spec/openapi.json");
const specIsCommitted = existsSync(SPEC_PATH);

// Guards R15: `npm run generate` must reproduce `src/generated/**` byte-for-byte from the
// committed `spec/openapi.json`. Fully offline (Orval consumes the local patched spec produced
// by scripts/patch-spec.mjs, not a live fetch); only the initial spec fetch is network-dependent,
// and that is not part of `npm run generate`.
describe("generated output reproducibility (R15)", () => {
  // Skips cleanly (rather than failing) if spec/openapi.json is absent, per the plan's
  // "a maintainer must supply it" fallback for an implementor environment with no egress.
  test.skipIf(!specIsCommitted)(
    "npm run generate leaves src/generated unchanged",
    () => {
      execSync("npm run generate", { cwd: REPO_ROOT, stdio: "pipe" });
      expect(() =>
        execSync("git diff --exit-code -- src/generated", {
          cwd: REPO_ROOT,
          stdio: "pipe",
        }),
      ).not.toThrow();
    },
    60_000,
  );
});
