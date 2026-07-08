# Plan: Full API Surface — Generated, Throwing, Namespace-Organized Datto RMM Client

- **Plan ID:** full-api-surface
- **Design Document:** docs/implementation/full-api-surface/design.md
- **Repo Context Checked:**
  - **This client (`datto-rmm-api-client`)** — read every source file: `src/client.ts` (the `getAllPages` walker hard-wired to the devices envelope; three public methods returning `Result<T>`), `src/config.ts` (`DattoRmmClientConfig` with the dead `autoRefresh`/`tokenRefreshPct`/`userAgentExtra` and the `validationMode` to be removed), `src/validation.ts` (`validate`/`validateItems`/`toProblemError`/`firstIssuePath`, three modes `strict|warn|off`), `src/result.ts` (`Result<T>`/`ProblemError` to be retired), `src/httpClient.ts` (axios wrapper, `acquire()` with no descriptor, `mapAxiosError`), `src/rateLimiter.ts` (single 600/60 s `SlidingWindowRateLimiter`), `src/auth.ts` (OAuth2 password grant to `{apiUrl}/auth/oauth/token`, HTTP basic `public-client:public`, 60 s pre-expiry refresh), `src/tokenStore.ts` (`InMemoryTokenStore`), `src/logger.ts` (variadic `LoggerLike = console`), `src/schemas.ts` (the wrong hand-written `DeviceSchema`: `udf1…udf30` only, `deviceClass` missing `rmmnetworkdevice`), `src/index.ts` (barrel). Build is `tsc`, tests are `jest`/`ts-jest` (`jest.config.js`), fixtures live in `src/__tests__/fixtures/` (`device.json`, `devicesPage*.json` — reusable real device captures). No `spec/` dir, no `src/generated/`, no `orval`.
  - **Reference architecture (`../fuze-api`, v10.8.0)** — read the files this plan ports verbatim or near-verbatim: `orval.config.ts` (two targets `fuze`/`fuzeZod`, `mode: 'tags-split'`, zod `strict.response:false`+`body/param/query/header:true`, `coerce.date`), `src/validation/schema-leniency.ts` (`parseLenient` + `addCatchallRecursive` + `detectUnknownProperties`; all `_zod.def` access isolated here), `src/client/resources/base-resource.ts` (`get/post/patch/deleteRequest`, `validateRequest`/`validateResponse`/`validateArrayResponse`, `coerceSchema`), `src/errors/{base-error,fuze-api-error,fuze-validation-error}.ts`, `src/client/fuze-client-config.ts` (`FuzeLogger` type + `fuzeLoggerSchema` via `z.function`, `z.strictObject` config with `.safeParse` in the constructor), `src/client/fuze-client.ts` (resource mounting + response interceptor mapping `AxiosError`→`FuzeApiError`), `src/client/interceptors/retry-interceptor.ts` (exponential backoff), `src/client/resources/company-resource.ts` (thin resource pattern), `scripts/dedupe-generated-index.mjs` (post-generate codemod precedent; `"generate": "orval && node scripts/…"`), `.gitignore` (explicit "src/generated/ IS committed" note), `spec/openapi.json`+`spec/openapi-prev.json`, `tsup.config.ts` (ESM, `dts:true`), `vitest.config.ts` (globals, node, `@`→`src` alias, coverage excludes `src/generated/**`). Confirmed a generated zod file emits enums as `zod.enum([...])` and objects as `zod.object({...})` / `zod.strictObject({...})` — the shapes the enum-widening codemod and leniency walker must handle.
- **External Research:**
  - Orval 7 (`orval.dev/docs/guides/client-with-zod`, DeepWiki "Zod Generation Configuration") — the `client: 'zod'` target auto-detects the installed Zod major and emits v4-compatible schemas; OpenAPI 3.1 is supported; `fileExtension: '.zod.ts'` avoids name clashes with the types target. This is exactly `fuze-api`'s working configuration (orval `^7`, zod `^4`), so the two-target setup is a proven, not speculative, path.
  - Confirmed tooling versions in active use by the sibling package: `orval ^7`, `tsup ^8`, `vitest ^4`, `nock ^14`, `@vitest/coverage-v8 ^4` — adopt the same to keep the two PNCIT clients on one toolchain.
- **Assumptions:**
  - The Datto RMM v2 OpenAPI document is fetchable by a plain unauthenticated `GET {apiUrl}/api/v3/api-docs/Datto-RMM` (per design "unauthenticated for the document itself"). Phase 2 fetches and commits it; if the Implementor's environment has no egress to `*.centrastage.net`, a maintainer must drop `spec/openapi.json` in place — this is the plan's single genuinely-live *input* (its reproducibility gate is still fully offline). The live refresh/diff is listed under Deferred Validation.
  - The spec is region-invariant (design §Current State): committing the `zinfandel` fetch is sufficient; `servers[].url` is irrelevant since the consumer supplies `apiUrl`.
  - Real captured sweep data is not available to an Implementor agent (it contains live secrets and needs a live account). Phase 9 therefore validates against **synthesized fixtures that deliberately encode every observed defect pattern** from the design (nullability, `udf1…udf300`, `rmmnetworkdevice`, `@class` alert contexts, epoch-ms timestamps) plus the existing committed `src/__tests__/fixtures/device*.json`. Validating the reconciled schemas against a fresh real sweep is Deferred Validation.
  - The existing `src/__tests__/fixtures/*.json` are real device captures safe to keep (no UDF secrets observed in them); Phase 9's secret-scan will confirm.
  - Node ≥ 20, ESM-only, server-side remain fixed (Non-Goals).
- **Quality Bar:** Extensibility and best practices prioritized. Backwards compatibility not prioritized (explicit breaking `1.0.0`, R19).

---

## Summary
- **Executive Summary:** The Datto RMM API client today can only list devices and read a single device, and its one hand-written schema is already wrong against real data (it misses two-thirds of the UDF fields and a whole device class). This project rebuilds it into a complete, type-safe client that covers **every** documented Datto RMM v2 operation (all 53 paths / 75 operations) across ten resource namespaces like `client.devices`, `client.sites`, and `client.alerts`. Instead of hand-writing schemas, the client **generates** them from Datto's own API specification, automatically corrects the specification's known defects, and validates real responses leniently (tolerating the nulls and new values production actually returns) while validating outgoing writes strictly. It adopts the exact architecture of our sibling `fuze-api` package — throwing typed errors, an injectable logger, and generated validators — so a developer moving between the two clients learns one mental model. It models Datto's real rate limits, masks secret-bearing UDF values out of all logs, and ships as a documented, breaking `1.0.0`.
- **Goals:**
  - Cover the entire v2 surface behind ergonomic resource namespaces (R1, R2).
  - Generate schemas from a committed, defect-corrected OpenAPI spec and keep regeneration byte-reproducible (R4, R8, R15).
  - Validate responses leniently (nullability, unknown-key strip, per-item drop, open enums) and requests strictly (R5, R6, R7).
  - Converge on `fuze-api`: throwing error hierarchy, `parseLenient`, `BaseResource`, injectable `DattoLogger`, Orval/tsup/vitest (R9, R13, R16).
  - Model the real read / aggregate-write / per-operation rate-limit contract and honor 429/403 correctly (R11, R12).
  - Mask UDF values in all log output (R20); document everything and ship `1.0.0` (R18, R19).
