import axios from "axios";
import nock from "nock";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createDattoRmmClient,
  DattoApiError,
  type DattoHttpErrorEvent,
  type DattoHttpObserver,
  type DattoHttpRequestEvent,
  type DattoHttpResponseEvent,
  type DattoRmmClientConfig,
} from "@/index";

/**
 * Assembled-client integration coverage for the HTTP observer seam (plan Phase 4, design R2–R4,
 * R6, R8, R9). Phases 1–3 unit-test each layer (the shared helper, the shared axios instance, the
 * grant client) in isolation; this suite proves the seam behaves correctly once both transport
 * layers are wired together behind the one public entry point (`createDattoRmmClient`) — the
 * cross-layer scenarios that only exist with the full client assembled: a grant observed
 * end-to-end ahead of the first resource call, a paginated multi-page read, a lazy-refresh grant
 * failure that must fire `onError` exactly once (never twice), and a retried resource read.
 *
 * All requests are stubbed with `nock`; no live Datto RMM credentials or deployed environment are
 * required (per the plan's Deferred Validation section).
 */

const BASE_URL = "https://zinfandel-api.example.com";
const GRANT_PATH = "/auth/oauth/token";
const ACCOUNT_PATH = "/api/v2/account";
const DEVICES_PATH = "/api/v2/account/devices";

type ObservedEvent =
  | { kind: "request"; event: DattoHttpRequestEvent }
  | { kind: "response"; event: DattoHttpResponseEvent }
  | { kind: "error"; event: DattoHttpErrorEvent };

/** Builds an observer that appends every fired event, in fired order, to `events`. */
function recordingObserver(events: ObservedEvent[]): DattoHttpObserver {
  return {
    onRequest: (event) => events.push({ kind: "request", event }),
    onResponse: (event) => events.push({ kind: "response", event }),
    onError: (event) => events.push({ kind: "error", event }),
  };
}

function config(
  overrides: Partial<DattoRmmClientConfig> = {},
): DattoRmmClientConfig {
  return {
    apiUrl: BASE_URL,
    apiKey: "test-key",
    apiSecret: "test-secret",
    ...overrides,
  };
}

/** Stubs a successful OAuth2 password-grant round-trip. */
function stubGrant(): nock.Scope {
  return nock(BASE_URL)
    .post(GRANT_PATH)
    .basicAuth({ user: "public-client", pass: "public" })
    .reply(200, { access_token: "tok-1", expires_in: 3600 });
}

/**
 * Type-safe filter: narrows `ObservedEvent[]` to the payload type for one `kind`, with no `as`
 * cast at any call site. Overloaded per concrete `kind` (rather than one generic signature keyed
 * off `Extract<ObservedEvent, { kind: K }>["event"]`) because that generic-indexed-access form hits
 * a known TypeScript limitation across a 3-member discriminated union: the compiler computes two
 * structurally-different representations of the same conditional type at the declaration site vs.
 * the `filter().map()` call site and rejects them as unrelated (confirmed against `tsc` directly).
 */
function eventsOf(events: ObservedEvent[], kind: "request"): DattoHttpRequestEvent[];
function eventsOf(events: ObservedEvent[], kind: "response"): DattoHttpResponseEvent[];
function eventsOf(events: ObservedEvent[], kind: "error"): DattoHttpErrorEvent[];
function eventsOf(events: ObservedEvent[], kind: ObservedEvent["kind"]) {
  return events.filter((e) => e.kind === kind).map((e) => e.event);
}

