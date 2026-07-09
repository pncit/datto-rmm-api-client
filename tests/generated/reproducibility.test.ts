import { existsSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, test, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const SPEC_PATH = resolve(REPO_ROOT, "spec/openapi.json");
const GENERATED_DIR = resolve(REPO_ROOT, "src/generated");
const specIsCommitted = existsSync(SPEC_PATH);

function hasGit(): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

// Guards R15: `npm run generate` must reproduce `src/generated/**` byte-for-byte from the
// committed `spec/openapi.json`. Fully offline (Orval consumes the local patched spec produced
// by scripts/patch-spec.mjs, not a live fetch); only the initial spec fetch is network-dependent,
// and that is not part of `npm run generate`.
describe("generated output reproducibility (R15)", () => {
  // Skips cleanly (rather than failing) if spec/openapi.json is absent — per the plan's "a
  // maintainer must supply it" fallback for an implementor environment with no egress — or if
  // this isn't a git checkout at all (e.g. an installed tarball), since the guard itself is
  // git-mediated.
  test.skipIf(!specIsCommitted || !hasGit())(
    "npm run generate leaves src/generated unchanged",
    () => {
      // Delete the committed output first: `git diff` alone only compares tracked files against
      // the index, so it misses two real regressions a spec change can cause — a schema removal
      // that should delete a generated file (the file would just sit there, untracked-by-change
      // but stale) and a schema addition that should create one (the new file is untracked, so
      // `git diff` never reports it as unaccounted-for). Regenerating from a genuinely empty
      // directory and asserting on `git status --porcelain` (which reports untracked *and*
      // deleted paths, not just modified ones) verifies the real property this guard claims:
      // `src/generated/**` reproduces byte-for-byte, file-for-file, from scratch.
      rmSync(GENERATED_DIR, { recursive: true, force: true });
      execSync("npm run generate", { cwd: REPO_ROOT, stdio: "pipe" });

      const status = execSync("git status --porcelain -- src/generated", {
        cwd: REPO_ROOT,
        stdio: "pipe",
      }).toString();
      expect(status).toBe("");
    },
    60_000,
  );
});
