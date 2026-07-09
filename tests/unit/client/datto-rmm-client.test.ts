import nock from "nock";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AccountResource } from "@/client/resources/account-resource";
import { ActivityLogResource } from "@/client/resources/activity-log-resource";
import { AlertResource } from "@/client/resources/alert-resource";
import { AuditResource } from "@/client/resources/audit-resource";
import { DeviceResource } from "@/client/resources/device-resource";
import { FilterResource } from "@/client/resources/filter-resource";
import { JobResource } from "@/client/resources/job-resource";
import { SiteResource } from "@/client/resources/site-resource";
import { SystemResource } from "@/client/resources/system-resource";
import { UserResource } from "@/client/resources/user-resource";
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

describe("DattoRmmClient (all ten namespaces finalized)", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it("mounts all ten namespaces as the correct resource classes", () => {
    const client = new DattoRmmClient(config());

    expect(client.account).toBeInstanceOf(AccountResource);
    expect(client.sites).toBeInstanceOf(SiteResource);
    expect(client.devices).toBeInstanceOf(DeviceResource);
    expect(client.alerts).toBeInstanceOf(AlertResource);
    expect(client.jobs).toBeInstanceOf(JobResource);
    expect(client.audit).toBeInstanceOf(AuditResource);
    expect(client.filters).toBeInstanceOf(FilterResource);
    expect(client.users).toBeInstanceOf(UserResource);
    expect(client.activityLogs).toBeInstanceOf(ActivityLogResource);
    expect(client.system).toBeInstanceOf(SystemResource);
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

  it("end-to-end: a mounted resource's call fetches an auth token and attaches Authorization through the real transport stack", async () => {
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

  it("end-to-end: a mounted resource's read call is throttled by the real rate limiter through the actual transport stack once the configured read window is exhausted", async () => {
    vi.useFakeTimers();
    try {
      nock(BASE_URL)
        .post(GRANT_PATH)
        .reply(200, { access_token: "tok-1", expires_in: 3600 });
      const deviceScope = nock(BASE_URL)
        .get("/api/v2/device/dev-1")
        .times(2)
        .reply(200, { uid: "dev-1", hostname: "PC1" });

      const client = new DattoRmmClient(
        config({ rateLimit: { readLimit: 1, windowSeconds: 1 } }),
      );

      // Consumes the read window's only slot.
      await client.devices.get("dev-1");

      let secondResolved = false;
      const second = client.devices.get("dev-1").then((device) => {
        secondResolved = true;
        return device;
      });

      // Not yet available: the second read must wait for the 1s window to roll, proving this
      // call was actually handed to the real rate limiter rather than sent straight through.
      await vi.advanceTimersByTimeAsync(0);
      expect(secondResolved).toBe(false);

      await vi.advanceTimersByTimeAsync(1_000);
      const secondDevice = await second;

      expect(secondResolved).toBe(true);
      expect(secondDevice).toEqual({ uid: "dev-1", hostname: "PC1" });
      expect(deviceScope.isDone()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