describe("HTTP observer seam — assembled client (integration)", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it("observes the token grant end-to-end, with body as the raw urlencoded wire string (R3)", async () => {
    stubGrant();
    nock(BASE_URL).get(ACCOUNT_PATH).reply(200, {});
    const events: ObservedEvent[] = [];

    const client = createDattoRmmClient(
      config({ httpObserver: recordingObserver(events) }),
    );
    await client.account.get();

    const requests = eventsOf(events, "request");
    const grantRequest = requests.find((e) => e.url === `${BASE_URL}${GRANT_PATH}`);
    if (!grantRequest) {
      throw new Error("expected a grant request event");
    }
    if (typeof grantRequest.body !== "string") {
      throw new Error("expected serialized urlencoded grant body");
    }
    const params = new URLSearchParams(grantRequest.body);
    expect(params.get("grant_type")).toBe("password");
    expect(params.get("username")).toBe("test-key");
    expect(params.get("password")).toBe("test-secret");
    // The grant's own request must never carry a bearer token — the account-request Bearer
    // interceptor is attached only after the grant client resolves (Phase 3's intentional
    // Basic-auth-only omission), locked in end-to-end through the real assembled client.
    expect(grantRequest.headers["authorization"]).toBeUndefined();
    expect(grantRequest.headers["Authorization"]).toBeUndefined();

    const responses = eventsOf(events, "response");
    const grantResponse = responses.find(
      (e) => e.url === `${BASE_URL}${GRANT_PATH}`,
    );
    expect(grantResponse).toBeDefined();
    expect(grantResponse!.statusCode).toBe(200);

    // The resource call itself is also observed as its own request + terminal response — the
    // grant and the resource read are two distinct, fully-observed attempts.
    const accountResponse = responses.find(
      (e) => e.url === `${BASE_URL}${ACCOUNT_PATH}`,
    );
    expect(accountResponse).toBeDefined();
    expect(accountResponse!.statusCode).toBe(200);

    // The account request's own onRequest event carries the real Bearer header the real
    // AuthManager.attachTo interceptor attached — proving the observer-first/attachTo-later
    // interceptor order composes correctly against the real object graph, not a unit-test mock
    // (R9's bearer-token half; design Risk table "instrumentation ordering" entry).
    const accountRequest = requests.find((e) => e.url === `${BASE_URL}${ACCOUNT_PATH}`);
    expect(accountRequest).toBeDefined();
    expect(accountRequest!.headers["Authorization"]).toBe("Bearer tok-1");
  });

  it("observes a paginated read of N pages as N request + N terminal events (R4)", async () => {
    stubGrant();
    nock(BASE_URL)
      .get(DEVICES_PATH)
      .reply(200, {
        pageDetails: {
          count: 1,
          totalCount: 2,
          prevPageUrl: null,
          nextPageUrl: `${BASE_URL}${DEVICES_PATH}?page=2`,
        },
        devices: [{ uid: "device-1" }],
      });
    nock(BASE_URL)
      .get(DEVICES_PATH)
      .query({ page: "2" })
      .reply(200, {
        pageDetails: { count: 1, totalCount: 2, prevPageUrl: null, nextPageUrl: null },
        devices: [{ uid: "device-2" }],
      });
    const events: ObservedEvent[] = [];

    const client = createDattoRmmClient(
      config({ httpObserver: recordingObserver(events) }),
    );
    const devices = await client.account.devices();

    expect(devices).toHaveLength(2);

    const deviceRequests = eventsOf(events, "request").filter((e) =>
      e.url.startsWith(`${BASE_URL}${DEVICES_PATH}`),
    );
    const deviceResponses = eventsOf(events, "response").filter((e) =>
      e.url.startsWith(`${BASE_URL}${DEVICES_PATH}`),
    );
    // Two pages -> exactly one onRequest + one terminal onResponse per page.
    expect(deviceRequests).toHaveLength(2);
    expect(deviceResponses).toHaveLength(2);
    expect(deviceResponses.every((e) => e.statusCode === 200)).toBe(true);
  });

  it("a lazy-refresh grant failure fires onError exactly once — on the grant attempt — never a second time on the shared instance (Decision 4 rule 2)", async () => {
    nock(BASE_URL).post(GRANT_PATH).reply(401, { message: "invalid credentials" });
    const events: ObservedEvent[] = [];

    const client = createDattoRmmClient(
      config({ httpObserver: recordingObserver(events) }),
    );

    await expect(client.account.get()).rejects.toBeInstanceOf(DattoApiError);

    const errors = eventsOf(events, "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.url).toBe(`${BASE_URL}${GRANT_PATH}`);
    expect(errors[0]!.statusCode).toBe(401);
    // The raw error handed to the observer is the AxiosError the grant client received, never the
    // DattoApiError the client ultimately throws (R8).
    expect(errors[0]!.error).not.toBeInstanceOf(DattoApiError);
    expect(axios.isAxiosError(errors[0]!.error)).toBe(true);
    // No request ever reached the shared instance's dispatch point — the Bearer interceptor threw
    // before axios sent anything — so there is no second onError for the account request itself.
    expect(errors.some((e) => e.url === `${BASE_URL}${ACCOUNT_PATH}`)).toBe(false);
  });

  it("a 429 (Retry-After) -> retry -> 200 resource read surfaces onError(429) then onResponse(200) (R2/R6)", async () => {
    stubGrant();
    nock(BASE_URL)
      .get(ACCOUNT_PATH)
      .reply(429, { message: "rate limited" }, { "Retry-After": "0" });
    nock(BASE_URL).get(ACCOUNT_PATH).reply(200, {});
    const events: ObservedEvent[] = [];

    const client = createDattoRmmClient(
      config({ httpObserver: recordingObserver(events) }),
    );
    await client.account.get();

    const accountEvents = events.filter(
      (e) => e.event.url === `${BASE_URL}${ACCOUNT_PATH}`,
    );
    const terminal = accountEvents.filter((e) => e.kind !== "request");
    expect(terminal).toHaveLength(2);
    const [first, second] = terminal;
    if (!first || !second) {
      throw new Error("expected exactly two terminal events");
    }
    if (first.kind !== "error") {
      throw new Error("expected an error event first");
    }
    expect(first.event.statusCode).toBe(429);
    expect(axios.isAxiosError(first.event.error)).toBe(true);
    if (second.kind !== "response") {
      throw new Error("expected a response event second");
    }
    expect(second.event.statusCode).toBe(200);
  });

  it("omitting httpObserver entirely leaves request outcomes unchanged (additive-only sanity)", async () => {
    stubGrant();
    nock(BASE_URL).get(ACCOUNT_PATH).reply(200, { name: "acme" });

    const client = createDattoRmmClient(config());
    const account = await client.account.get();

    expect(account.name).toBe("acme");
  });
});
