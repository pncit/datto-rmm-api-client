import nock from "nock";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccountResource } from "@/client/resources/account-resource";
import type { AccountVariableCreateInput } from "@/schema-overrides";

import { BASE_URL, makeResource as makeResourceOf } from "./test-harness";

function makeResource() {
  return makeResourceOf(AccountResource);
}

describe("AccountResource", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it("get() hits GET /api/v2/account and validates leniently (unknown key stripped)", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/account")
      .reply(200, { uid: "acct-1", name: "Acme", extra: "stripped" });
    const { resource, descriptors } = makeResource();

    const result = await resource.get();

    expect(result).toEqual({ uid: "acct-1", name: "Acme" });
    expect(descriptors).toEqual([{ kind: "read" }]);
    expect(scope.isDone()).toBe(true);
  });

  it("devices() paginates GET /api/v2/account/devices through the reconciled Device schema", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/account/devices")
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 1,
          prevPageUrl: null,
          nextPageUrl: null,
        },
        devices: [
          {
            uid: "dev-1",
            hostname: "PC1",
            deviceClass: "rmmnetworkdevice",
            udf: { udf1: "value1", udf7: null },
          },
        ],
      });
    const { resource, descriptors } = makeResource();

    const result = await resource.devices();

    expect(result).toEqual([
      {
        uid: "dev-1",
        hostname: "PC1",
        deviceClass: "rmmnetworkdevice",
        udf: { udf1: "value1", udf7: null },
      },
    ]);
    expect(descriptors).toEqual([{ kind: "read" }]);
    expect(scope.isDone()).toBe(true);
  });

  it("variables() paginates GET /api/v2/account/variables", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/account/variables")
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 1,
          prevPageUrl: null,
          nextPageUrl: null,
        },
        variables: [{ id: 1, name: "FOO", value: "bar", masked: false }],
      });
    const { resource } = makeResource();

    const result = await resource.variables();

    expect(result).toEqual([
      { id: 1, name: "FOO", value: "bar", masked: false },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it("createVariable() PUTs /api/v2/account/variable, tags account-variable-set, and rejects a malformed body", async () => {
    const scope = nock(BASE_URL)
      .put("/api/v2/account/variable", { name: "FOO" })
      .reply(200);
    const { resource, descriptors } = makeResource();

    await resource.createVariable({ name: "FOO" });

    expect(descriptors).toEqual([
      { kind: "write", opKey: "account-variable-set" },
    ]);
    expect(scope.isDone()).toBe(true);

    const { resource: resource2 } = makeResource();
    await expect(
      resource2.createVariable({
        value: "no name",
      } as unknown as AccountVariableCreateInput),
    ).rejects.toMatchObject({ name: "DattoValidationError", stage: "request" });
  });

  it("updateVariable() POSTs /api/v2/account/variable/{variableId} and tags account-variable-set", async () => {
    const scope = nock(BASE_URL)
      .post("/api/v2/account/variable/42", { value: "new-value" })
      .reply(200);
    const { resource, descriptors } = makeResource();

    await resource.updateVariable(42, { value: "new-value" });

    expect(descriptors).toEqual([
      { kind: "write", opKey: "account-variable-set" },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it("updateVariable() rejects an all-omitted body", async () => {
    const { resource } = makeResource();

    await expect(resource.updateVariable(42, {})).rejects.toMatchObject({
      name: "DattoValidationError",
      stage: "request",
    });
  });

  it("deleteVariable() DELETEs /api/v2/account/variable/{variableId} and reuses account-variable-set", async () => {
    const scope = nock(BASE_URL)
      .delete("/api/v2/account/variable/42")
      .reply(200);
    const { resource, descriptors } = makeResource();

    await resource.deleteVariable(42);

    expect(descriptors).toEqual([
      { kind: "write", opKey: "account-variable-set" },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it("components() paginates GET /api/v2/account/components", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/account/components")
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 1,
          prevPageUrl: null,
          nextPageUrl: null,
        },
        components: [
          { uid: "comp-1", name: "Script", credentialsRequired: null },
        ],
      });
    const { resource } = makeResource();

    const result = await resource.components();

    expect(result).toEqual([
      { uid: "comp-1", name: "Script", credentialsRequired: null },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it("dnetSiteMappings() paginates GET /api/v2/account/dnet-site-mappings", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/account/dnet-site-mappings")
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 1,
          prevPageUrl: null,
          nextPageUrl: null,
        },
        dnetSiteMappings: [{ uid: "site-1", name: "Site One" }],
      });
    const { resource } = makeResource();

    const result = await resource.dnetSiteMappings();

    expect(result).toEqual([{ uid: "site-1", name: "Site One" }]);
    expect(scope.isDone()).toBe(true);
  });
});
