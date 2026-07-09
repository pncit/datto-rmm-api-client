import nock from "nock";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ActivityLogResource } from "@/client/resources/activity-log-resource";

import { BASE_URL, makeResource as makeResourceOf } from "./test-harness";

function makeResource() {
  return makeResourceOf(ActivityLogResource);
}

describe("ActivityLogResource", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it("list() paginates GET /api/v2/activity-logs and widens an unobserved entity value (R5)", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/activity-logs")
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 1,
          prevPageUrl: null,
          nextPageUrl: null,
        },
        activities: [
          {
            id: "log-1",
            entity: "quantum-entity",
            category: "Device Management",
            action: "reboot",
            date: 1700000000000,
            site: { id: 1, name: "HQ" },
            deviceId: 42,
            hostname: "PC1",
            hasStdOut: false,
            hasStdErr: false,
          },
        ],
      });
    const { resource, descriptors } = makeResource();

    const result = await resource.list();

    expect(result).toEqual([
      {
        id: "log-1",
        entity: "quantum-entity",
        category: "Device Management",
        action: "reboot",
        date: 1700000000000,
        site: { id: 1, name: "HQ" },
        deviceId: 42,
        hostname: "PC1",
        hasStdOut: false,
        hasStdErr: false,
      },
    ]);
    expect(descriptors).toEqual([{ kind: "read" }]);
    expect(scope.isDone()).toBe(true);
  });
});
