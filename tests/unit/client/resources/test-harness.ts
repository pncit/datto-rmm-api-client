import axios, { type AxiosInstance } from "axios";
import { vi } from "vitest";

import type { BaseResource } from "@/client/resources/base-resource";
import type { DattoLogger } from "@/logging/logger";
import type { RateDescriptor } from "@/rate-limit/rate-limiter";

/**
 * Shared harness for every `*Resource` unit test (`account`/`site`/`device`/`alert`/`job`-
 * resource.test.ts). Each of those Phase 7 test files exercised its resource against an
 * identical `nock`-mocked axios instance built the same way (a `RateDescriptor`-capturing
 * request interceptor) and an identical no-op mock logger; hand-copying that setup into five
 * files meant a change to either had to be made — and could silently drift — five times over.
 * Centralized here instead, so every resource test file constructs its fixtures identically by
 * construction, not by convention.
 */

/** The mocked API host every resource test points its axios instance at. */
export const BASE_URL = "https://zinfandel-api.example.com";

/** A `DattoLogger` whose four methods are `vi.fn()` mocks, for asserting on log calls. */
export function createMockLogger(): DattoLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/**
 * An axios instance pointed at {@link BASE_URL} with a request interceptor that captures every
 * outgoing request's `RateDescriptor` (`{ kind: 'read' }` / `{ kind: 'write', opKey }`) — set by
 * `BaseResource`'s `http*` primitives — into `descriptors`, in request order.
 */
export function createTrackedAxios(): {
  instance: AxiosInstance;
  descriptors: RateDescriptor[];
} {
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

/**
 * Constructs a `*Resource` instance (`Ctor`) over a fresh {@link createTrackedAxios} instance
 * and either the supplied `logger` or a fresh {@link createMockLogger}, alongside that same
 * axios instance's captured `descriptors` and the `logger` actually used — so a caller can
 * assert on rate-limiting (`descriptors`) and/or logging (`logger`) without repeating either
 * fixture's construction.
 */
export function makeResource<R extends BaseResource>(
  Ctor: new (axios: AxiosInstance, logger: DattoLogger) => R,
  logger: DattoLogger = createMockLogger(),
): { resource: R; descriptors: RateDescriptor[]; logger: DattoLogger } {
  const { instance, descriptors } = createTrackedAxios();
  return { resource: new Ctor(instance, logger), descriptors, logger };
}
