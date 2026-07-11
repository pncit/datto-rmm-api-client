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
import type {
  DattoHttpErrorEvent,
  DattoHttpObserver,
  DattoHttpRequestEvent,
  DattoHttpResponseEvent,
} from "@/http/http-observer";

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

/** Discriminated-union tuple for captured observer events, mirroring `http-client.test.ts`'s
 * helper — indexing narrows via the discriminant (`event[0]`), so recovering the concrete
 * payload never needs an `as` cast. */
type ObserverEvent =
  | ["request", DattoHttpRequestEvent]
  | ["response", DattoHttpResponseEvent]
  | ["error", DattoHttpErrorEvent];

function requestPayload(event: ObserverEvent | undefined): DattoHttpRequestEvent {
  if (!event || event[0] !== "request") {
    throw new Error(`expected a "request" event, got ${event?.[0] ?? "undefined"}`);
  }
  return event[1];
}

function responsePayload(event: ObserverEvent | undefined): DattoHttpResponseEvent {
  if (!event || event[0] !== "response") {
    throw new Error(`expected a "response" event, got ${event?.[0] ?? "undefined"}`);
  }
  return event[1];
}

describe("AuthManager — httpObserver", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it("fires onRequest then onResponse for a successful grant, with the raw urlencoded body and no Authorization in the captured headers", async () => {
    const scope = nock(BASE_URL)
      .post(GRANT_PATH)
      .reply(200, { access_token: "tok-1", expires_in: 3600 });
    const events: ObserverEvent[] = [];
    const observer: DattoHttpObserver = {
      onRequest: (e) => events.push(["request", e]),
      onResponse: (e) => events.push(["response", e]),
      onError: (e) => events.push(["error", e]),
    };

    const manager = new AuthManager(
      config({ apiKey: "my-key", apiSecret: "my-secret", httpObserver: observer }),
    );
    await manager.getToken();

    expect(events.map(([kind]) => kind)).toEqual(["request", "response"]);
    const requestEvent = requestPayload(events[0]);
    expect(requestEvent.method).toBe("POST");
    expect(requestEvent.url).toBe(`${BASE_URL}${GRANT_PATH}`);
    expect(requestEvent.headers.Authorization).toBeUndefined();
    expect(typeof requestEvent.body).toBe("string");
    const params = new URLSearchParams(requestEvent.body as string);
    expect(params.get("grant_type")).toBe("password");
    expect(params.get("username")).toBe("my-key");
    expect(params.get("password")).toBe("my-secret");

    const responseEvent = responsePayload(events[1]);
    expect(responseEvent.statusCode).toBe(200);
    expect(responseEvent.responseBody).toEqual({
      access_token: "tok-1",
      expires_in: 3600,
    });
    expect(responseEvent.requestBody).toBe(requestEvent.body);
    expect(typeof responseEvent.durationMs).toBe("number");
    expect(scope.isDone()).toBe(true);
  });

  it("fires exactly one terminal event (onResponse, with the raw response body) and no onError for a 2xx malformed-token grant", async () => {
    nock(BASE_URL)
      .post(GRANT_PATH)
      .reply(200, { expires_in: 3600 });
    const events: ObserverEvent[] = [];
    const observer: DattoHttpObserver = {
      onRequest: (e) => events.push(["request", e]),
      onResponse: (e) => events.push(["response", e]),
      onError: (e) => events.push(["error", e]),
    };

    const manager = new AuthManager(config({ httpObserver: observer }));
    const error = await manager.getToken().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DattoApiError);
    expect(events.map(([kind]) => kind)).toEqual(["request", "response"]);
    const responseEvent = responsePayload(events[1]);
    expect(responseEvent.statusCode).toBe(200);
    expect(responseEvent.responseBody).toEqual({ expires_in: 3600 });
  });

  it("fires onError with the raw caught error (identity-equal, not the constructed DattoApiError) and statusCode present for a non-2xx grant, while still throwing a DattoApiError", async () => {
    nock(BASE_URL)
      .post(GRANT_PATH)
      .reply(401, { message: "invalid credentials" });
    const errorEvents: DattoHttpErrorEvent[] = [];
    const observer: DattoHttpObserver = { onError: (e) => errorEvents.push(e) };
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const manager = new AuthManager(
      config({ httpObserver: observer, logger }),
    );
    const error = await manager.getToken().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DattoApiError);
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.statusCode).toBe(401);
    expect(errorEvents[0]!.error).not.toBeInstanceOf(DattoApiError);
    expect(axios.isAxiosError(errorEvents[0]!.error)).toBe(true);
    expect(errorEvents[0]!.error).not.toBe(error);
    expect(logger.warn).toHaveBeenCalledWith(
      "Datto RMM OAuth2 token refresh failed",
    );
  });

  it("fires onError with no statusCode for a transport-level grant failure, while still throwing a DattoApiError", async () => {
    nock(BASE_URL).post(GRANT_PATH).replyWithError("network down");
    const errorEvents: DattoHttpErrorEvent[] = [];
    const observer: DattoHttpObserver = { onError: (e) => errorEvents.push(e) };

    const manager = new AuthManager(config({ httpObserver: observer }));
    const error = await manager.getToken().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DattoApiError);
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.statusCode).toBeUndefined();
    expect(errorEvents[0]!.error).not.toBeInstanceOf(DattoApiError);
  });

  it("swallows a throwing onRequest and a rejecting onResponse without altering the grant outcome, logging one warn each", async () => {
    nock(BASE_URL)
      .post(GRANT_PATH)
      .reply(200, { access_token: "tok-1", expires_in: 3600 });
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const observer: DattoHttpObserver = {
      onRequest: () => {
        throw new Error("boom");
      },
      onResponse: () => Promise.reject(new Error("nope")),
    };

    const manager = new AuthManager(config({ httpObserver: observer, logger }));
    const token = await manager.getToken();
    // Flush the microtask queue so the rejected onResponse's swallow-warn has run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(token.accessToken).toBe("tok-1");
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
