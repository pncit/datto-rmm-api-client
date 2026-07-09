import nock from "nock";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { UserResource } from "@/client/resources/user-resource";

import { BASE_URL, makeResource as makeResourceOf } from "./test-harness";

function makeResource() {
  return makeResourceOf(UserResource);
}

describe("UserResource", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it("list() paginates GET /api/v2/account/users", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/account/users")
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 1,
          prevPageUrl: null,
          nextPageUrl: null,
        },
        users: [
          {
            username: "jdoe",
            firstName: "Jane",
            lastName: "Doe",
            created: 1700000000000,
            lastAccess: 1700003600000,
            disabled: false,
          },
        ],
      });
    const { resource, descriptors } = makeResource();

    const result = await resource.list();

    expect(result).toEqual([
      {
        username: "jdoe",
        firstName: "Jane",
        lastName: "Doe",
        created: 1700000000000,
        lastAccess: 1700003600000,
        disabled: false,
      },
    ]);
    expect(descriptors).toEqual([{ kind: "read" }]);
    expect(scope.isDone()).toBe(true);
  });

  it("resetKeys() POSTs the bodiless /api/v2/user/resetApiKeys and tags user-reset-keys", async () => {
    const scope = nock(BASE_URL)
      .post("/api/v2/user/resetApiKeys")
      .reply(200, {
        apiAccessKey: "new-access-key",
        apiSecretKey: "new-secret-key",
        userName: "jdoe",
      });
    const { resource, descriptors } = makeResource();

    const result = await resource.resetKeys();

    expect(result).toEqual({
      apiAccessKey: "new-access-key",
      apiSecretKey: "new-secret-key",
      userName: "jdoe",
    });
    expect(descriptors).toEqual([{ kind: "write", opKey: "user-reset-keys" }]);
    expect(scope.isDone()).toBe(true);
  });
});
