import type { RateDescriptor } from "../rate-limit/rate-limiter";

import type { ObserverCapture } from "./observer";

/**
 * Private typecheck aid: augments Axios's own request-config types with the `rateDescriptor`
 * property the request interceptor in `http-client.ts` reads (and `BaseResource`'s `http*`
 * primitives / `paginate`, Phase 6, attach) and the `__dattoObserverCapture` property the
 * HTTP-observer seam's request interceptor stashes and its response interceptors read back
 * (Phase 2). Axios does not declare either property itself.
 *
 * **Must stay a private typecheck aid — never emitted into the published `dist/index.d.ts`.** A
 * global `declare module 'axios'` that reached the published types would widen *every*
 * downstream consumer's `AxiosRequestConfig` the moment they import both this package and
 * axios — an internal build detail leaking into a dependency's public surface. This file is kept
 * in the typecheck program via `tsconfig.json`'s `include: ["src"]` (ambient `.d.ts` files are
 * picked up project-wide with no explicit import needed), but deliberately **not** imported from
 * any `src/*.ts` value module reachable from `src/index.ts`'s entry graph — `tsup`'s `dts: true`
 * rollup follows that import graph, so a file nothing in it imports is never pulled in. Phase 8's
 * exit gate asserts `dist/index.d.ts` contains no `declare module 'axios'`, turning this into a
 * verified guarantee rather than a hope.
 */
declare module "axios" {
  interface AxiosRequestConfig {
    rateDescriptor?: RateDescriptor;
    __dattoObserverCapture?: ObserverCapture;
  }

  interface InternalAxiosRequestConfig {
    rateDescriptor?: RateDescriptor;
    __dattoObserverCapture?: ObserverCapture;
  }
}

export {};
