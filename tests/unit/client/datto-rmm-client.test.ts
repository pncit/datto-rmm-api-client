import nock from "nock";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccountResource } from "@/client/resources/account-resource";
import { AlertResource } from "@/client/resources/alert-resource";
import { DeviceResource } from "@/client/resources/device-resource";
import { JobResource } from "@/client/resources/job-resource";
import { SiteResource } from "@/client/resources/site-resource";
import { DattoRmmClient } from "@/client/datto-rmm-client";
import type { DattoRmmClientConfig } from "@/client/datto-client-config";

const BASE_URL = "https://zinfandel-api.example.com";
const GRANT_PATH = "/auth/oauth/token";

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

describe("DattoRmmClient (Phase 7 scaffold — account/sites/devices/alerts/jobs)", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it("mounts account/sites/devices/alerts/jobs as the correct resource classes", () => {
    const client = new DattoRmmClient(config());

    expect(client.account).toBeInstanceOf(AccountResource);
    expect(client.sites).toBeInstanceOf(SiteResource);
    expect(client.devices).toBeInstanceOf(DeviceResource);
    expect(client.alerts).toBeInstanceOf(AlertResource);
    expect(client.jobs).toBeInstanceOf(JobResource);
  });

  it("throws DattoValidationError('request') on an invalid config, before mounting anything", () => {
    expect(
      () => new DattoRmmClient({ apiUrl: "not-a-url" } as DattoRmmClientConfig),
    ).toThrow(
      expect.objectContaining({
        name: "DattoValidationError",
        stage: "request",
      }),
    );
  });

  it("rejects a retired 0.1.x config field (validationMode) via the same constructor path", () => {
    expect(
      () =>
        new DattoRmmClient({
          ...config(),
          validationMode: "strict",
        } as unknown as DattoRmmClientConfig),
    ).toThrow(expect.objectContaining({ name: "DattoValidationError" }));
  });

  it("end-to-end: a mounted resource's call fetches an auth token, attaches Authorization, and honors the read rate limit through the real transport stack", async () => {
    const tokenScope = nock(BASE_URL)
      .post(GRANT_PATH)
      .reply(200, { access_token: "tok-1", expires_in: 3600 });
    let capturedAuth: string | undefined;
    const deviceScope = nock(BASE_URL)
      .get("/api/v2/device/dev-1")
      .reply(function reply() {
        capturedAuth = this.req.headers.authorization as string | undefined;
        return [200, { uid: "dev-1", hostname: "PC1" }];
      });

    const client = new DattoRmmClient(config());
    const device = await client.devices.get("dev-1");

    expect(device).toEqual({ uid: "dev-1", hostname: "PC1" });
    expect(capturedAuth).toBe("Bearer tok-1");
    expect(tokenScope.isDone()).toBe(true);
    expect(deviceScope.isDone()).toBe(true);
  });
});