- **Non-Goals:**
  - Cross-platform/domain normalization, browser/edge support, non-v2 endpoints, auto-recovery from a 403 IP-block, masking of non-UDF secret fields (all per design Non-Goals).
  - No backward-compat aliases for the retired `0.1.x` methods.

---

## Implementation Notes for the Implementor(s)
- **Scope discipline:** implement exactly one phase per session; run that phase's Exit Gate block before moving on. Do not start a later phase's work early.
- **Coexistence rule (critical):** all new code lands under **new paths** (`src/errors/`, `src/logging/`, `src/validation/`, `src/http/`, `src/rate-limit/`, `src/client/`, `src/generated/`, `src/spec-overrides/`) while the old surface (`src/client.ts`, `src/config.ts`, `src/logger.ts`, `src/result.ts`, `src/validation.ts`, `src/schemas.ts`, `src/httpClient.ts`, `src/auth.ts`, `src/rateLimiter.ts`, `src/tokenStore.ts`, `src/internal/`) stays untouched and compiling until **Phase 8**, which deletes it in one commit alongside the new `src/index.ts`. This keeps `typecheck`+`test` green at every phase boundary. Do **not** edit the old files' logic before Phase 8.
- **Never hand-edit `src/generated/**`.** It is overwritten by `npm run generate`. Corrections live in the patch step (Phase 2), the enum codemod (Phase 2), or `src/spec-overrides/` (Phase 6).
- **Port, don't reinvent.** Phases 3–6 copy `fuze-api` modules and rename `Fuze*`→`Datto*`. Keep the copies faithful; deviations are called out per phase.
- **Expected commands:** `npm run generate`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
- **Do not** add a `Result<T>` variant, a `validationMode` config, or a second logger shape — the throwing model and single lenient/strict split are the whole point (Decisions 2, 4).

---

## Phase 1: Tooling migration (Orval / tsup / vitest / nock)

### Goal
Replace the `tsc`-build + `jest` toolchain with Orval codegen, `tsup` build, and `vitest`+`nock` tests, matching `fuze-api`. No API behavior changes; the existing three-method surface still compiles and its tests still pass (converted from jest to vitest). `npm run generate` is wired but not yet exercised (no spec until Phase 2).

**Requirements:** R16

### Steps
1. **Swap dependencies** in `package.json`:
   - Remove: `jest`, `ts-jest`, `@types/jest`.
   - Add (devDependencies): `orval@^7`, `tsup@^8`, `vitest@^4`, `nock@^14`, `@vitest/coverage-v8@^4`, `@types/node@^22`.
   - Keep `zod@^4`, `axios@^1.10`, eslint/prettier stack.
   - Files: `package.json`
2. **Rewrite scripts** in `package.json`:
   - `"build": "tsup"`, `"test": "vitest run"`, `"test:watch": "vitest"`, `"typecheck": "tsc --noEmit"`, `"generate": "node scripts/patch-spec.mjs && orval && node scripts/widen-response-enums.mjs"`, `"generate:raw": "orval"`, `"clean": "rm -rf dist"`, `"prepublishOnly": "npm run build && npm run test"`. Update `"files"` to keep `dist`, `README.md`, `LICENSE`.
   - Note: `scripts/patch-spec.mjs` / `scripts/widen-response-enums.mjs` are created in Phase 2; the `generate` script line is present now but not run in this phase's gate.
   - Files: `package.json`
3. **Add build/test/codegen configs** (copy from `fuze-api`, adjust names/paths):
   - `tsup.config.ts` — ESM only, `dts:true`, `entry:{index:'src/index.ts'}`, `sourcemap:true`, `clean:true`, `treeshake:true`. (Single entry; no browser build — browser is a Non-Goal.)
   - `vitest.config.ts` — `globals:true`, `environment:'node'`, `include:['tests/**/*.test.ts','src/**/*.test.ts']`, coverage `exclude:['src/generated/**','src/index.ts']`, `resolve.alias` `@`→`./src`.
   - `orval.config.ts` — two targets (see snippet); input `./spec/openapi.patched.json`; types target → `src/generated/types` + endpoints `src/generated/endpoints/api.ts` with the axios mutator; zod target → `src/generated/schemas/api.zod.ts`, `fileExtension:'.zod.ts'`, `strict.response:false` / `body|param|query|header:true`, `coerce.date`.
   - `src/http/axios-mutator.ts` — a `customInstance` mutator stub (ported from `fuze-api/src/client/axios-mutator.ts`) so the endpoints target compiles; the real shared axios instance is wired in Phase 5.
   - Files: `tsup.config.ts`, `vitest.config.ts`, `orval.config.ts`, `src/http/axios-mutator.ts`
4. **Enable the `@/` path alias** for source (mirrors `fuze-api`): add `compilerOptions.paths` `{"@/*":["./src/*"]}` and `baseUrl:"."` to `tsconfig.json`. Confirm `moduleResolution` supports it (`Bundler` or `NodeNext`); tsup + vitest both resolve it.
   - Files: `tsconfig.json`
5. **Convert the existing jest tests to vitest.** Delete `jest.config.js`. In `src/__tests__/*.test.ts`, replace jest globals with vitest imports (or rely on `globals:true`); replace `jest.fn`/`jest.mock` with `vi.fn`/`vi.mock`. These tests still exercise the old `Result`-returning surface and must stay green until Phase 8 deletes them.
   - Files: `jest.config.js` (delete), `src/__tests__/client.test.ts`, `src/__tests__/deviceSchema.test.ts`, `src/__tests__/devicesMethod.test.ts`, `src/__tests__/validation.test.ts`
6. **`.gitignore`:** add `spec/openapi.patched.json` (transient) and `coverage/`; add the committed-generated note (finalized in Phase 2).
   - Files: `.gitignore`

