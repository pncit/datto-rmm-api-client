import nock from "nock";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { FilterResource } from "@/client/resources/filter-resource";

import { BASE_URL, makeResource as makeResourceOf } from "./test-harness";

function makeResource() {
  return makeResourceOf(FilterResource);
}

describe("FilterResource", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it("defaults() paginates GET /api/v2/filter/default-filters", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/filter/default-filters")
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 1,
          prevPageUrl: null,
          nextPageUrl: null,
        },
        filters: [{ id: 1, name: "All Devices", type: "rmm_default" }],
      });
    const { resource, descriptors } = makeResource();

    const result = await resource.defaults();

    expect(result).toEqual([
      { id: 1, name: "All Devices", type: "rmm_default" },
    ]);
    expect(descriptors).toEqual([{ kind: "read" }]);
    expect(scope.isDone()).toBe(true);
  });

  it("custom() paginates GET /api/v2/filter/custom-filters and widens an unobserved type (R5)", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/filter/custom-filters")
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 1,
          prevPageUrl: null,
          nextPageUrl: null,
        },
        filters: [{ id: 2, name: "My Filter", type: "quantum-filter" }],
      });
    const { resource } = makeResource();

    const result = await resource.custom();

    expect(result).toEqual([{ id: 2, name: "My Filter", type: "quantum-filter" }]);
    expect(scope.isDone()).toBe(true);
  });
});
