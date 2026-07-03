import { createDattoRmmClient } from "../client";
import { DevicesEnvelopeSchema } from "../internal/devicesEnvelope";
import { LoggerLike } from "../logger";
import { ZodError } from "zod/v4";
import * as fs from "fs";
import * as path from "path";

const devicesPage = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/devicesPage.json"), "utf-8"),
);
const devicesPage1 = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/devicesPage1.json"), "utf-8"),
);
const devicesPage2 = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/devicesPage2.json"), "utf-8"),
);
const device = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/device.json"), "utf-8"),
);

const AUTH_URL = "https://example.com/auth/oauth/token";
const DEVICES_URL = "https://example.com/api/v2/account/devices";
const DEVICES_URL_PAGE2 = "https://example.com/api/v2/account/devices?page=2";

const authResponses = {
  [AUTH_URL]: { access_token: "token", expires_in: 3600 },
};

class MockAxios {
  requests: any[] = [];
  constructor(private responses: Record<string, any>) {}
  async request(config: any) {
    this.requests.push(config);
    // Use `hasOwnProperty` (not truthiness) so a deliberately falsy configured response (e.g.
    // `null`, to simulate an empty/off-mode body) is distinguishable from "no response set up".
    if (!Object.prototype.hasOwnProperty.call(this.responses, config.url)) {
      throw new Error(`Unexpected request to ${config.url}`);
    }
    return { data: this.responses[config.url] };
  }
}