### Opinionated Implementation Notes (Examples)
```ts
// orval.config.ts — Datto RMM, two targets (mirrors fuze-api, input is the PATCHED spec)
import { defineConfig } from 'orval';
import path from 'node:path';

const spec = process.env.DATTO_OPENAPI_SPEC ?? path.resolve(__dirname, './spec/openapi.patched.json');

export default defineConfig({
  datto: {
    input: { target: spec },
    output: {
      mode: 'tags-split',
      target: './src/generated/endpoints/api.ts',
      schemas: './src/generated/types',
      client: 'axios',
      override: { mutator: { path: './src/http/axios-mutator.ts', name: 'customInstance' } },
    },
  },
  dattoZod: {
    input: { target: spec },
    output: {
      mode: 'tags-split',
      client: 'zod',
      target: './src/generated/schemas/api.zod.ts',
      fileExtension: '.zod.ts',
      override: {
        zod: {
          strict: { response: false, body: true, param: true, query: true, header: true },
          generate: { body: true, response: true, query: true, param: true, header: true },
          coerce: { body: ['date'], response: ['date'], param: ['date'], query: ['date'] },
        },
      },
    },
  },
});
```

### Tests (in this phase)
- The four converted `src/__tests__/*.test.ts` files run green under `vitest run` (proves the runner swap without changing behavior).
- Add `tests/setup.ts` if any global test setup is needed (nock disabling real net); otherwise omit.

### Documentation (if needed)
- None (README rewrite is Phase 10).

### Exit Gate
```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```
- `jest.config.js` is deleted and no `jest`/`ts-jest` reference remains in `package.json` (grep is clean).
- `orval.config.ts`, `tsup.config.ts`, `vitest.config.ts` exist and `npx orval --help` resolves (binary installed) — note: `orval` is **not** run against a spec in this phase.

---

## Phase 2: Spec pipeline and code generation

### Goal
Commit Datto's OpenAPI spec, add the deterministic patch step and the response-enum-widening codemod, wire `npm run generate` (patch → orval → codemod), and generate **and commit** `src/generated/**`. After this phase, a fresh `npm run generate` reproduces `src/generated/**` byte-for-byte (R15), and the generated types + zod schemas typecheck.

**Requirements:** R4, R8, R15, R5

### Steps
1. **Fetch and commit the spec.** `GET {apiUrl}/api/v3/api-docs/Datto-RMM` (e.g. `https://zinfandel-api.centrastage.net/api/v3/api-docs/Datto-RMM`), pretty-print stably, and write `spec/openapi.json`. Copy it to `spec/openapi-prev.json` as the diffing baseline (first commit: identical; future refreshes update `openapi.json` and diff against the retained prev).
   - Files: `spec/openapi.json`, `spec/openapi-prev.json`
   - Notes: If egress to `*.centrastage.net` is unavailable, a maintainer supplies `spec/openapi.json`; the rest of the phase is offline. Use a stable JSON serialization (2-space indent, sorted top-level as fetched) so regeneration diffs are meaningful.
