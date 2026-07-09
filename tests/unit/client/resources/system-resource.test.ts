import nock from "nock";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { SystemResource } from "@/client/resources/system-resource";

import { BASE_URL, makeResource as makeResourceOf } from "./test-harness";

function makeResource() {
  return makeResourceOf(SystemResource);
}

describe("SystemResource", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it("status() hits GET /api/v2/system/status", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/system/status")
      .reply(200, {
        version: "9.1.0",
        status: "OK",
        started: "2024-01-01T00:00:00.000Z",
      });
    const { resource, descriptors } = makeResource();

    const result = await resource.status();

    expect(result).toEqual({
      version: "9.1.0",
      status: "OK",
      started: "2024-01-01T00:00:00.000Z",
    });
    expect(descriptors).toEqual([{ kind: "read" }]);
    expect(scope.isDone()).toBe(true);
  });

  it("requestRate() hits GET /api/v2/system/request_rate (R11, design 'reconcile against the live budget')", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/system/request_rate")
      .reply(200, {
        slidingTimeWindowSizeSeconds: 60,
        accountUid: "acct-1",
        accountCount: 10,
        accountRateLimit: 600,
        accountCutOffRatio: 0.9,
        accountWriteRateLimit: 600,
        accountWriteCount: 5,
        operationWriteStatus: {
          "device-udf-set": { limit: 600, count: 1 },
          "alert-resolve": { limit: 100, count: 0 },
        },
      });
    const { resource } = makeResource();

    const result = await resource.requestRate();

    expect(result).toEqual({
      slidingTimeWindowSizeSeconds: 60,
      accountUid: "acct-1",
      accountCount: 10,
      accountRateLimit: 600,
      accountCutOffRatio: 0.9,
      accountWriteRateLimit: 600,
      accountWriteCount: 5,
      operationWriteStatus: {
        "device-udf-set": { limit: 600, count: 1 },
        "alert-resolve": { limit: 100, count: 0 },
      },
    });
    expect(scope.isDone()).toBe(true);
  });

  it("paginationConfiguration() hits GET /api/v2/system/pagination", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/system/pagination")
      .reply(200, { max: 250 });
    const { resource } = makeResource();

    const result = await resource.paginationConfiguration();

    expect(result).toEqual({ max: 250 });
    expect(scope.isDone()).toBe(true);
  });
});
