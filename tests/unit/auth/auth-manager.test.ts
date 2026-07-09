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

import { AuthManager, type AuthManagerConfig } from "@/auth/auth-manager";
import { DattoApiError } from "@/errors";

const BASE_URL = "https://zinfandel-api.example.com";
const GRANT_PATH = "/auth/oauth/token";

function config(overrides: Partial<AuthManagerConfig> = {}): AuthManagerConfig {
  return {
    apiUrl: BASE_URL,
    apiKey: "test-key",
    apiSecret: "test-secret",
    ...overrides,
  };
}

describe("AuthManager", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    vi.useRealTimers();
  });

  it("fetches, caches, and reuses a token across getToken calls", async () => {
    const scope = nock(BASE_URL)
      .post(GRANT_PATH)
      .basicAuth({ user: "public-client", pass: "public" })
      .reply(200, { access_token: "tok-1", expires_in: 3600 });

    const manager = new AuthManager(config());
    const first = await manager.getToken();
    const second = await manager.getToken();

    expect(first.accessToken).toBe("tok-1");
    expect(second.accessToken).toBe("tok-1");
    expect(scope.isDone()).toBe(true);
  });

  it("sends the OAuth2 password grant with the caller's apiKey/apiSecret", async () => {
    let capturedBody: string | undefined;
    nock(BASE_URL)
      .post(GRANT_PATH, (body: string) => {
        capturedBody = body as unknown as string;
        return true;
      })
      .reply(200, { access_token: "tok-1", expires_in: 3600 });

    await new AuthManager(
      config({ apiKey: "my-key", apiSecret: "my-secret" }),
    ).getToken();

    const params = new URLSearchParams(capturedBody);
    expect(params.get("grant_type")).toBe("password");
    expect(params.get("username")).toBe("my-key");
    expect(params.get("password")).toBe("my-secret");
  });

  it("proactively refreshes once remaining lifetime falls below the default 25% threshold", async () => {
    const scope = nock(BASE_URL)
      .post(GRANT_PATH)
      .reply(200, { access_token: "tok-1", expires_in: 1000 })
      .post(GRANT_PATH)
      .reply(200, { access_token: "tok-2", expires_in: 1000 });

    const manager = new AuthManager(config());
    const first = await manager.getToken();
    expect(first.accessToken).toBe("tok-1");

    vi.useFakeTimers();
    // 760s elapsed of a 1000s TTL => 24% remaining, below the default 25% threshold.
    vi.setSystemTime(Date.now() + 760_000);

    const second = await manager.getToken();
    expect(second.accessToken).toBe("tok-2");
    expect(scope.isDone()).toBe(true);
  });

  it("does not refresh while remaining lifetime is still above the threshold", async () => {
    const scope = nock(BASE_URL)
      .post(GRANT_PATH)
      .reply(200, { access_token: "tok-1", expires_in: 1000 });

    const manager = new AuthManager(config());
    const first = await manager.getToken();
    expect(first.accessToken).toBe("tok-1");

    vi.useFakeTimers();
    // 100s elapsed of a 1000s TTL => 90% remaining, well above the default 25% threshold.
    vi.setSystemTime(Date.now() + 100_000);

    const second = await manager.getToken();
    expect(second.accessToken).toBe("tok-1");
    expect(scope.isDone()).toBe(true);
  });

  it("honors an explicit tokenRefreshPct override", async () => {
    nock(BASE_URL)
      .post(GRANT_PATH)
      .reply(200, { access_token: "tok-1", expires_in: 1000 })
      .post(GRANT_PATH)
      .reply(200, { access_token: "tok-2", expires_in: 1000 });

    // A 50% threshold refreshes far earlier than the default 25%.
    const manager = new AuthManager(config({ tokenRefreshPct: 50 }));
    await manager.getToken();

    vi.useFakeTimers();
    // 600s elapsed of 1000s TTL => 40% remaining: above default 25%, below the 50% override.
    vi.setSystemTime(Date.now() + 600_000);

    const second = await manager.getToken();
    expect(second.accessToken).toBe("tok-2");
  });

  it("throws DattoApiError when the grant request fails", async () => {
    nock(BASE_URL)
      .post(GRANT_PATH)
      .reply(401, { message: "invalid credentials" });

    const manager = new AuthManager(config());

    await expect(manager.getToken()).rejects.toBeInstanceOf(DattoApiError);
  });

  it("throws DattoApiError with statusCode 0 on a transport-level failure", async () => {
    nock(BASE_URL).post(GRANT_PATH).replyWithError("network down");

    const manager = new AuthManager(config());
    const error = await manager.getToken().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DattoApiError);
    expect((error as DattoApiError).statusCode).toBe(0);
  });

  it("does not expose apiKey/apiSecret anywhere reachable via the thrown error's cause on a failed grant", async () => {
    nock(BASE_URL)
      .post(GRANT_PATH)
      .reply(401, { message: "invalid credentials" });

    const manager = new AuthManager(
      config({ apiKey: "super-secret-key", apiSecret: "super-secret-value" }),
    );
    const error = await manager.getToken().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DattoApiError);
    const serialized = JSON.stringify(
      error,
      Object.getOwnPropertyNames(error as object),
    );
    expect(serialized).not.toContain("super-secret-key");
    expect(serialized).not.toContain("super-secret-value");
  });

  it("coalesces concurrent getToken calls against a cold cache into a single grant round-trip", async () => {
    const scope = nock(BASE_URL)
      .post(GRANT_PATH)
      .once()
      .reply(200, { access_token: "tok-1", expires_in: 3600 });

    const manager = new AuthManager(config());
    const [first, second, third] = await Promise.all([
      manager.getToken(),
      manager.getToken(),
      manager.getToken(),
    ]);

    expect(first.accessToken).toBe("tok-1");
    expect(second.accessToken).toBe("tok-1");
    expect(third.accessToken).toBe("tok-1");
    expect(scope.isDone()).toBe(true);
  });

  it("throws DattoApiError when a 200 grant response is missing access_token/expires_in", async () => {
    nock(BASE_URL).post(GRANT_PATH).reply(200, { expires_in: 3600 });

    const manager = new AuthManager(config());
    const error = await manager.getToken().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DattoApiError);
  });

  it("throws DattoApiError when a 200 grant response has a non-numeric expires_in", async () => {
    nock(BASE_URL)
      .post(GRANT_PATH)
      .reply(200, { access_token: "live-bearer-token", expires_in: "soon" });

    const manager = new AuthManager(config());
    const error = await manager.getToken().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DattoApiError);
    expect((error as DattoApiError).response).toBeUndefined();
    const serialized = JSON.stringify(
      error,
      Object.getOwnPropertyNames(error as object),
    );
    expect(serialized).not.toContain("live-bearer-token");
  });

  it("treats a stalled grant request exceeding timeoutMs as a transport failure", async () => {
    nock(BASE_URL)
      .post(GRANT_PATH)
      .delay(50)
      .reply(200, { access_token: "tok-1", expires_in: 3600 });

    const manager = new AuthManager(config({ timeoutMs: 10 }));
    const error = await manager.getToken().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DattoApiError);
    expect((error as DattoApiError).statusCode).toBe(0);
  }, 10_000);
});