2. **Write the patch step** `scripts/patch-spec.mjs`: read `spec/openapi.json`, apply the deterministic, data-driven structural corrections generation cannot infer, write `spec/openapi.patched.json` (transient, git-ignored):
   - **Timestamps `string`→`integer`** (epoch-ms): retype the known timestamp properties across component schemas — `Device.lastSeen/lastReboot/lastAuditDate/creationDate`, `AuthUser.created/lastAccess`, `Alert.timestamp/resolvedOn` (drive from a documented list constant, not a global rename).
   - **`Alert.alertContext`** → a permissive open object `{ type:'object', properties:{ '@class':{ type:'string' } }, additionalProperties:true }` (captures the Jackson `@class` discriminator; the spec's ~30 dead `*Context` schemas are left in place but no longer referenced by `alertContext`).
   - Files: `scripts/patch-spec.mjs`
3. **Write the response-enum-widening codemod** `scripts/widen-response-enums.mjs`: after Orval runs, rewrite every **response** enum field so its emitted TypeScript type is the open form `EnumUnion | (string & {})` (R5), deterministically across `src/generated/`. This idiom has no JSON-Schema representation, so it must be a post-generate script, not an Orval hook. Scope strictly to response types (never request/param/body types, which stay closed). Keep the transform idempotent (running twice is a no-op) so reproducibility holds.
   - Files: `scripts/widen-response-enums.mjs`
   - Notes: Runtime enum *degradation* is a separate mechanism handled in Phase 4's `parseLenient`; this codemod only widens the compile-time type. Phase 9 asserts the two stay aligned on the same field set.
4. **Generate and commit** `src/generated/**`: run `npm run generate`; commit the output. Add the `.gitignore` note (copy `fuze-api`'s wording) that `src/generated/` is intentionally committed because it derives from an external spec, and that `spec/openapi.patched.json` is ignored.
   - Files: `src/generated/**` (committed), `.gitignore`
5. **Verify reproducibility:** re-run `npm run generate`; `git diff --exit-code src/generated` must be empty.

### Opinionated Implementation Notes (Examples)
```js
// scripts/patch-spec.mjs (sketch)
import { readFileSync, writeFileSync } from 'node:fs';
const spec = JSON.parse(readFileSync('spec/openapi.json', 'utf8'));
const TIMESTAMP_FIELDS = {
  Device: ['lastSeen', 'lastReboot', 'lastAuditDate', 'creationDate'],
  AuthUser: ['created', 'lastAccess'],
  Alert: ['timestamp', 'resolvedOn'],
};
for (const [schema, fields] of Object.entries(TIMESTAMP_FIELDS)) {
  const props = spec.components?.schemas?.[schema]?.properties;
  for (const f of fields) if (props?.[f]) { props[f].type = 'integer'; props[f].format = 'int64'; delete props[f].enum; }
}
const alert = spec.components?.schemas?.Alert?.properties;
if (alert?.alertContext) alert.alertContext = { type: 'object', properties: { '@class': { type: 'string' } }, additionalProperties: true };
writeFileSync('spec/openapi.patched.json', JSON.stringify(spec, null, 2) + '\n');
```
```
// widen-response-enums.mjs target: a generated response type field like
//   deviceClass: 'device' | 'printer' | 'esxihost' | 'rmmnetworkdevice' | 'unknown';
// becomes
//   deviceClass: 'device' | 'printer' | 'esxihost' | 'rmmnetworkdevice' | 'unknown' | (string & {});
```

### Tests (in this phase)
- `tests/generated/reproducibility.test.ts`: shells out to `npm run generate` and asserts `git diff --quiet -- src/generated` (guards R15 in CI). Skip cleanly with a clear message if `spec/openapi.json` is absent.
- `tests/generated/patch-spec.test.ts`: unit-test `patch-spec.mjs` against a tiny inline spec fragment — timestamp fields become `integer`, `alertContext` becomes the permissive object. (No network.)
- `tests/generated/widen-enums.test.ts`: unit-test the codemod against a fixture string containing one response enum + one request enum; assert only the response enum gains `| (string & {})` and that a second pass is a no-op.

### Documentation (if needed)
- None yet.

### Exit Gate
```bash
npm run generate
git diff --exit-code -- src/generated
npm run typecheck
npm run lint
npm test
```
- `spec/openapi.json` and `spec/openapi-prev.json` are committed; `spec/openapi.patched.json` is git-ignored and untracked.
- `src/generated/**` is committed and non-empty (contains `schemas/*/*.zod.ts` and `types/`).

---

## Phase 3: Error hierarchy, injectable logger with UDF masking, and config

### Goal
Port the `fuze-api` throwing error hierarchy and injectable structured logger as `Datto*`, add the UDF-masking logger decorator through which all client logging flows (R20), and define the new zod-validated `DattoRmmClientConfig` (R14). All new files; old `src/errors`-less surface untouched.

**Requirements:** R9, R13, R14, R20, R10

### Steps
1. **Error hierarchy** under `src/errors/` (port from `fuze-api`, rename): `base-error.ts` (`BaseError`, verbatim), `datto-api-error.ts` (`DattoApiError` — `statusCode`, `response`, `requestId`, plus a `retryAfterMs?` field for 429 and a `code?` for `'ip-block'` classification of 403; `static fromAxiosError`), `datto-validation-error.ts` (`DattoValidationError` — `zodError`, `stage: 'request'|'response'`, optional wire payload, `z.prettifyError` message, `getErrorTree`), `index.ts` barrel.
   - Files: `src/errors/base-error.ts`, `src/errors/datto-api-error.ts`, `src/errors/datto-validation-error.ts`, `src/errors/index.ts`
2. **Logger** `src/logging/logger.ts`: `DattoLogger` type (`debug/info/warn/error`, each `(message: string, meta?: Record<string, unknown>) => void`), `dattoLoggerSchema` via `z.function` (mirror `fuzeLoggerSchema`), and a `consoleLogger` default backed by `console`.
   - Files: `src/logging/logger.ts`
3. **UDF-masking decorator** `src/logging/mask.ts`: `withUdfMasking(logger: DattoLogger): DattoLogger` wraps all four methods; before delegating, it deep-walks each call's `meta` and replaces every **non-null** value under any key matching `/^udf\d+$/` (and inside a nested `udf` record) with `[redacted - N characters]` where `N` is the original string length. Null/absent UDFs pass through unchanged; surrounding structure is preserved so a redacted line stays diagnostically useful (R20). This is the single logger boundary — the client constructs `withUdfMasking(config.logger ?? consoleLogger)` once and hands that wrapped logger to every layer, so no call site can leak a raw UDF value.
   - Files: `src/logging/mask.ts`
4. **Config** `src/client/datto-client-config.ts`: `dattoRmmClientConfigSchema = z.strictObject({...})` and `type DattoRmmClientConfig = z.infer<...>`:
   - `apiUrl` (`z.url()`), `apiKey`/`apiSecret` (`z.string().min(1)`).
   - `logger?` (`dattoLoggerSchema.optional()`), `userAgentExtra?` (`z.string().optional()` — now functional, sets a `User-Agent` header suffix in Phase 5), `tokenRefreshPct?` (`z.number().min(0).max(100).optional()` — now drives refresh timing in Phase 5).
   - `rateLimit?`, `retry?` (strict sub-objects), `axiosInstance?` (opaque, `z.custom` or `z.unknown`).
   - **Removed vs 0.1.x:** `autoRefresh`, `validationMode` (do not carry forward).
   - Files: `src/client/datto-client-config.ts`
   - Notes: the client constructor `.safeParse`s config and throws `DattoValidationError(err, 'request')` on failure (wired in Phase 8), exactly as `FuzeClient` does.

### Opinionated Implementation Notes (Examples)
```ts
// src/logging/mask.ts
const UDF_KEY = /^udf\d+$/;
const mask = (v: unknown) => (typeof v === 'string' ? `[redacted - ${v.length} characters]` : v);
function scrub(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(scrub);
  if (x && typeof x === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      out[k] = UDF_KEY.test(k) && v != null ? mask(v) : scrub(v);
    }
    return out;
  }
  return x;
}
export function withUdfMasking(logger: DattoLogger): DattoLogger {
  const wrap = (fn: DattoLogger['debug']) => (m: string, meta?: Record<string, unknown>) =>
    fn(m, meta ? (scrub(meta) as Record<string, unknown>) : meta);
  return { debug: wrap(logger.debug), info: wrap(logger.info), warn: wrap(logger.warn), error: wrap(logger.error) };
}
```

### Tests (in this phase)
- `tests/unit/errors/*.test.ts`: `DattoApiError.fromAxiosError` maps status/response/requestId and preserves `retryAfterMs`/`code`; `DattoValidationError` carries `stage` and prettifies; both are `instanceof BaseError` and `instanceof Error`.
- `tests/unit/logging/mask.test.ts` (proves R20): logging `{ udf: { udf1: 'S3CR3T', udf7: null }, udf5: 'abcd', host: 'PC1' }` yields `udf1='[redacted - 6 characters]'`, `udf7` stays `null`, `udf5='[redacted - 4 characters]'`, `host` unchanged; the underlying sink (a `vi.fn()`) never receives `'S3CR3T'` in any argument.
- `tests/unit/logging/logger.test.ts`: `dattoLoggerSchema` accepts a valid logger and rejects a missing method.
- `tests/unit/client/config.test.ts`: schema accepts a minimal valid config, rejects unknown keys (`.strict`), rejects bad `apiUrl`, and rejects `validationMode`/`autoRefresh` (proves they're gone).

### Documentation (if needed)
- None yet.

### Exit Gate
```bash
npm run lint
npm run typecheck
npm test
```

---

## Phase 4: Lenient response parsing with open-enum degradation

### Goal
Port `parseLenient` (unknown-key strip + recursive catchall) and extend it for the Datto reality: response validation tolerates null/absent on any field, and **runtime-degrades every response enum to passthrough** (an unobserved value is widened to `string` and logged, never dropped), with diagnostics **aggregated/deduped per call** and leveled (`debug` for benign strip/widen, `warn` for an actual per-item drop). Requests stay strict.

**Requirements:** R5, R7

### Steps
1. **Port** `fuze-api/src/validation/schema-leniency.ts` → `src/validation/schema-leniency.ts` verbatim (keeps all `_zod.def` access isolated here, per the risk-mitigation in the design). This gives `parseLenient(schema, data, logger?, context?)`, `addCatchallRecursive`, `detectUnknownProperties`.
   - Files: `src/validation/schema-leniency.ts`
2. **Add enum degradation** to the recursive walk: extend `addCatchallRecursive` so an `enum` node on the **response** path is replaced by `z.enum(values).or(z.string())` (accepts any string), and extend `detectUnknownProperties` (or a parallel pass) to detect when a parsed string fell outside the declared enum members and record a widening event. Because request schemas are validated by the strict `validateRequest` path (Phase 6) that does **not** call `parseLenient`, enums stay strict on requests automatically — no request/response flag needed inside the walker.
   - Files: `src/validation/schema-leniency.ts`
3. **Aggregate diagnostics** in a small `DiagnosticsCollector` (module-local): dedupe `(context, field, value)` for unknown-key strips and enum widenings, and emit **one** summarized `debug` line per `(context, field, value)` at the end of a parse/collection (e.g. `widened deviceClass=rmmnetworkdevice on 3/848 items`) rather than per row. This keeps a fully-walked 848-device / 1500-alert page from producing thousands of lines or running the masker in a per-row hot path. A genuine per-item **drop** is logged at `warn` by `validateArrayResponse` (Phase 6), not here.
   - Files: `src/validation/schema-leniency.ts` (+ `src/validation/diagnostics.ts` if the collector is non-trivial)
   - Notes: keep the no-logger fast path (`schema.safeParse` directly) from the fuze port intact for zero overhead when no logger is injected.

### Opinionated Implementation Notes (Examples)
```ts
// enum degradation inside addCatchallRecursive's switch:
case 'enum': {
  const values = Object.values(def.entries ?? {}) as string[]; // zod v4 enum members
  // response-side: accept any string, remember the closed set for widening diagnostics
  result = z.enum(values as [string, ...string[]]).or(z.string());
  enumMembers.set(result, new Set(values)); // WeakMap consulted by the widening detector
  break;
}
```

### Tests (in this phase)
- `tests/unit/validation/schema-leniency.test.ts` (extend the ported suite):
  - Unknown key on a response object is stripped and logged at `debug` once (deduped), object otherwise intact.
  - A response enum field carrying an **unobserved** value (`deviceClass: 'rmmnetworkdevice'` against a schema whose enum omits it, or a truly novel `'quantumdevice'`) **passes** and is reported as a widening — it is **not** dropped (this is the exact `rmmnetworkdevice` silent-loss regression the design forbids).
  - Aggregation: parsing an array of 50 items each with the same widened enum produces **one** summarized diagnostic, not 50.
  - Null on a spec-non-nullable field is tolerated on the response path.

### Documentation (if needed)
- None yet.

### Exit Gate
```bash
npm run lint
npm run typecheck
npm test
```

---

## Phase 5: Rate limiting, HTTP transport, and throwing auth

### Goal
Build the throwing HTTP layer the resources sit on: a dual-layer + per-operation rate limiter seeded from a committed static table, an `HttpClient`/axios instance whose `acquire()` takes a `{kind, opKey}` descriptor and honors 429 `Retry-After` / surfaces 403 IP-block, and an `AuthManager` refactored to throw and to drive proactive refresh from `tokenRefreshPct`. Ported from the old infra but adapted to the throwing model, under new paths.

**Requirements:** R10, R11, R12

### Steps
1. **Static limit table** `src/rate-limit/rate-limits.ts`: exported const map of write `opKey`→limit seeded from the observed `system/request_rate` contract — `'device-udf-set': 600`; `'site-create' | 'alert-resolve' | 'device-move' | 'device-job-create' | 'user-reset-keys' | variable/proxy/warranty mutations: 100`; plus `READ_LIMIT = 600`, `WRITE_AGGREGATE_LIMIT = 600`, `WINDOW_SECONDS = 60`, `DEFAULT_WRITE_LIMIT = 100` (fallback for any unlisted write opKey).
   - Files: `src/rate-limit/rate-limits.ts`
2. **Dual-layer limiter** `src/rate-limit/rate-limiter.ts`: a `MultiWindowRateLimiter` holding a read sliding window (600/60 s), an aggregate-write window (600/60 s), and a lazily-created per-opKey write window map. `acquire(descriptor: { kind: 'read' | 'write'; opKey?: string })` enforces the tightest applicable set: reads consult the read window; writes consult **both** the aggregate-write window **and** the op-key window (`opKey` limit from the table, else `DEFAULT_WRITE_LIMIT`). Preserve the old `SlidingWindowRateLimiter` semantics per window.
   - Files: `src/rate-limit/rate-limiter.ts`
3. **HTTP transport** `src/http/http-client.ts` + finalize `src/http/axios-mutator.ts`: create the shared axios instance (`baseURL = apiUrl`, `User-Agent` = default + `userAgentExtra`, JSON headers). Add request handling that (a) calls `limiter.acquire(descriptor)` before send using a descriptor carried on the axios request config, (b) a response-error path that maps `AxiosError`→`DattoApiError` (via `fromAxiosError`), reads `Retry-After` on **429** into `retryAfterMs` and backs off/retries within `retry.maxAttempts` (port `fuze-api`'s exponential-backoff retry interceptor, adding the 429 `Retry-After` branch), and classifies **403** as `code:'ip-block'` and throws immediately with **no** retry (Non-Goal: no auto-recovery).
   - Files: `src/http/http-client.ts`, `src/http/axios-mutator.ts`
4. **Auth** `src/auth/auth-manager.ts` + `src/auth/token-store.ts`: port `InMemoryTokenStore` (unchanged behavior, R10) and refactor `AuthManager` to **throw** on failure instead of returning `Result`. OAuth2 password grant to `{apiUrl}/auth/oauth/token`, HTTP basic `public-client:public`. Proactive refresh: refresh when the remaining lifetime is below `tokenRefreshPct` of the original TTL (default e.g. 25% if unset — pick and document a default), replacing the old fixed 60 s window. Expose the token via a request interceptor that sets `Authorization: Bearer <token>` on outgoing v2 requests.
   - Files: `src/auth/auth-manager.ts`, `src/auth/token-store.ts`

### Opinionated Implementation Notes (Examples)
```ts
// descriptor threading: BaseResource primitives attach this to the axios config; the
// request interceptor reads it and awaits the limiter before the call goes out.
export interface RateDescriptor { kind: 'read' | 'write'; opKey?: string }

// 429 handling in the error path (inside the retry logic):
const status = error.response?.status;
if (status === 429) {
  const retryAfter = Number(error.response?.headers?.['retry-after']);
  const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : backoff(attempt);
  await sleep(waitMs); /* retry within maxAttempts */
}
if (status === 403) {
  throw new DattoApiError('IP block or forbidden', { statusCode: 403, code: 'ip-block', response: error.response?.data, cause: error });
}
```

### Tests (in this phase, all via `nock` — no live calls)
- `tests/unit/rate-limit/rate-limiter.test.ts`: a burst of 101 `alert-resolve` writes trips the per-op 100 window while a burst of `device-udf-set` up to 600 does not; reads and writes are counted in separate windows; an unlisted write opKey falls back to 100.
- `tests/unit/http/http-client.test.ts` (nock): a 429 with `Retry-After: 1` is honored (retried after the delay, `retryAfterMs` populated); a 403 throws `DattoApiError` with `code:'ip-block'` and is **not** retried; a 5xx retries per `maxAttempts`; a 2xx returns the body.
- `tests/unit/auth/auth-manager.test.ts` (nock): password-grant token is cached and reused; a token past the `tokenRefreshPct` threshold triggers a proactive refresh; a failed grant throws `DattoApiError`.

### Documentation (if needed)
- None yet.

### Exit Gate
```bash
npm run lint
npm run typecheck
npm test
```

---

## Phase 6: BaseResource, strict pagination, and the schema-override module

### Goal
Provide the validated HTTP primitives every resource extends (`get/post/patch/deleteRequest`, `validateRequest`/`validateResponse`/`validateArrayResponse`) plus a `paginate` helper that walks `pageDetails.nextPageUrl` — validating each page's named array leniently and each page's cursor **strictly** against a dedicated `pageDetails` override (a missing/malformed cursor **throws**; a `null` `nextPageUrl` is the normal terminal). Add the hand-maintained `src/spec-overrides/` module that reconciles UDFs, alert context, the pagination cursor, and required-field marks for the write set.

**Requirements:** R3, R6, R8

### Steps
1. **BaseResource** `src/client/resources/base-resource.ts`: port from `fuze-api`, rename error type to `DattoValidationError`, thread the injected (masked) `DattoLogger` and the shared axios instance. Keep `coerceSchema`, `validateRequest` (strict, throws), `validateResponse` (lenient via `parseLenient`, throws), `validateArrayResponse` (per-item drop + `warn` log). Each primitive attaches a `RateDescriptor` to the axios config: `get` → `{kind:'read'}`, and `post/patch/deleteRequest` accept an `opKey` argument → `{kind:'write', opKey}`.
   - Files: `src/client/resources/base-resource.ts`
2. **`paginate` helper** on `BaseResource`: given a start path, params, the page's named-array key + item schema, walk `pageDetails.nextPageUrl` accumulating items. Per page: validate the **cursor** with the strict `pageDetailsSchema` override (`.safeParse`; on failure **throw** `DattoValidationError('response')` — this is the R3 hard-fail, never a silent truncation) and validate the named array with `validateArrayResponse` (lenient, per-item drop). `null` `nextPageUrl` ends the walk normally. Leniency governs item payloads, never the walk cursor.
   - Files: `src/client/resources/base-resource.ts`
3. **Schema-override module** `src/spec-overrides/index.ts` (+ split files as needed): lives outside `src/generated/`, imports generated zod schemas, and exports the reconciled forms resources use:
   - `udfSchema = z.record(z.string().regex(/^udf\d+$/), z.string().nullable())` — the `udf1…udf300` record (clearer than 300 literal keys), and the `Device` response schema re-composed to use it.
   - `alertContextSchema` — a permissive `@class`-tagged open object (`z.object({ '@class': z.string() }).catchall(z.unknown())` or `z.looseObject`), matching the Phase-2 spec patch.
   - `pageDetailsSchema` — the strict R3 cursor override: `z.strictObject({ count: z.number().int(), totalCount: z.number().int(), prevPageUrl: z.string().nullable(), nextPageUrl: z.string().nullable() })`.
   - **Required-field marks** for the small write set (spec declares almost no `required`, so `.strict()` alone would accept an empty `device-move`/`udf-set` body): wrap each generated write-body schema marking the genuinely required fields, hand-verified against the endpoint docs, in this one place (R6).
   - Files: `src/spec-overrides/index.ts` (+ e.g. `device-overrides.ts`, `alert-overrides.ts`, `pagination.ts`, `write-bodies.ts`)

### Opinionated Implementation Notes (Examples)
```ts
// strict pagination cursor — throws on malformed, terminates on null nextPageUrl
protected async paginate<T>(startPath: string, arrayKey: string, itemSchema: z.ZodType<T>,
                            params?: Record<string, unknown>, context?: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = startPath;
  let p = params;
  while (url) {
    const { data } = await this.axios.get(url, { params: p, /* RateDescriptor: read */ });
    const cursor = pageDetailsSchema.safeParse(data?.pageDetails);
    if (!cursor.success) throw new DattoValidationError(cursor.error, 'response', { context });
    out.push(...this.validateArrayResponse(data?.[arrayKey], itemSchema, context));
    url = cursor.data.nextPageUrl; // null ⇒ done
    p = undefined; // nextPageUrl already carries query state
  }
  return out;
}
```

### Tests (in this phase)
- `tests/unit/client/base-resource.test.ts` (nock): `validateRequest` throws `DattoValidationError('request')` on an unknown key / missing required write field; `validateResponse` strips unknowns and returns; `validateArrayResponse` drops one bad item and keeps the rest with a `warn`.
- `tests/unit/client/paginate.test.ts` (nock): a two-page walk concatenates items and stops on `nextPageUrl:null`; a page missing `pageDetails` (or with a non-string `nextPageUrl`) **throws** `DattoValidationError` rather than truncating; a lenient item on page 2 is dropped without aborting the walk.
- `tests/unit/spec-overrides/*.test.ts`: `udfSchema` accepts `udf1…udf300` and nulls and rejects a non-`udf` key; `pageDetailsSchema` rejects a missing `count`; a write-body override rejects an empty body.

### Documentation (if needed)
- None yet.

### Exit Gate
```bash
npm run lint
npm run typecheck
npm test
```

---

## Phase 7: Resource namespaces I (account, sites, devices, alerts, jobs) + client scaffold

### Goal
Implement the first five `*Resource` classes over `BaseResource`, each exposing its operations as thin methods that select the generated request/reconciled-response schemas and the correct rate-limit `opKey`, and stand up a `DattoRmmClient` scaffold that mounts them. Prove the retired 0.1.x methods' replacements: `client.devices.get(uid)`, `client.account.devices()`, `client.devices.setUdf(uid, udf)` (realigned to `POST /api/v2/device/{uid}/udf`).

**Requirements:** R1, R2

### Steps
1. **AccountResource** `src/client/resources/account-resource.ts` — account-level reads incl. `devices()` (paginated `GET /api/v2/account/devices` via `paginate` + reconciled `Device` schema), account variables, etc.
2. **SiteResource** `src/client/resources/site-resource.ts` — site list/get, site devices, site variables (writes tagged with their opKeys, e.g. `site-create`).
3. **DeviceResource** `src/client/resources/device-resource.ts` — `get(uid)`, `setUdf(uid, udf)` → `POST /api/v2/device/{uid}/udf` with `opKey:'device-udf-set'` and the strict udf write-body override, `move` (`device-move`), `createJob` (`device-job-create`), warranty/proxy writes.
4. **AlertResource** `src/client/resources/alert-resource.ts` — open/resolved alert reads (incl. `openForSite`), `resolve(uid)` (`alert-resolve`), muting; `alertContext` validated via the permissive override.
5. **JobResource** `src/client/resources/job-resource.ts` — job reads and job component operations.
6. **Client scaffold** `src/client/datto-rmm-client.ts`: construct the masked logger, config `.safeParse` (throw `DattoValidationError` on failure), axios instance + auth/rate-limit/retry wiring (from Phase 5), and mount these five namespaces. Leave the other five namespaces for Phase 8. Do **not** touch `src/index.ts` yet (old barrel still active).
   - Files: the five resource files + `src/client/datto-rmm-client.ts`

### Opinionated Implementation Notes (Examples)
```ts
export class DeviceResource extends BaseResource {
  get(uid: string): Promise<Device> {
    return this.get(`/api/v2/device/${uid}`, deviceResponseSchema, 'GET /device/{uid}');
  }
  setUdf(uid: string, udf: DeviceUdfInput): Promise<void> {
    return this.post(`/api/v2/device/${uid}/udf`, udf, udfWriteBodySchema, z.void(),
                     'POST /device/{uid}/udf', 'device-udf-set'); // opKey → 600 write window
  }
}
```

### Tests (in this phase, nock)
- One test file per resource under `tests/unit/client/resources/`: each asserts the method hits the right path/verb, validates the response through the reconciled schema, and — for writes — tags the correct `opKey` and rejects a malformed body.
- `tests/unit/client/resources/device-resource.test.ts` explicitly asserts `setUdf` targets `POST /api/v2/device/{uid}/udf` (the corrected endpoint), and that a UDF-bearing response is masked in any emitted log (cross-checks R20 end-to-end).
- Scaffold test: `client.devices`, `client.account`, `client.sites`, `client.alerts`, `client.jobs` are defined and typed.

### Documentation (if needed)
- None yet.

### Exit Gate
```bash
npm run lint
npm run typecheck
npm test
```

---

## Phase 8: Resource namespaces II (audit, filters, users, activityLogs, system), client finalize, and old-surface removal

### Goal
Implement the remaining five namespaces, finalize `DattoRmmClient` with all ten mounted, rewrite `src/index.ts` to the new public surface (`createDattoRmmClient`, `DattoRmmClient`, config/logger types, error classes, generated types), and **delete the entire old surface** in the same commit. After this phase every one of the 53 paths / 75 operations is reachable via `client.<resource>.<operation>()` and the package no longer exports `Result`/`ProblemError`/the three 0.1.x methods (R19).

**Requirements:** R1, R2, R19

### Steps
1. **AuditResource** `src/client/resources/audit-resource.ts` — audit-*fetch* operations (device/printer/ESXi audit; singular namespace per the design's naming rule).
2. **FilterResource** `src/client/resources/filter-resource.ts` — default & custom filters.
3. **UserResource** `src/client/resources/user-resource.ts` — user reads, `resetKeys` (`user-reset-keys`).
4. **ActivityLogResource** `src/client/resources/activity-log-resource.ts` — activity log reads (paginated).
5. **SystemResource** `src/client/resources/system-resource.ts` — `requestRate()` (`GET /api/v2/system/request_rate`) and other system reads. Exposed for consumers to reconcile against the live budget; the client does **not** call it at init.
6. **Finalize `DattoRmmClient`**: mount all ten namespaces (`account`, `sites`, `devices`, `alerts`, `jobs`, `audit`, `filters`, `users`, `activityLogs`, `system`) and add `createDattoRmmClient(config)`.
7. **New public barrel** `src/index.ts`: export `createDattoRmmClient`, `DattoRmmClient`, `DattoRmmClientConfig` + `DattoLogger` types, the error classes (`DattoApiError`, `DattoValidationError`, `BaseError`), and re-export the generated types. Remove the old `result`/`schemas` exports.
8. **Delete the old surface in this commit:** `src/client.ts`, `src/config.ts`, `src/logger.ts`, `src/result.ts`, `src/validation.ts`, `src/schemas.ts`, `src/httpClient.ts`, `src/auth.ts`, `src/rateLimiter.ts`, `src/tokenStore.ts`, `src/internal/`, and the four old `src/__tests__/*.test.ts` (their behavior is superseded by the new resource/validation tests). Keep `src/__tests__/fixtures/*.json` (reused in Phase 9).
   - Files: five resource files, `src/client/datto-rmm-client.ts`, `src/index.ts`, plus deletions above.

### Opinionated Implementation Notes (Examples)
```ts
// src/index.ts (new surface)
export { createDattoRmmClient, DattoRmmClient } from './client/datto-rmm-client';
export type { DattoRmmClientConfig } from './client/datto-client-config';
export type { DattoLogger } from './logging/logger';
export { BaseError, DattoApiError, DattoValidationError } from './errors';
export * from './generated/types';
```

### Tests (in this phase, nock)
- One test file per new resource (as in Phase 7).
- `tests/unit/client/surface.test.ts`: all ten namespaces exist on a constructed client; `createDattoRmmClient` throws `DattoValidationError` on invalid config; the retired names (`getAccountDevices`, `getDeviceByUid`, `updateDeviceUdfs`, `Result`, `ProblemError`) are **not** exported (import assertions / type-level check).
- `tests/unit/client/coverage-map.test.ts`: enumerate the ten namespaces' methods and assert the count reaches the full operation set (guards R1 — no path silently missing).

### Documentation (if needed)
- None yet (README is Phase 10) — but keep JSDoc on each public method.

### Exit Gate
```bash
npm run lint
npm run typecheck
npm test
npm run build
```
- `git grep -n "Result<" src/` and `git grep -n "validationMode" src/` return nothing (old contract fully removed).
- No file under the deleted list remains.

---

## Phase 9: Fixtures, sanitization, secret-scan, and reconciled-schema validation

### Goal
Prove the generated + reconciled schemas validate against realistic captured shapes exercising every leniency path (nullability, unknown keys, per-item drop, open enums, epoch-ms timestamps, `udf1…udf300`, `@class` alert contexts), and enforce mechanically that no secret-bearing sweep data or UDF secret can ever be committed.

**Requirements:** R17, R5, R7, R8, R20, R1

### Steps
1. **Synthesized-plus-real fixtures** under `tests/fixtures/`: keep/extend the existing real `src/__tests__/fixtures/device*.json`; add per-namespace fixtures that deliberately encode the design's observed reality — a device with `udf300` set and many nulls and `deviceClass:'rmmnetworkdevice'`; an alert with each `@class` context (`comp_script_ctx`, `eventlog_ctx`, `patch_ctx`, `antivirus_ctx`, `online_offline_status_ctx`, `perf_resource_usage_ctx`); a paged collection with a malformed item to drop; timestamps as epoch-ms integers. **No real secrets** in any committed fixture.
   - Files: `tests/fixtures/**`
2. **Sanitization script** `scripts/sanitize-fixtures.mjs`: given a raw sweep file, redact/synthesize secret-bearing fields (notably every `udf*`) while preserving type/nullability shape, emitting a commit-safe fixture. Documented, deterministic. (Used by a maintainer capturing real data; not run in CI against live data.)
   - Files: `scripts/sanitize-fixtures.mjs`
3. **Secret-scan** `scripts/scan-secrets.mjs` + CI/pre-commit wiring: fail the build if any tracked file under `spec/` or `tests/fixtures/` contains a `udf*`/credential-shaped value in cleartext (heuristics: non-null `udf\d+` string values, BitLocker-key patterns, `password`/`secret` keys with values). Wire it into `prepublishOnly` and a lint-adjacent script (`"scan:secrets"`), and add a `.github` pre-commit/CI step.
   - Files: `scripts/scan-secrets.mjs`, `package.json` (add `"scan:secrets"`), `.github/workflows/*` (add the scan step)
4. **Fixture-validation tests** `tests/integration/fixtures.test.ts`: parse each fixture through its reconciled schema via the resource/`parseLenient` path and assert:
   - Every fixture validates (leniency tolerates nulls/unknowns) (R5, R8, R17).
   - The malformed collection item is dropped, the rest survive (R7).
   - The `rmmnetworkdevice`/novel-enum fixture both **type-checks** against the codemod-widened response type **and** survives `parseLenient` without being dropped — asserting the build-time and runtime enum widening cover the same field set (Success Criteria, R5).
   - Logging any UDF-bearing fixture through the client's masked logger never emits the raw value to the sink (R20).

### Opinionated Implementation Notes (Examples)
```ts
// enum-alignment assertion (compile-time + runtime in one test)
const wire = loadFixture('device-rmmnetworkdevice.json');
const parsed = deviceResponseSchema /* via parseLenient */;
const dc: Device['deviceClass'] = 'rmmnetworkdevice'; // must type-check (open enum)
expect(() => validateResponse(wire)).not.toThrow();
expect(validateResponse(wire).deviceClass).toBe('rmmnetworkdevice'); // not dropped
```

### Tests (in this phase)
- `tests/integration/fixtures.test.ts` (above).
- `tests/unit/scripts/scan-secrets.test.ts`: the scanner flags a planted `udf5:"S3CR3T"` fixture and passes a clean one.
- `tests/unit/scripts/sanitize-fixtures.test.ts`: sanitizing a raw sample redacts `udf*` while preserving key set and null positions.

### Documentation (if needed)
- None yet.

### Exit Gate
```bash
npm run lint
npm run typecheck
npm test
node scripts/scan-secrets.mjs
```
- `node scripts/scan-secrets.mjs` exits 0 (no secret-shaped values tracked) and is proven to exit non-zero on a planted secret (covered by its unit test).

---

## Phase 10: README, upgrade guide, and 1.0.0 release prep

### Goal
Ship the documentation the design mandates and prepare the breaking `1.0.0`: a comprehensive README covering install, auth, every namespace (with the explicit namespace→endpoint map), error handling, logger injection + masking, validation leniency, and rate-limit config, plus the `0.1.x → 1.0.0` upgrade path; bump the version and verify the publish shape.

**Requirements:** R18, R16, R19

### Steps
1. **Rewrite `README.md`** (R18): install (ESM, Node ≥ 20); auth setup (`createDattoRmmClient` with `apiUrl`/`apiKey`/`apiSecret`); a **namespace→endpoint map** table making the `account.devices()` (list) vs `devices.get(uid)` (single/mutate) split explicit across all ten namespaces; error handling (`try/catch` on `DattoApiError`/`DattoValidationError`, the `retryAfterMs`/`ip-block` fields); logger injection (the `DattoLogger` shape) and the UDF-masking guarantee ("no UDF value in cleartext"; note non-UDF fields like `variables`/`Site.notes` are the consumer's responsibility — a Non-Goal); validation leniency (response-lenient/open-enum, request-strict) and the caller's obligation to handle an unknown enum value; rate-limit config and `system.requestRate()`; and the `alertContext` `@class` discriminator with observed shapes.
   - Files: `README.md`
2. **Upgrade guide** (section in `README.md`): the five documented breaking changes (method renames + the corrected UDF endpoint, `Result`→throw, removed `validationMode`, config field changes, `LoggerLike`→`DattoLogger` with a thin `console` shim example).
   - Files: `README.md`
3. **Version bump to `1.0.0`** in `package.json`; confirm `"files"`/`exports`/`types`/`module` publish `dist` + `.d.ts` as ESM `1.0.0` (R16, R19); confirm `publishConfig.access:'public'`.
   - Files: `package.json`

### Tests (in this phase)
- `tests/unit/readme.test.ts` (optional but recommended): assert the README contains a row for each of the ten namespaces (guards the namespace→endpoint map against drift) and mentions `DattoApiError`, `DattoValidationError`, and "redacted".
- No behavioral tests; `npm run build` proves the publishable shape.

### Documentation (if needed)
- This phase **is** the documentation.

### Exit Gate
```bash
npm run lint
npm run typecheck
npm test
npm run build
node -e "const p=require('./package.json'); if(p.version!=='1.0.0') process.exit(1); if(p.type!=='module') process.exit(1);"
```
- `README.md` contains the namespace→endpoint map (all ten namespaces), the error-handling section, the logger/masking section, the leniency section, the rate-limit section, and the `0.1.x → 1.0.0` upgrade guide.
- `dist/index.js` and `dist/index.d.ts` exist after `npm run build`.

---

## Deferred Validation (run after implementation is complete)
- **Live spec refresh & diff:** re-fetch `GET {apiUrl}/api/v3/api-docs/Datto-RMM` from a real region, overwrite `spec/openapi.json`, run `npm run generate`, and inspect `git diff spec/openapi-prev.json` and `src/generated/**` — confirms the patch step still covers upstream and that regeneration is clean. Requires egress to `*.centrastage.net`, so it cannot run unattended in CI.
- **Real captured-response validation (R17):** against a live Datto account, run a read-only sweep (devices, sites, users, alerts, audits), sanitize it with `scripts/sanitize-fixtures.mjs`, and confirm the reconciled schemas validate the real payloads with only expected leniency (widenings/strips) — grounds the synthesized fixtures against production. Needs live credentials and account data.
- **Printer/ESXi audit & proxy-settings shapes:** validate against a device population that actually includes printers/ESXi hosts and proxy settings (absent from the sampled account) — spec-derived-only until such hardware is available (design risk row).
- **Real 429/403 rate-limit behavior:** drive a real write burst past a per-operation ceiling to confirm the server's actual `Retry-After`/403 timing matches the modeled tiers — requires a live account and risks a 5-minute IP-block, so it is deliberately not automated.
- **Published-package smoke test:** `npm pack` the `1.0.0` tarball and install it into a scratch consumer project to confirm ESM import + types resolve as published — final human check before `npm publish`.
</content>
</invoke>
