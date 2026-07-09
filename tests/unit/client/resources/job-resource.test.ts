import axios from "axios";
import nock from "nock";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { JobResource } from "@/client/resources/job-resource";
import type { DattoLogger } from "@/logging/logger";
import type { RateDescriptor } from "@/rate-limit/rate-limiter";

const BASE_URL = "https://zinfandel-api.example.com";

function createMockLogger(): DattoLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createTrackedAxios() {
  const instance = axios.create({ baseURL: BASE_URL });
  const descriptors: RateDescriptor[] = [];
  instance.interceptors.request.use((config) => {
    if (config.rateDescriptor) {
      descriptors.push(config.rateDescriptor);
    }
    return config;
  });
  return { instance, descriptors };
}

function makeResource() {
  const { instance, descriptors } = createTrackedAxios();
  const logger = createMockLogger();
  return { resource: new JobResource(instance, logger), descriptors, logger };
}

describe("JobResource", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it("get() hits GET /api/v2/job/{uid} and widens an unobserved job status (R5)", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/job/job-1")
      .reply(200, { uid: "job-1", name: "Reboot", status: "quantum-status" });
    const { resource, descriptors } = makeResource();

    const result = await resource.get("job-1");

    expect(result).toEqual({
      uid: "job-1",
      name: "Reboot",
      status: "quantum-status",
    });
    expect(descriptors).toEqual([{ kind: "read" }]);
    expect(scope.isDone()).toBe(true);
  });

  it("getResults() hits GET /api/v2/job/{jobUid}/results/{deviceUid}", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/job/job-1/results/dev-1")
      .reply(200, {
        jobUid: "job-1",
        deviceUid: "dev-1",
        jobDeploymentStatus: "Success",
      });
    const { resource } = makeResource();

    const result = await resource.getResults("job-1", "dev-1");

    expect(result).toEqual({
      jobUid: "job-1",
      deviceUid: "dev-1",
      jobDeploymentStatus: "Success",
    });
    expect(scope.isDone()).toBe(true);
  });

  it("getStdOut() hits the bare-array endpoint", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/job/job-1/results/dev-1/stdout")
      .reply(200, [{ componentUid: "comp-1", stdData: "hello" }]);
    const { resource, descriptors } = makeResource();

    const result = await resource.getStdOut("job-1", "dev-1");

    expect(result).toEqual([{ componentUid: "comp-1", stdData: "hello" }]);
    expect(descriptors).toEqual([{ kind: "read" }]);
    expect(scope.isDone()).toBe(true);
  });

  it("getStdErr() hits the bare-array endpoint", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/job/job-1/results/dev-1/stderr")
      .reply(200, [{ componentUid: "comp-1", stdData: "oops" }]);
    const { resource } = makeResource();

    const result = await resource.getStdErr("job-1", "dev-1");

    expect(result).toEqual([{ componentUid: "comp-1", stdData: "oops" }]);
    expect(scope.isDone()).toBe(true);
  });

  it("getComponents() paginates GET /api/v2/job/{uid}/components", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/job/job-1/components")
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 1,
          prevPageUrl: null,
          nextPageUrl: null,
        },
        jobComponents: [
          {
            uid: "comp-1",
            name: "Script",
            variables: [{ name: "x", value: "1" }],
          },
        ],
      });
    const { resource } = makeResource();

    const result = await resource.getComponents("job-1");

    expect(result).toEqual([
      { uid: "comp-1", name: "Script", variables: [{ name: "x", value: "1" }] },
    ]);
    expect(scope.isDone()).toBe(true);
  });
});
