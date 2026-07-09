import nock from "nock";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AlertResource } from "@/client/resources/alert-resource";

import { BASE_URL, makeResource as makeResourceOf } from "./test-harness";

function makeResource() {
  return makeResourceOf(AlertResource);
}

const ALERT_PAGE = {
  pageDetails: {
    count: 1,
    totalCount: 1,
    prevPageUrl: null,
    nextPageUrl: null,
  },
  alerts: [
    {
      alertUid: "alert-1",
      priority: "Critical",
      alertContext: { "@class": "comp_script_ctx", exitCode: 1 },
    },
  ],
};

const EXPECTED_ALERT = {
  alertUid: "alert-1",
  priority: "Critical",
  alertContext: { "@class": "comp_script_ctx", exitCode: 1 },
};

describe("AlertResource", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it("get() hits GET /api/v2/alert/{uid} and validates the open @class alertContext", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/alert/alert-1")
      .reply(200, EXPECTED_ALERT);
    const { resource } = makeResource();

    const result = await resource.get("alert-1");

    expect(result).toEqual(EXPECTED_ALERT);
    expect(scope.isDone()).toBe(true);
  });

  it("resolve() POSTs /api/v2/alert/{uid}/resolve with no body and tags alert-resolve", async () => {
    const scope = nock(BASE_URL)
      .post("/api/v2/alert/alert-1/resolve")
      .reply(200);
    const { resource, descriptors } = makeResource();

    await resource.resolve("alert-1");

    expect(descriptors).toEqual([{ kind: "write", opKey: "alert-resolve" }]);
    expect(scope.isDone()).toBe(true);
  });

  it("mute() POSTs /api/v2/alert/{uid}/mute and tags alert-mute", async () => {
    const scope = nock(BASE_URL).post("/api/v2/alert/alert-1/mute").reply(200);
    const { resource, descriptors } = makeResource();

    await resource.mute("alert-1");

    expect(descriptors).toEqual([{ kind: "write", opKey: "alert-mute" }]);
    expect(scope.isDone()).toBe(true);
  });

  it("unmute() POSTs /api/v2/alert/{uid}/unmute and tags alert-unmute", async () => {
    const scope = nock(BASE_URL)
      .post("/api/v2/alert/alert-1/unmute")
      .reply(200);
    const { resource, descriptors } = makeResource();

    await resource.unmute("alert-1");

    expect(descriptors).toEqual([{ kind: "write", opKey: "alert-unmute" }]);
    expect(scope.isDone()).toBe(true);
  });

  it("open() paginates GET /api/v2/account/alerts/open", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/account/alerts/open")
      .reply(200, ALERT_PAGE);
    const { resource } = makeResource();

    const result = await resource.open();

    expect(result).toEqual([EXPECTED_ALERT]);
    expect(scope.isDone()).toBe(true);
  });

  it("resolved() paginates GET /api/v2/account/alerts/resolved", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/account/alerts/resolved")
      .reply(200, ALERT_PAGE);
    const { resource } = makeResource();

    const result = await resource.resolved();

    expect(result).toEqual([EXPECTED_ALERT]);
    expect(scope.isDone()).toBe(true);
  });

  it("openForSite() paginates GET /api/v2/site/{siteUid}/alerts/open (design's public-surface example)", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/site/site-1/alerts/open")
      .reply(200, ALERT_PAGE);
    const { resource } = makeResource();

    const result = await resource.openForSite("site-1");

    expect(result).toEqual([EXPECTED_ALERT]);
    expect(scope.isDone()).toBe(true);
  });

  it("resolvedForSite() paginates GET /api/v2/site/{siteUid}/alerts/resolved", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/site/site-1/alerts/resolved")
      .reply(200, ALERT_PAGE);
    const { resource } = makeResource();

    const result = await resource.resolvedForSite("site-1");

    expect(result).toEqual([EXPECTED_ALERT]);
    expect(scope.isDone()).toBe(true);
  });

  it("openForDevice() paginates GET /api/v2/device/{deviceUid}/alerts/open", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/device/dev-1/alerts/open")
      .reply(200, ALERT_PAGE);
    const { resource } = makeResource();

    const result = await resource.openForDevice("dev-1");

    expect(result).toEqual([EXPECTED_ALERT]);
    expect(scope.isDone()).toBe(true);
  });

  it("resolvedForDevice() paginates GET /api/v2/device/{deviceUid}/alerts/resolved", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/device/dev-1/alerts/resolved")
      .reply(200, ALERT_PAGE);
    const { resource } = makeResource();

    const result = await resource.resolvedForDevice("dev-1");

    expect(result).toEqual([EXPECTED_ALERT]);
    expect(scope.isDone()).toBe(true);
  });
});
