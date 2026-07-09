import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import nock from "nock";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { DattoRmmClient } from "@/client/datto-rmm-client";
import type { DattoRmmClientConfig } from "@/client/datto-client-config";
import { OPERATION_MAP, type OperationMapEntry } from "@/client/operation-map";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, "../../../spec/openapi.json");
const specIsCommitted = existsSync(SPEC_PATH);

const BASE_URL = "https://zinfandel-api.example.com";
const GRANT_PATH = "/auth/oauth/token";

const HTTP_METHODS = new Set(["get", "post", "put", "delete"]);

/** A placeholder value substituted for every `{...}` path-parameter token, for both building the
 * concrete request path and driving the resource method call — see this file's doc. */
const PATH_PLACEHOLDER = "1";

/**
 * A minimal valid request body for each body-carrying write op, keyed by `${ns}.${method}` — only
 * present for the operations whose `BaseResource` write primitive validates a body
 * (`validateRequest`, Phase 6 R6); every bodiless write (`resolve`/`mute`/`unmute`/`move`/
 * `resetKeys`/every `delete*`) has no entry and is driven with path params only.
 */
const SAMPLE_BODIES: Partial<Record<string, unknown>> = {
  "account.createVariable": { name: "v" },
  "account.updateVariable": { name: "v" },
  "sites.create": { name: "Test Site" },
  "sites.update": { name: "Test Site" },
  "sites.createVariable": { name: "v" },
  "sites.updateVariable": { name: "v" },
  "sites.updateProxy": { host: "proxy.local" },
  "devices.setUdf": { udf1: "value" },
  "devices.setWarranty": { warrantyDate: null },
  "devices.createJob": { jobName: "Test Job", jobComponent: {} },
};

/**
 * One response body that satisfies every operation this client validates, regardless of shape:
 * - A paginated read's cursor (`pageDetailsSchema`) parses successfully (all four required fields
 *   present with the right type); the named array is absent, which `validateArrayResponse` treats
 *   as an empty result with a `warn` diagnostic — not a thrown error (see `BaseResource`'s doc).
 * - A single-object read validates leniently: `pageDetails` is just an unrecognized extra key that
 *   `parseLenient` strips, and every real generated response schema's fields are optional.
 * - A bare-array read (`httpGetArray`) sees a non-array `data` and, per `validateArrayResponse`,
 *   logs a `warn` and returns `[]` rather than throwing.
 * - Every write's response validates the same way (`voidResponseSchema` is `z.unknown()`; the one
 *   real-object write response, `resetApiKeysResponse`, has every field optional); `DELETE`
 *   doesn't validate a response body at all.
 *
 * This is deliberately not tailored per operation — per the plan, "the assertion is on the request
 * line reaching nock, not on response shape."
 */
const GENERIC_RESPONSE = {
  pageDetails: {
    count: 0,
    totalCount: 0,
    prevPageUrl: null,
    nextPageUrl: null,
  },
};

function config(): DattoRmmClientConfig {
  return { apiUrl: BASE_URL, apiKey: "test-key", apiSecret: "test-secret" };
}

/** A fresh client with its OAuth2 grant pre-mocked, mirroring `datto-rmm-client.test.ts`'s
 * end-to-end fixture pattern. */
function makeClient(): DattoRmmClient {
  nock(BASE_URL)
    .post(GRANT_PATH)
    .reply(200, { access_token: "tok-1", expires_in: 3600 });
  return new DattoRmmClient(config());
}

/** Counts the `{...}` path-parameter tokens in a spec-shaped path. */
function pathParamCount(specPath: string): number {
  return (specPath.match(/\{[^}]+\}/g) ?? []).length;
}

/** The concrete request path a resource method builds for `specPath`, given every path parameter
 * is `PATH_PLACEHOLDER` (this client always prepends `/api` to the spec's own `/v2/...` paths). */
function concretePath(specPath: string): string {
  return `/api${specPath.replace(/\{[^}]+\}/g, PATH_PLACEHOLDER)}`;
}

/**
 * Drives `client.<ns>.<method>(...)` for one {@link OperationMapEntry}. Every resource method in
 * this client follows one uniform argument convention (verified directly against every method
 * signature in `src/client/resources/*.ts`): positional path parameters first, in the same order
 * as the spec path's `{...}` tokens, then a request body (only for a body-carrying write), and
 * nothing else required (an optional trailing query-params object is always omittable). That
 * uniformity is what makes one generic, reflective driver correct for all 57 operations rather
 * than a hand-written call per entry.
 */
async function drive(
  client: DattoRmmClient,
  entry: OperationMapEntry,
): Promise<unknown> {
  const key = `${entry.ns}.${entry.method}`;
  const args: unknown[] = new Array(pathParamCount(entry.specPath)).fill(
    PATH_PLACEHOLDER,
  );
  if (key in SAMPLE_BODIES) {
    args.push(SAMPLE_BODIES[key]);
  }

  const namespace = (client as unknown as Record<string, unknown>)[
    entry.ns
  ] as Record<string, (...a: unknown[]) => Promise<unknown>>;
  return namespace[entry.method](...args);
}

describe("operation coverage against the committed spec (R1)", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  // Fails loudly (rather than silently skipping) if spec/openapi.json is absent: R15 mandates the
  // spec is committed, so a missing file here means a broken checkout, not a legitimate condition
  // this completeness proof may quietly no-op under. (Unlike
  // tests/generated/reproducibility.test.ts, which `skipIf`s a *live-egress* check that a
  // committed-spec test has no analogous excuse to skip.)
  it("OPERATION_MAP covers every (method, path) declared in spec/openapi.json exactly once", () => {
    expect(
      specIsCommitted,
      `spec/openapi.json is missing at ${SPEC_PATH} — R15 requires it to be committed; this checkout is broken`,
    ).toBe(true);

    const spec = JSON.parse(readFileSync(SPEC_PATH, "utf8")) as {
      paths: Record<string, Record<string, unknown>>;
    };

    const specOps = new Set<string>();
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const method of Object.keys(methods)) {
        if (!HTTP_METHODS.has(method)) continue;
        specOps.add(`${method} ${path}`);
      }
    }

    const mapOps = OPERATION_MAP.map(
      (entry) => `${entry.specMethod} ${entry.specPath}`,
    );

    // Duplicate-free: a raw count could pass even if one namespace duplicated an operation
    // while another omitted a different one.
    expect(
      mapOps.length,
      "OPERATION_MAP has a duplicate (method, path) entry",
    ).toBe(new Set(mapOps).size);

    // Exact set equality against the spec's own authoritative inventory — no unmapped
    // operation, no stale entry for a since-removed one.
    expect([...new Set(mapOps)].sort()).toEqual([...specOps].sort());
  });

  it.each(OPERATION_MAP)(
    // A space (not a dot) separates $ns from $method: vitest's $prop title interpolation treats
    // a dotted continuation ($ns.$method) as one deep-property lookup (entry.ns.method), which is
    // undefined since entry.ns is a plain string — this format keeps both names legible.
    "$specMethod $specPath -> client.$ns $method() reaches the real transport",
    async (entry) => {
      const client = makeClient();
      const path = concretePath(entry.specPath);
      // A body-matching predicate that always matches, regardless of method — this guard
      // verifies the request *reaches* nock at the right verb/path, not the body's contents
      // (each write's own resource test already asserts exact request bodies).
      const scope = nock(BASE_URL)
        [entry.specMethod](path, () => true)
        .reply(200, GENERIC_RESPONSE);

      await drive(client, entry);

      expect(scope.isDone()).toBe(true);
    },
  );
});
