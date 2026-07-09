import path from "node:path";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // tests/generated/reproducibility.test.ts shells out to `npm run generate` (a full Orval
    // codegen pass) and to `git`, coupling every ordinary `npm test`/`prepublishOnly` invocation
    // to a working git checkout and a live generator run as a side effect — unsuitable for the
    // default test path an installed-tarball or sandboxed environment might exercise. It has its
    // own dedicated config (vitest.repro.config.ts) and npm script (`test:repro`), run in CI.
    exclude: [...configDefaults.exclude, "tests/generated/reproducibility.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/generated/**",
        "src/index.ts",
        "src/**/*.test.ts",
        "src/__tests__/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