function mockLogger(): LoggerLike {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

/** Clones the valid device fixture with the given top-level overrides applied. */
function withOverrides(overrides: Record<string, unknown>) {
  return { ...device, ...overrides };
}

/** A device that diverges from DeviceSchema via an out-of-enum deviceClass. */
function divergentDevice(overrides: Record<string, unknown> = {}) {
  return withOverrides({ deviceClass: "router", ...overrides });
}

test("getAccountDevices returns validated data", async () => {
  const responses = {
    ...authResponses,
    [DEVICES_URL]: devicesPage,
  };
  const mockAxios = new MockAxios(responses) as any;

  const client = createDattoRmmClient({
    apiUrl: "https://example.com",
    apiKey: "k",
    apiSecret: "s",
    axiosInstance: mockAxios,
  });

  const result = await client.getAccountDevices();
  expect(result.ok).toBe(true);
  const devices = (result as any).value;
  expect(devices.length).toBe(1);
  expect(devices[0].hostname).toBe("server1");
  expect(devices[0].antivirus?.antivirusStatus).toBe("RunningAndUpToDate");
});

test("getAccountDevices paginates automatically", async () => {
  const responses = {
    ...authResponses,
    [DEVICES_URL]: devicesPage1,
    [DEVICES_URL_PAGE2]: devicesPage2,
  };
  const mockAxios = new MockAxios(responses) as any;

  const client = createDattoRmmClient({
    apiUrl: "https://example.com",
    apiKey: "k",
    apiSecret: "s",
    axiosInstance: mockAxios,
  });

  const result = await client.getAccountDevices();
  expect(result.ok).toBe(true);
  const devices = (result as any).value;
  expect(devices.length).toBe(2);
  expect(devices[1].hostname).toBe("server2");
  expect(mockAxios.requests.map((r: any) => r.url)).toEqual([
    AUTH_URL,
    DEVICES_URL,
    DEVICES_URL_PAGE2,
  ]);
});

describe("DevicesEnvelopeSchema", () => {
  test("accepts every existing page fixture (envelope-vs-DevicesPageSchema consistency)", () => {
    expect(DevicesEnvelopeSchema.safeParse(devicesPage).success).toBe(true);
    expect(DevicesEnvelopeSchema.safeParse(devicesPage1).success).toBe(true);
    expect(DevicesEnvelopeSchema.safeParse(devicesPage2).success).toBe(true);
  });
});

describe("getAccountDevices resilient validation", () => {
  function buildClient(
    responses: Record<string, any>,
    opts: {
      validationMode?: "strict" | "warn" | "off";
      logger?: LoggerLike;
    } = {},
  ) {
    const mockAxios = new MockAxios(responses) as any;
    return createDattoRmmClient({
      apiUrl: "https://example.com",
      apiKey: "k",
      apiSecret: "s",
      axiosInstance: mockAxios,
      validationMode: opts.validationMode,
      logger: opts.logger,
    });
  }

  test("strict, a clean page returns an empty warnings[] array, not an omitted field", async () => {
    const logger = mockLogger();
    const client = buildClient(
      {
        ...authResponses,
        [DEVICES_URL]: {
          pageDetails: {
            count: 1,
            totalCount: 1,
            prevPageUrl: null,
            nextPageUrl: null,
          },
          devices: [device],
        },
      },
      { logger },
    );

    const result = await client.getAccountDevices();
    expect(result.ok).toBe(true);
    const r = result as any;
    expect(Array.isArray(r.warnings)).toBe(true);
    expect(r.warnings.length).toBe(0);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("strict, a mixed page returns only the valid device, one warning, and one error log (R1, R2, R3)", async () => {
    const logger = mockLogger();
    const divergent = divergentDevice({ id: 2, uid: "device-uid-2" });
    const client = buildClient(
      {
        ...authResponses,
        [DEVICES_URL]: {
          pageDetails: {
            count: 2,
            totalCount: 2,
            prevPageUrl: null,
            nextPageUrl: null,
          },
          devices: [device, divergent],
        },
      },
      { logger },
    );

    const result = await client.getAccountDevices();
    expect(result.ok).toBe(true);
    const r = result as any;
    expect(r.value.length).toBe(1);
    expect(r.value[0].id).toBe(1);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0].type).toBe("validation-error");
    expect(r.warnings[0].detail).toContain("id=2");
    expect(r.warnings[0].detail).toContain("deviceClass");
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test("strict, a malformed envelope (devices not an array) hard-fails with a concise, path-named detail and logs (R5)", async () => {
    const logger = mockLogger();
    const client = buildClient(
      {
        ...authResponses,
        [DEVICES_URL]: {
          pageDetails: {
            count: 0,
            totalCount: 0,
            prevPageUrl: null,
            nextPageUrl: null,
          },
          devices: "nope",
        },
      },
      { logger },
    );

    const result = await client.getAccountDevices();
    expect(result.ok).toBe(false);
    const r = result as any;
    expect(r.error.type).toBe("validation-error");
    expect(r.error.title).toBe("Malformed devices page envelope");
    expect(r.error.detail).toMatch(/^Malformed devices page envelope \(path:/);
    expect(r.error.detail).toContain("devices");
    expect(r.error.detail).not.toContain("\n");
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["null", null],
    ["a primitive string (e.g. an HTML error page)", "<html>not json</html>"],
  ])(
    "strict, a non-object body (%s) hard-fails as a malformed envelope and logs (R5)",
    async (_label, body) => {
      const logger = mockLogger();
      const client = buildClient(
        { ...authResponses, [DEVICES_URL]: body },
        { logger },
      );

      const result = await client.getAccountDevices();
      expect(result.ok).toBe(false);
      const r = result as any;
      expect(r.error.type).toBe("validation-error");
      expect(r.error.title).toBe("Malformed devices page envelope");
      expect(logger.error).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    ["an empty object", {}],
    ["an auth-error-shaped body", { error: "unauthorized" }],
  ])(
    "strict, a 200 body that is %s (lacking both pageDetails and devices) is an empty page, not a hard-fail",
    async (_label, body) => {
      const logger = mockLogger();
      const client = buildClient(
        { ...authResponses, [DEVICES_URL]: body },
        { logger },
      );

      const result = await client.getAccountDevices();
      expect(result.ok).toBe(true);
      const r = result as any;
      expect(r.value).toEqual([]);
      expect(r.warnings).toEqual([]);
      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  test("strict, valid devices and warnings accumulate across pages (R1, R2, R3)", async () => {
    const logger = mockLogger();
    const divergent1 = divergentDevice({ id: 11, uid: "device-uid-11" });
    const valid2 = withOverrides({ id: 2, uid: "device-uid-2" });
    const divergent2 = divergentDevice({ id: 22, uid: "device-uid-22" });

    const client = buildClient(
      {
        ...authResponses,
        [DEVICES_URL]: {
          pageDetails: {
            count: 2,
            totalCount: 4,
            prevPageUrl: null,
            nextPageUrl: DEVICES_URL_PAGE2,
          },
          devices: [device, divergent1],
        },
        [DEVICES_URL_PAGE2]: {
          pageDetails: {
            count: 2,
            totalCount: 4,
            prevPageUrl: DEVICES_URL,
            nextPageUrl: null,
          },
          devices: [valid2, divergent2],
        },
      },
      { logger },
    );

    const result = await client.getAccountDevices();
    expect(result.ok).toBe(true);
    const r = result as any;
    expect(r.value.map((d: any) => d.id).sort()).toEqual([1, 2]);
    expect(r.warnings.length).toBe(2);
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  test("strict, a later page's malformed envelope discards earlier pages' valid devices and warnings (R5)", async () => {
    const logger = mockLogger();
    const divergent1 = divergentDevice({ id: 11, uid: "device-uid-11" });

    const client = buildClient(
      {
        ...authResponses,
        [DEVICES_URL]: {
          pageDetails: {
            count: 2,
            totalCount: 2,
            prevPageUrl: null,
            nextPageUrl: DEVICES_URL_PAGE2,
          },
          devices: [device, divergent1],
        },
        [DEVICES_URL_PAGE2]: {
          pageDetails: {
            count: 0,
            totalCount: 2,
            prevPageUrl: DEVICES_URL,
            nextPageUrl: null,
          },
          devices: "nope",
        },
      },
      { logger },
    );

    const result = await client.getAccountDevices();
    expect(result.ok).toBe(false);
    const r = result as any;
    expect(r.error.type).toBe("validation-error");
    expect(r.error.title).toBe("Malformed devices page envelope");
    expect(r.value).toBeUndefined();
    const errorMessages = (logger.error as jest.Mock).mock.calls.map((c) =>
      String(c[0]),
    );
    expect(
      errorMessages.some((m) => m.includes("Malformed devices page envelope")),
    ).toBe(true);
  });

  test("warn, a divergent device stays in value and is logged via logger.warn, not console (R6, R8)", async () => {
    const consoleWarnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    try {
      const logger = mockLogger();
      const divergent = divergentDevice({ id: 2, uid: "device-uid-2" });
      const client = buildClient(
        {
          ...authResponses,
          [DEVICES_URL]: {
            pageDetails: {
              count: 2,
              totalCount: 2,
              prevPageUrl: null,
              nextPageUrl: null,
            },
            devices: [device, divergent],
          },
        },
        { validationMode: "warn", logger },
      );

      const result = await client.getAccountDevices();
      expect(result.ok).toBe(true);
      const r = result as any;
      expect(r.value.length).toBe(2);
      expect(r.value.some((d: any) => d.id === 2)).toBe(true);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  test("warn, a malformed envelope still hard-fails and logs via logger.error (R5, Breaking Change #2)", async () => {
    const logger = mockLogger();
    const client = buildClient(
      {
        ...authResponses,
        [DEVICES_URL]: {
          pageDetails: {
            count: 0,
            totalCount: 0,
            prevPageUrl: null,
            nextPageUrl: null,
          },
          devices: "nope",
        },
      },
      { validationMode: "warn", logger },
    );

    const result = await client.getAccountDevices();
    expect(result.ok).toBe(false);
    const r = result as any;
    expect(r.error.type).toBe("validation-error");
    expect(r.error.title).toBe("Malformed devices page envelope");
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test("warn, a non-object body (null) hard-fails as a malformed envelope and logs (R5, Breaking Change #2)", async () => {
    const logger = mockLogger();
    const client = buildClient(
      { ...authResponses, [DEVICES_URL]: null },
      { validationMode: "warn", logger },
    );

    const result = await client.getAccountDevices();
    expect(result.ok).toBe(false);
    const r = result as any;
    expect(r.error.type).toBe("validation-error");
    expect(r.error.title).toBe("Malformed devices page envelope");
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test("off, a divergent device flows through untouched with no envelope check and no logger calls (R8)", async () => {
    const logger = mockLogger();
    const divergent = divergentDevice({ id: 2, uid: "device-uid-2" });
    const client = buildClient(
      {
        ...authResponses,
        [DEVICES_URL]: {
          pageDetails: {
            count: 2,
            totalCount: 2,
            prevPageUrl: null,
            nextPageUrl: null,
          },
          devices: [device, divergent],
        },
      },
      { validationMode: "off", logger },
    );

    const result = await client.getAccountDevices();
    expect(result.ok).toBe(true);
    const r = result as any;
    expect(r.value.length).toBe(2);
    expect(r.value.find((d: any) => d.id === 2).deviceClass).toBe("router");
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("off, a non-array devices field does not throw (Result-contract guard)", async () => {
    const logger = mockLogger();
    const client = buildClient(
      {
        ...authResponses,
        [DEVICES_URL]: {
          pageDetails: {
            count: 0,
            totalCount: 0,
            prevPageUrl: null,
            nextPageUrl: null,
          },
          devices: { unexpected: "shape" },
        },
      },
      { validationMode: "off", logger },
    );

    await expect(client.getAccountDevices()).resolves.toEqual({
      ok: true,
      value: [],
      warnings: [],
    });
  });

  test("off, a null page body does not throw (Result-contract guard, two dereference sites)", async () => {
    const logger = mockLogger();
    const client = buildClient(
      { ...authResponses, [DEVICES_URL]: null },
      { validationMode: "off", logger },
    );

    await expect(client.getAccountDevices()).resolves.toEqual({
      ok: true,
      value: [],
      warnings: [],
    });
  });

  test("off, a primitive (string) page body does not throw (Result-contract guard)", async () => {
    const logger = mockLogger();
    const client = buildClient(
      { ...authResponses, [DEVICES_URL]: "<html>not a devices page</html>" },
      { validationMode: "off", logger },
    );

    await expect(client.getAccountDevices()).resolves.toEqual({
      ok: true,
      value: [],
      warnings: [],
    });
  });
});

describe("getDeviceByUid", () => {
  const DEVICE_URL = "https://example.com/api/v2/device/device-uid-1";

  test("strict, a divergent device fails hard and logs once via the shared ProblemError shape (R7)", async () => {
    const logger = mockLogger();
    const divergent = divergentDevice();
    const mockAxios = new MockAxios({
      ...authResponses,
      [DEVICE_URL]: divergent,
    }) as any;
    const client = createDattoRmmClient({
      apiUrl: "https://example.com",
      apiKey: "k",
      apiSecret: "s",
      axiosInstance: mockAxios,
      logger,
    });

    const result = await client.getDeviceByUid("device-uid-1");
    expect(result.ok).toBe(false);
    const r = result as any;
    expect(r.error.type).toBe("validation-error");
    expect(r.error.title).toBe("Device failed schema validation");
    expect(r.error.raw).toBeInstanceOf(ZodError);
    expect(r.error.detail).toContain("id=1");
    expect(r.error.detail).toContain("deviceClass");

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message] = (logger.error as jest.Mock).mock.calls[0];
    expect(message).toContain("id=1");
    expect(message).toContain("deviceClass");
    // Must not duplicate the standalone word "Device" (e.g. a "Device ... for {uid}" prefix on
    // top of a detail that already begins with "Device ..."). Word-boundary match so the
    // "Device" substring inside the unrelated "getDeviceByUid" prefix isn't miscounted.
    expect((message.match(/\bDevice\b/g) || []).length).toBe(1);
  });

  test("warn, a divergent device passes through raw and logs the failing path via logger.warn (R6)", async () => {
    const logger = mockLogger();
    const divergent = divergentDevice();
    const mockAxios = new MockAxios({
      ...authResponses,
      [DEVICE_URL]: divergent,
    }) as any;
    const client = createDattoRmmClient({
      apiUrl: "https://example.com",
      apiKey: "k",
      apiSecret: "s",
      axiosInstance: mockAxios,
      validationMode: "warn",
      logger,
    });

    const result = await client.getDeviceByUid("device-uid-1");
    expect(result.ok).toBe(true);
    const r = result as any;
    expect(r.value.deviceClass).toBe("router");

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message] = (logger.warn as jest.Mock).mock.calls[0];
    expect(message).toContain("deviceClass");
    expect(message).not.toContain("\n");
  });
});
