import nock from "nock";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  BaseError,
  createDattoRmmClient,
  DattoApiError,
  DattoRmmClient,
  DattoValidationError,
} from "@/index";
import type { DattoRmmClientConfig } from "@/index";

const BASE_URL = "https://zinfandel-api.example.com";

function config(
  overrides: Partial<DattoRmmClientConfig> = {},
): DattoRmmClientConfig {
  return {
    apiUrl: BASE_URL,
    apiKey: "test-key",
    apiSecret: "test-secret",
    ...overrides,
  };
}

/**
 * Public-barrel contract (R1, R2, R9, R19, plan Phase 8 Step 7/8). Complements
 * `tests/unit/client/datto-rmm-client.test.ts` (which exercises the class directly) by exercising
 * the actual published entry point (`@/index`, i.e. `src/index.ts`) — the factory, the error
 * classes, and the absence of the retired 0.1.x surface.
 *
 * The companion compile-time check — that the barrel does not leak the raw generated type surface
 * and does not re-export the retired `Result`/`ProblemError` *types* — lives in
 * `tests/generated/surface-pin.ts`: a type export has no runtime footprint, so it cannot be
 * asserted with a plain `expect(...)` here.
 *
 * "Each name on the curated `public-types.ts` list resolves" (a regeneration that renames/drops a
 * curated response DTO fails here rather than silently changing the surface) needs no separate
 * runtime test: `public-types.ts` re-exports each name directly from `./generated/types`, so a
 * renamed/removed generated symbol breaks that file's own compilation — `npm run typecheck` is
 * the enforcement, not a redundant runtime assertion.
 */
describe("public surface (@/index)", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it("createDattoRmmClient constructs a DattoRmmClient with all ten namespaces mounted", () => {
    const client = createDattoRmmClient(config());

    expect(client).toBeInstanceOf(DattoRmmClient);
    for (const ns of [
      "account",
      "sites",
      "devices",
      "alerts",
      "jobs",
      "audit",
      "filters",
      "users",
      "activityLogs",
      "system",
    ] as const) {
      expect(client[ns]).toBeDefined();
    }
  });

  it("createDattoRmmClient throws DattoValidationError on an invalid config", () => {
    expect(() =>
      createDattoRmmClient({ apiUrl: "not-a-url" } as DattoRmmClientConfig),
    ).toThrow(expect.objectContaining({ name: "DattoValidationError" }));
  });

  it("exports the throwing error hierarchy as constructible classes (R9)", () => {
    const validationError = new DattoValidationError(new ZodError([]), "response");
    expect(validationError).toBeInstanceOf(BaseError);
    expect(validationError).toBeInstanceOf(Error);
    expect(DattoApiError.prototype).toBeInstanceOf(Error);
  });

  it("the retired flat 0.1.x methods are not present on a constructed client (R9, R19)", () => {
    const client = createDattoRmmClient(config()) as unknown as Record<
      string,
      unknown
    >;

    expect(client.getAccountDevices).toBeUndefined();
    expect(client.getDeviceByUid).toBeUndefined();
    expect(client.updateDeviceUdfs).toBeUndefined();
    expect(client.invalidateToken).toBeUndefined();
  });
});