describe("AuthManager.attachTo", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it("attaches a Bearer Authorization header to requests on the shared instance", async () => {
    nock(BASE_URL)
      .post(GRANT_PATH)
      .reply(200, { access_token: "tok-1", expires_in: 3600 });
    const scope = nock(BASE_URL)
      .get("/api/v2/account/devices")
      .matchHeader("Authorization", "Bearer tok-1")
      .reply(200, { devices: [] });

    const manager = new AuthManager(config());
    const sharedInstance = axios.create({ baseURL: BASE_URL });
    manager.attachTo(sharedInstance);

    await sharedInstance.get("/api/v2/account/devices");

    expect(scope.isDone()).toBe(true);
  });

  it("does not retry a failed grant (the bare grantClient carries no retry interceptor)", async () => {
    // Only one interceptor is registered for the grant path; if refreshToken's own bare
    // instance retried on failure (the way the shared http-client's 5xx/network-error retry
    // does), this request would exhaust the mock and nock would report an unmatched request
    // instead of the scope completing with exactly one call.
    const grantScope = nock(BASE_URL)
      .post(GRANT_PATH)
      .once()
      .reply(503, { message: "down" });

    const manager = new AuthManager(config());
    const sharedInstance = axios.create({ baseURL: BASE_URL });
    manager.attachTo(sharedInstance);

    const error = await sharedInstance
      .get("/api/v2/account/devices")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DattoApiError);
    expect(grantScope.isDone()).toBe(true);
  });
});
