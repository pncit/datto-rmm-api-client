import { defineConfig } from "vitest/config";

/**
 * Dedicated config for the R15 reproducibility guard
 * (tests/generated/reproducibility.test.ts), run via `npm run test:repro`.
 *
 * Kept out of the default `vitest run` (see vitest.config.ts's `exclude`) because this one test
 * shells out to `npm run generate` (a full Orval codegen pass) and to `git` — appropriate for a
 * CI-only R15 gate, not for the default `npm test`/`prepublishOnly` path a local dev loop or an
 * installed-tarball/sandboxed environment might exercise.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/generated/reproducibility.test.ts"],
  },
});
