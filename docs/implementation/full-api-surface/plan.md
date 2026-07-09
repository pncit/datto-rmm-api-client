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
  - The existing `src/__tests__/fixtures/*.json` are real device captures safe to keep: their only non-null udfs are the benign `udf1:"value1"`/`"value2"`, verified by direct inspection of those exact files (they predate this project and carry no observed UDF secrets). This is confirmed by manual/commit-time review rather than an automated scan — Phase 9 ships no secret-detector (see Phase 9 Step 2 for why). Any *future* real capture is made commit-safe by `scripts/sanitize-fixtures.mjs`, which redacts all `udf*` to `null` before the file is committed.
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
- **Coexistence rule (critical):** all new code lands under **new paths** (`src/errors/`, `src/logging/`, `src/validation/`, `src/http/`, `src/rate-limit/`, `src/client/`, `src/generated/`, `src/schema-overrides/`, plus the layer-neutral `src/defaults.ts`) while the old surface (`src/client.ts`, `src/config.ts`, `src/logger.ts`, `src/result.ts`, `src/validation.ts`, `src/schemas.ts`, `src/httpClient.ts`, `src/auth.ts`, `src/rateLimiter.ts`, `src/tokenStore.ts`, `src/internal/`) stays untouched and compiling until **Phase 8**, which deletes it in one commit alongside the new `src/index.ts`. This keeps `typecheck`+`test` green at every phase boundary. Do **not** edit the old files' logic before Phase 8.
- **Never hand-edit `src/generated/**`.** It is overwritten by `npm run generate`. Corrections live in the patch step (Phase 2), the enum codemod (Phase 2), or `src/schema-overrides/` (Phase 6).
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
   - Add (devDependencies): `orval@^7`, `tsup@^8`, `vitest@^4`, `nock@^14`, `@vitest/coverage-v8@^4`, `@types/node@^22` (the toolchain matches `fuze-api`, but `@types/node` is pinned to the **supported runtime floor** — Node ≥ 20, so `^22` — deliberately **not** `fuze-api`'s `^26`, so code cannot compile against Node-26-only APIs absent on the Node 20 floor per R16/Non-Goals).
   - Keep `zod@^4`, `axios@^1.10`, eslint/prettier stack.
   - Files: `package.json`
2. **Rewrite scripts** in `package.json`:
   - `"build": "tsup"`, `"test": "vitest run"`, `"test:watch": "vitest"`, `"typecheck": "tsc --noEmit"`, `"generate": "node scripts/patch-spec.mjs && orval && node scripts/dedupe-generated-index.mjs && node scripts/widen-response-enums.mjs"`, `"generate:raw": "orval"`, `"clean": "rm -rf dist"`, `"prepublishOnly": "npm run build && npm run test"`. Update `"files"` to keep `dist`, `README.md`, `LICENSE`.
   - Note: `scripts/patch-spec.mjs` / `scripts/dedupe-generated-index.mjs` / `scripts/widen-response-enums.mjs` are created in Phase 2; the `generate` script line is present now but not run in this phase's gate. Pipeline order is `patch-spec → orval → dedupe-generated-index → widen-response-enums` (dedupe cleans the generated index immediately after Orval, before the enum widen scans `src/generated/types/**`).
   - Files: `package.json`
3. **Add build/test/codegen configs** (copy from `fuze-api`, adjust names/paths):
   - `tsup.config.ts` — ESM only, `dts:true`, `entry:{index:'src/index.ts'}`, `sourcemap:true`, `clean:true`, `treeshake:true`. (Single entry; no browser build — browser is a Non-Goal.)
   - `vitest.config.ts` — `globals:true`, `environment:'node'`, `include:['tests/**/*.test.ts','src/**/*.test.ts']`, coverage `exclude:['src/generated/**','src/index.ts']`, `resolve.alias` `@`→`./src`.
   - `orval.config.ts` — two targets (see snippet); input `./spec/openapi.patched.json`; the axios/types target emits the reusable **types** to `src/generated/types` (via `output.schemas`) — this is the only product of that target the client consumes; zod target → `src/generated/schemas/api.zod.ts`, `fileExtension:'.zod.ts'`, `strict.response:false` / `body|param|query|header:true`, `coerce.date`.
   - **Do not commit or consume a generated endpoints layer** (resolves the "dead second source of truth for paths" hazard). Because the Datto spec declares paths, Orval unavoidably emits an endpoints file for the axios target; direct it to `src/generated/endpoints/**` and **git-ignore that directory** (Step 6) so it is a transient, uncommitted artifact — resources hand-write their paths as the single source of truth (reconciled in Phase 8's coverage-map test against the spec). No `override.mutator` is configured and **no `src/http/axios-mutator.ts` is created**: the shared, interceptor-bearing axios instance is built directly in Phase 5's `http-client.ts`. The committed generated tree is therefore exactly `src/generated/types/**` + `src/generated/schemas/**`.
   - Files: `tsup.config.ts`, `vitest.config.ts`, `orval.config.ts`
4. **Enable the `@/` path alias** for source (mirrors `fuze-api`): add `compilerOptions.paths` `{"@/*":["./src/*"]}` and `baseUrl:"."` to `tsconfig.json`, and set **`moduleResolution: "Bundler"`** (the repo is currently `Node`). Pin `Bundler` specifically — **do not use `NodeNext`**: `NodeNext` would demand explicit `.js` import extensions the old hand-written `src/*.ts` files (which must keep compiling under `npm run typecheck` at every phase boundary through Phase 7, per the coexistence rule) do not carry, breaking this very phase's `typecheck` gate. `Bundler` resolves the `@/*` alias without any import-extension rewrites, and both tsup and vitest support it.
   - **Set `module` to a compatible value in the same edit.** `moduleResolution: "Bundler"` is only valid when `compilerOptions.module` is `"ESNext"` (or `"Preserve"`); with any other `module` value (the repo may currently be `NodeNext`/`CommonJS`) `tsc` errors `Option 'moduleResolution' can only be "Bundler" when 'module' is set to "ES2015" or later` and this phase's own `typecheck` gate fails. Set `module: "ESNext"` alongside `moduleResolution: "Bundler"`; the pairing is required, not optional.
   - Files: `tsconfig.json`
5. **Convert the existing jest tests to vitest.** Delete `jest.config.js`. In `src/__tests__/*.test.ts`, replace jest globals with vitest imports (or rely on `globals:true`); replace `jest.fn`/`jest.mock` with `vi.fn`/`vi.mock`. These tests still exercise the old `Result`-returning surface and must stay green until Phase 8 deletes them.
   - Files: `jest.config.js` (delete), `src/__tests__/client.test.ts`, `src/__tests__/deviceSchema.test.ts`, `src/__tests__/devicesMethod.test.ts`, `src/__tests__/validation.test.ts`
6. **`.gitignore`:** add `spec/openapi.patched.json` (transient), `src/generated/endpoints/` (the uncommitted Orval endpoints artifact — see Step 3), and `coverage/`; add the committed-generated note (finalized in Phase 2).
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
      // endpoints are emitted here but git-ignored (Step 6) — never committed, never imported;
      // only `schemas: './src/generated/types'` (the TS types) is the product we consume.
      target: './src/generated/endpoints/api.ts',
      schemas: './src/generated/types',
      client: 'axios',
      // no mutator: the shared axios instance is built in Phase 5's http-client.ts, not via Orval.
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
test ! -f jest.config.js                       # old jest config removed
! grep -qE '"(jest|ts-jest|@types/jest)"' package.json   # no jest/ts-jest dep remains
test -f orval.config.ts && test -f tsup.config.ts && test -f vitest.config.ts
npx orval --help >/dev/null                     # binary installed (NOT run against a spec this phase)
```

---

## Phase 2: Spec pipeline and code generation

### Goal
Commit Datto's OpenAPI spec, add the deterministic patch step and the response-enum-widening codemod, wire `npm run generate` (patch → orval → codemod), and generate **and commit** `src/generated/**`. After this phase, a fresh `npm run generate` reproduces `src/generated/**` byte-for-byte (R15), and the generated types + zod schemas typecheck.

**Requirements:** R4, R8, R15, R5

### Steps
1. **Fetch and commit the spec.** `GET {apiUrl}/api/v3/api-docs/Datto-RMM` (e.g. `https://zinfandel-api.centrastage.net/api/v3/api-docs/Datto-RMM`), pretty-print stably, and write `spec/openapi.json`. Copy it to `spec/openapi-prev.json` as the diffing baseline (first commit: identical; future refreshes update `openapi.json` and diff against the retained prev).
   - Files: `spec/openapi.json`, `spec/openapi-prev.json`
   - Notes: If egress to `*.centrastage.net` is unavailable, a maintainer supplies `spec/openapi.json`; the rest of the phase is offline. Serialize once with a single stable, deterministic format (2-space indent, trailing newline, key order preserved as fetched — no re-sorting) and commit that file. Because `spec/openapi.json` is committed once and frozen, reproducibility derives from the frozen committed file itself, not from any re-serialization at generate time.
2. **Write the patch step** `scripts/patch-spec.mjs`: read `spec/openapi.json`, apply the deterministic, data-driven structural corrections generation cannot infer, write `spec/openapi.patched.json` (transient, git-ignored):
   - **Timestamps `string`→`integer`** (epoch-ms): retype the known timestamp properties across component schemas — `Device.lastSeen/lastReboot/lastAuditDate/creationDate`, `AuthUser.created/lastAccess`, `Alert.timestamp/resolvedOn` (drive from a documented list constant, not a global rename).
   - **`Alert.alertContext`** → a permissive open object `{ type:'object', properties:{ '@class':{ type:'string' } }, additionalProperties:true }` (captures the Jackson `@class` discriminator; the spec's ~30 dead `*Context` schemas are left in place but no longer referenced by `alertContext`).
   - **Fail loud on drift (do not silently no-op):** the patch must **throw** (non-zero exit) if any anchor it expects to correct is absent — every `(schema, field)` in `TIMESTAMP_FIELDS` and the `Alert.alertContext` property. A future spec refresh that renames/relocates a timestamp field would otherwise silently reship it as `string`, re-introducing the exact defect R8 exists to fix and relying only on downstream fixture tests to catch it. So iterate the documented list and, for each missing anchor, collect the name and `throw new Error('patch-spec: missing expected schema fields: …')` after the pass — failing `npm run generate` at the patch step, not later.
   - Files: `scripts/patch-spec.mjs`
3. **Port the generated-index dedupe step** `scripts/dedupe-generated-index.mjs`: copy `fuze-api`'s script near-verbatim (only the `GENERATED_INDEX_PATH` constant needs to match this repo's `src/generated/types/index.ts`). Orval sometimes emits duplicate export lines in `src/generated/types/index.ts` (e.g. both `./foo` and `./foo.js` for the same module); the script normalizes each `export …` line (strips a trailing `.js` extension), drops exact duplicates, and rewrites the index only when duplicates were found (idempotent). This runs **after Orval and before the enum-widening codemod** so the index the widen step scans is already deduped. Faithfully ported (not reinvented) per the "Port, don't reinvent" rule and the `fuze-api` post-generate precedent — a duplicated index would otherwise ship into the committed generated output or trip Phase 2's `npm run lint` gate (`no-duplicate-imports` / duplicate export).
   - Files: `scripts/dedupe-generated-index.mjs`
4. **Write the response-enum-widening codemod** `scripts/widen-response-enums.mjs`: after Orval runs, rewrite every **response** enum field so its emitted TypeScript type is the open form `EnumUnion | (string & {})` (R5), deterministically across `src/generated/`. This idiom has no JSON-Schema representation, so it must be a post-generate script, not an Orval hook. Keep the transform idempotent (running twice is a no-op) so reproducibility holds.
   - **Concrete response-vs-request discrimination rule** (this is the whole correctness of the codemod): the codemod scans **only `src/generated/types/**`** and widens enum unions **only inside exported type/interface declarations whose type name does *not* end in one of Orval's request-side suffixes** — `Body`, `Params`, `Parameter`, `Parameters`, `Query`, `QueryParams`, `Header`, `Headers`, `PathParameters`. Every other exported model type in `types/**` is a component-schema/response DTO (`Device`, `Alert`, `AuthUser`, the `*200`/response envelopes) and its enums are widened. Because Datto's write bodies are distinct small `*Body` types (no shared component-schema is used as a request body), scoping by this suffix set keeps request/param/body enums **closed** while widening response enums. The suffix list is a documented constant at the top of the script; if a future Orval version changes request-type naming, this one constant is the single point to update.
   - **Verify the load-bearing assumption (do not just trust it):** the whole rule rests on "no request body `$ref`s a component schema that is also used as a response." Add a **guard** — a scan of the patched spec (`spec/openapi.patched.json`) run as the first thing the codemod does (or a standalone assertion in `widen-enums.test.ts`) that walks every operation's `requestBody.content['application/json'].schema` and **throws** if any request body `$ref`s a `#/components/schemas/*` name that also appears as a response schema `$ref`. If that guard ever fires, the suffix heuristic could silently widen a shared request-body enum, so it fails the build and forces an explicit fix rather than a silent request-type loosening.
   - Files: `scripts/widen-response-enums.mjs`
   - Notes: Runtime enum *degradation* is a separate mechanism handled in Phase 4's `parseLenient`; this codemod only widens the compile-time type. Phase 9 asserts the two stay aligned on the same field set.
5. **Generate and commit** `src/generated/**`: run `npm run generate`; commit the output. Add the `.gitignore` note (copy `fuze-api`'s wording) that `src/generated/` is intentionally committed because it derives from an external spec, and that `spec/openapi.patched.json` is ignored.
   - Files: `src/generated/**` (committed), `.gitignore`
6. **Verify reproducibility:** re-run `npm run generate`; `git diff --exit-code src/generated` must be empty (this also confirms the dedupe step is idempotent — a second run produces no index churn).

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
const missing = [];
for (const [schema, fields] of Object.entries(TIMESTAMP_FIELDS)) {
  const props = spec.components?.schemas?.[schema]?.properties;
  for (const f of fields) {
    if (props?.[f]) { props[f].type = 'integer'; props[f].format = 'int64'; delete props[f].enum; }
    else missing.push(`${schema}.${f}`);
  }
}
const alert = spec.components?.schemas?.Alert?.properties;
if (alert?.alertContext) alert.alertContext = { type: 'object', properties: { '@class': { type: 'string' } }, additionalProperties: true };
else missing.push('Alert.alertContext');
if (missing.length) throw new Error(`patch-spec: missing expected schema fields: ${missing.join(', ')}`); // fail loud on drift
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
- `tests/generated/patch-spec.test.ts`: unit-test `patch-spec.mjs` against a tiny inline spec fragment — timestamp fields become `integer`, `alertContext` becomes the permissive object; **and a fragment with a renamed/absent timestamp anchor (or missing `alertContext`) makes the patch throw** (guards the fail-loud drift behavior). (No network.)
- `tests/generated/dedupe-index.test.ts`: unit-test `dedupe-generated-index.mjs` against a fixture index string containing a `.js`/no-extension duplicate pair — assert the duplicate export is removed, non-export lines are preserved, and a second pass is a no-op (idempotent).
- `tests/generated/widen-enums.test.ts`: unit-test the codemod against a fixture string containing an enum in a component-schema type (e.g. `Device.deviceClass`), an enum in a `*Body` type, and an enum in a `*Params` type; assert **only** the component-schema (response) enum gains `| (string & {})` while the `*Body`/`*Params` enums stay closed (guards the over-widen risk that would silently loosen the request-side type contract), and that a second pass is a no-op. Add a case for the **shared-schema guard**: a spec fragment where a request body `$ref`s a component schema also used as a response makes the guard **throw** (proves the load-bearing assumption is verified, not assumed).

### Documentation (if needed)
- None yet.

### Exit Gate
```bash
npm run generate
git diff --exit-code -- src/generated
npm run typecheck
npm run lint
npm test
git ls-files --error-unmatch spec/openapi.json spec/openapi-prev.json   # both spec files committed
! git ls-files --error-unmatch spec/openapi.patched.json 2>/dev/null     # patched spec NOT tracked
grep -qE 'openapi\.patched\.json' .gitignore                             # patched spec git-ignored
test -n "$(ls -A src/generated)"                                         # generated output committed & non-empty
ls src/generated/schemas/*/*.zod.ts >/dev/null && test -d src/generated/types
```
- `spec/openapi.json` and `spec/openapi-prev.json` are committed; `spec/openapi.patched.json` is git-ignored and untracked.
- `src/generated/**` is committed and non-empty (contains `schemas/*/*.zod.ts` and `types/`).

---

## Phase 3: Error hierarchy, injectable logger with UDF masking, and config

### Goal
Port the `fuze-api` throwing error hierarchy and injectable structured logger as `Datto*`, add the UDF-masking logger decorator through which all client logging flows (R20), and define the new zod-validated `DattoRmmClientConfig` (R14). All new files; old `src/errors`-less surface untouched.

**Requirements:** R9, R13, R14, R20

### Steps
1. **Error hierarchy** under `src/errors/` (port from `fuze-api`, rename). Pin the exact constructor signatures here so every construction site (Phase 5/6) agrees:
   - `base-error.ts` (`BaseError`, verbatim).
   - `datto-api-error.ts` — **`DattoApiError`** with the **pinned signature `constructor(message: string, opts: { statusCode: number; response?: unknown; requestId?: string; retryAfterMs?: number; code?: 'ip-block' | 'forbidden'; cause?: unknown })`**. Fields: `statusCode`, `response`, `requestId`, `retryAfterMs?` (429), `code?` (403 classification — `'ip-block'` for a rate-limit block penalty, `'forbidden'` for an ordinary authorization failure, disambiguated in Phase 5), and `cause?` (set via `Error.cause`, carrying the originating `AxiosError`). `static fromAxiosError(err): DattoApiError` builds the options bag from an `AxiosError` and delegates to this same constructor, so the direct-construction path (403, Phase 5 example) and `fromAxiosError` produce identical instances.
   - `datto-validation-error.ts` — **`DattoValidationError`** with the **pinned signature `constructor(zodError: z.ZodError, stage: 'request' | 'response', opts?: { payload?: unknown; context?: string })`**. `payload` is the offending wire value (optional); `context` is a human label for the call site (e.g. `'GET /device/{uid}'`). Message via `z.prettifyError`; `getErrorTree`. Every Phase 5/6/7/8 construction uses this 2-or-3-arg form (`new DattoValidationError(err, 'request')`, `new DattoValidationError(cursor.error, 'response', { context })`).
   - `index.ts` barrel.
   - Files: `src/errors/base-error.ts`, `src/errors/datto-api-error.ts`, `src/errors/datto-validation-error.ts`, `src/errors/index.ts`
2. **Logger** `src/logging/logger.ts`: `DattoLogger` type (`debug/info/warn/error`, each `(message: string, meta?: Record<string, unknown>) => void`), `dattoLoggerSchema` via `z.function` (mirror `fuzeLoggerSchema`), and a `consoleLogger` default backed by `console`.
   - Files: `src/logging/logger.ts`
3. **UDF-masking decorator** `src/logging/mask.ts`: `withUdfMasking(logger: DattoLogger): DattoLogger` wraps all four methods; before delegating, it deep-walks each call's `meta` and replaces every **non-null** value under any key matching `/^udf\d+$/` (and inside a nested `udf` record) — **regardless of wire type** (string, number, or a nested object/array) — with `[redacted - N characters]` where `N` is the length of the value's string form (`String(v).length`, or its `JSON.stringify` length for objects/arrays). A non-string udf value is never passed through or recursed into unredacted. Null/absent UDFs pass through unchanged; surrounding structure is preserved so a redacted line stays diagnostically useful (R20). This is the single logger boundary — the client constructs `withUdfMasking(config.logger ?? consoleLogger)` once and hands that wrapped logger to every layer, so no call site can leak a raw UDF value.
   - **Load-bearing invariant (the decorator scrubs `meta`, not the message string):** because `scrub` only walks the `meta` object and never inspects the message text, the "no call site can leak a raw UDF value" guarantee holds **only if every wire-derived value is passed through `meta`, never interpolated into the message string.** Make this an explicit, documented rule for all logging call sites (enforced concretely in the Phase 4 leniency diagnostics and the Phase 6 drop summary, whose `field=value` pairs ride in `meta` with the message carrying only static text + the field name). A log call that formats a wire value into the message text would bypass masking; the rule forbids it so the "single boundary" claim is literally true.
   - Files: `src/logging/mask.ts`
4. **Config** `src/client/datto-client-config.ts`: `dattoRmmClientConfigSchema = z.strictObject({...})` and `type DattoRmmClientConfig = z.infer<...>`:
   - `apiUrl` (`z.url()`), `apiKey`/`apiSecret` (`z.string().min(1)`).
   - `logger?` (`dattoLoggerSchema.optional()`), `userAgentExtra?` (`z.string().optional()` — now functional, sets a `User-Agent` header suffix in Phase 5), `tokenRefreshPct?` (`z.number().min(0).max(100).optional()` — now drives refresh timing in Phase 5).
   - `retry?` — a **strict sub-object** with a pinned shape and defaults: `z.strictObject({ maxAttempts: z.number().int().min(1).optional(), baseDelayMs: z.number().int().min(0).optional(), maxDelayMs: z.number().int().min(0).optional() }).optional()`. The retry default is **`DEFAULT_RETRY = { maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 5000 }`**, defined in the shared **`src/defaults.ts`** (see below) and imported here, by the Phase 5 http-client, and by its test — one source, so retry count and exponential-backoff timing are deterministic across implementors.
   - **Cross-cutting scalar defaults live in one layer-neutral module** `src/defaults.ts` (top-level, **not** under `src/client/`): export `DEFAULT_RETRY`, `DEFAULT_TOKEN_REFRESH_PCT = 25` (consumed by config *and* the Phase 5 auth-manager), and **`MAX_RETRY_AFTER_MS = 30_000`** (the ceiling the Phase 5 http-client applies to a server-supplied `Retry-After` — see Phase 5 Step 3(b)) from here, so a default consumed across module boundaries has exactly one home. **The module lives at `src/defaults.ts`, not `src/client/defaults.ts`, deliberately:** the transport layers (`src/http/http-client.ts`, `src/auth/auth-manager.ts`) sit *below* the client layer (design Overview: `BaseResource ◀── AuthManager, RateLimiter, HttpClient`, `DattoRmmClient` on top) and must depend **downward** on these scalars. Homing them under `src/client/` would force `http`/`auth` to import *upward* into the client layer while `src/client/datto-rmm-client.ts` imports `http`/`auth` back down — a directory-level import cycle `client → http → client`. A top-level, layer-neutral `src/defaults.ts` that both the transport layers and the client depend on downward breaks that cycle. (Domain tables that belong to a single subsystem — the rate-limit table `READ_LIMIT`/`WRITE_AGGREGATE_LIMIT`/… — stay co-located with their limiter consumer in `src/rate-limit/rate-limits.ts`; the rule is: **cross-cutting scalars → `src/defaults.ts`; single-subsystem domain constants → that subsystem's module.**)
   - `rateLimit?` — a **strict sub-object** that only **overrides** the committed `src/rate-limit/rate-limits.ts` table; it does not replace it. Overridable fields: `z.strictObject({ readLimit: z.number().int().min(1).optional(), writeAggregateLimit: z.number().int().min(1).optional(), windowSeconds: z.number().int().min(1).optional() }).optional()`. Unset fields fall back to the table's exported constants (`READ_LIMIT`, `WRITE_AGGREGATE_LIMIT`, `WINDOW_SECONDS`). **No `defaultWriteLimit` field:** because `WriteOpKey` is a closed union covering every real write (Phase 5 Step 1), no resource call can reach the `DEFAULT_WRITE_LIMIT` fallback, so exposing it as a config knob would be dead surface (the same R14 anti-pattern that drops `axiosInstance`). `DEFAULT_WRITE_LIMIT` stays a limiter-internal defensive constant only.
   - **Removed vs 0.1.x:** `autoRefresh`, `validationMode` (do not carry forward). **No `axiosInstance` field** — the client always constructs its own axios instance (Phase 5) so auth/rate-limit/retry interceptors are guaranteed to be wired; a caller-supplied instance is deliberately not accepted (avoids re-introducing a dead/unwired config knob, per R14).
   - Files: `src/client/datto-client-config.ts`, `src/defaults.ts`
   - Notes: the client constructor `.safeParse`s config and throws `DattoValidationError(err, 'request')` on failure (wired in Phase 8), exactly as `FuzeClient` does.

### Opinionated Implementation Notes (Examples)
```ts
// src/logging/mask.ts
const UDF_KEY = /^udf\d+$/;
// redact ANY non-null udf value (string, number, object, array) — never pass a raw one through
const mask = (v: unknown) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v) ?? String(v);
  return `[redacted - ${s.length} characters]`;
};
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
- `tests/unit/logging/mask.test.ts` (proves R20): logging `{ udf: { udf1: 'S3CR3T', udf7: null }, udf3: 12345, udf5: 'abcd', udf9: { key: 'BitLockerRecoveryKey' }, host: 'PC1' }` yields `udf1='[redacted - 6 characters]'`, `udf7` stays `null`, **`udf3='[redacted - 5 characters]'` (numeric udf value — masked regardless of wire type)**, `udf5='[redacted - 4 characters]'`, `udf9` redacted (its object value replaced by a `[redacted - N characters]` string, **not** passed through), `host` unchanged; the underlying sink (a `vi.fn()`) never receives `'S3CR3T'`, `12345`, or `'BitLockerRecoveryKey'` in any argument.
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
3. **Aggregate diagnostics** in a small `DiagnosticsCollector` (module-local): dedupe `(context, field, value)` for unknown-key strips and enum widenings, and emit **one** summarized `debug` line per `(context, field, value)` at the end of a parse/collection (conceptually `widened deviceClass=rmmnetworkdevice on 3/848 items`, produced as message `"widened response enum"` + `meta { field, value, count, total }` per the value-in-`meta` rule below) rather than per row. This keeps a fully-walked 848-device / 1500-alert page from producing thousands of lines or running the masker in a per-row hot path. **The per-item drop path (R7) is aggregated the same way** — see Phase 6 Step 1: `validateArrayResponse` accumulates drops for the call and emits **one** `warn` summary, not one masked line per dropped row.
   - **Diagnostic messages carry no wire values in the message string (R20 invariant):** the masker (Phase 3 Step 3) scrubs only the `meta` object, never the message text, so **every wire-derived value in a diagnostic — the enum `value`, a stripped key's value, a dropped item's fields — must be passed through `meta`, never interpolated into the message string.** The message holds only static text plus the field *name* and counts (e.g. message `"widened response enum"`, meta `{ context, field: 'deviceClass', value: 'rmmnetworkdevice', count: 3, total: 848 }`); a `value` that happened to be a UDF then hits the masker. This keeps the "single logger boundary / no call site can leak a raw UDF value" guarantee literally true. (`deviceClass` is not a UDF, but the rule is enforced uniformly so no future diagnostic can leak one.)
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
1. **Static limit table** `src/rate-limit/rate-limits.ts`: exported const map of write `opKey`→limit seeded from the observed `system/request_rate` contract. **Enumerate every concrete write `opKey` that any resource method (Phases 7–8) actually calls as an explicit key** — the `WriteOpKey` union (below) is *closed*, so a write op with no table key is a compile error, and a prose bucket like "variable/proxy/warranty mutations" would leave those writes with no valid literal to pass. The complete key set (100 unless noted): `'device-udf-set': 600`, `'site-create': 100`, `'site-variable-set': 100`, `'account-variable-set': 100`, `'alert-resolve': 100`, `'alert-mute': 100`, `'alert-unmute': 100`, `'device-move': 100`, `'device-job-create': 100`, `'device-warranty-set': 100`, `'device-proxy-set': 100`, `'user-reset-keys': 100`, `'filter-create': 100`, `'filter-delete': 100` — plus any additional concrete write op a resource introduces (the rule below makes adding one gate on adding its key here first). Also export the scalars `READ_LIMIT = 600`, `WRITE_AGGREGATE_LIMIT = 600`, `WINDOW_SECONDS = 60`, and `DEFAULT_WRITE_LIMIT = 100`. Declare the map `as const` and **export the opKey set as a union type `export type WriteOpKey = keyof typeof WRITE_LIMITS`** so every resource write method (Phase 6/7) types its `opKey` parameter as `WriteOpKey`. A mistyped or unlisted opKey is then a **compile error**, not a silent mis-throttle (e.g. a mistyped `device-udf-set` silently getting 100 instead of 600). The table remains the single binding between the limiter and every write call site — **adding a write method requires adding its `opKey` key here first.**
   - **`DEFAULT_WRITE_LIMIT` is a limiter-level *defensive* fallback only, never reachable via a typed resource call.** Because `WriteOpKey` is closed and covers every real write, no resource can pass an unlisted opKey; `DEFAULT_WRITE_LIMIT` is consulted solely at the limiter's untyped `acquire({ kind:'write', opKey?: string })` boundary (Step 2), which keeps `opKey` a plain `string` on purpose as a defence-in-depth guard for a hypothetical direct/untyped caller. It is therefore **not** a consumer-overridable config knob — `config.rateLimit` does **not** expose a `defaultWriteLimit` field (see Phase 3 Step 4, which drops it to avoid a dead knob per R14). The Phase 5 rate-limiter test still exercises this fallback through a direct untyped `acquire` call.
   - Files: `src/rate-limit/rate-limits.ts`
2. **Dual-layer limiter** `src/rate-limit/rate-limiter.ts`: a `MultiWindowRateLimiter` holding a read sliding window (600/60 s), an aggregate-write window (600/60 s), and a lazily-created per-opKey write window map. `acquire(descriptor: { kind: 'read' | 'write'; opKey?: string })` enforces the tightest applicable set: reads consult the read window; writes consult **both** the aggregate-write window **and** the op-key window (`opKey` limit from the table, else `DEFAULT_WRITE_LIMIT`). The descriptor's `opKey` is intentionally typed as a plain `string` here (not `WriteOpKey`): resource call sites are compile-checked against the closed `WriteOpKey` union (Phase 6 Step 1), while this untyped boundary keeps the `DEFAULT_WRITE_LIMIT` path as a defence-in-depth fallback for a hypothetical direct/untyped caller (the only path that reaches it). Preserve the old `SlidingWindowRateLimiter` semantics per window.
   - Files: `src/rate-limit/rate-limiter.ts`
3. **HTTP transport** `src/http/http-client.ts`: create the shared, interceptor-bearing axios instance directly (there is **no** `axios-mutator.ts` — see Phase 1 Step 3; the generated endpoints layer is unused). Set `baseURL = apiUrl`, `User-Agent` = default + `userAgentExtra`, JSON headers.
   - **Typed request descriptor (`declare module` augmentation, internal-only):** the limiter descriptor rides on the axios request config under a `rateDescriptor` property. Axios's `InternalAxiosRequestConfig`/`AxiosRequestConfig` do not declare it, so add a module augmentation **`src/http/axios-augment.d.ts`** — `declare module 'axios' { interface AxiosRequestConfig { rateDescriptor?: RateDescriptor } }` (and the internal variant) — so both the attach sites (`axios.get(url, { rateDescriptor })`, the `http*` primitives, `paginate`) and the interceptor read (`config.rateDescriptor`) pass `tsc --noEmit`. Without this the Phase 5-onward typecheck exit gates fail.
     - **This ambient augmentation must stay a private typecheck aid and must NOT be emitted into the published `dist/index.d.ts`.** A global `declare module 'axios'` that reaches the published types would pollute *every* downstream consumer's `AxiosRequestConfig` with `rateDescriptor` the moment they import both this package and axios — an internal build detail leaking into and silently widening a dependency's public surface (a package-quality-bar violation). To prevent it: keep `axios-augment.d.ts` in the **typecheck program** via `tsconfig.json` `include` (so `tsc --noEmit` sees it) but **do not `import` it from any `src/*.ts` value module in the `src/index.ts` entry graph** — `tsup dts:true` rolls declarations up by following the entry import graph, so an ambient file that nothing in that graph imports is never pulled into the rollup. Phase 8's exit gate asserts `dist/index.d.ts` contains no `declare module 'axios'` (below), turning this into a verified gate rather than a hope.
   - Request handling: (a) a request interceptor calls `limiter.acquire(descriptor)` before send using `config.rateDescriptor`; **when no descriptor is present it defaults to `{ kind: 'read' }`** (the safe, throttled default — an untagged request is never sent unthrottled and `acquire` is never called with `undefined`).
   - (b) a response-error path that maps `AxiosError`→`DattoApiError` (via `fromAxiosError`), reads `Retry-After` on **429** into `retryAfterMs` and backs off/retries within `retry.maxAttempts ?? DEFAULT_RETRY.maxAttempts`, with exponential backoff bounded by `retry.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs` and `retry.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs` (`DEFAULT_RETRY` imported from `src/defaults.ts`; port `fuze-api`'s exponential-backoff retry interceptor, adding the 429 `Retry-After` branch). **`Retry-After` parsing handles both RFC forms:** delta-seconds (`Number(header)` → ms) **and** the HTTP-date form (`Date.parse(header) - Date.now()`, floored at 0); an unparseable header falls back to computed backoff. This honors the server's explicit instruction in either form (R12). **The honored wait is bounded by `MAX_RETRY_AFTER_MS` (30 s, from `defaults.ts`):** a large delta-seconds (`Retry-After: 86400`) or a far-future HTTP-date would otherwise `sleep()` for hours inside the retry loop — a hang on a malformed or hostile header. When the parsed wait exceeds `MAX_RETRY_AFTER_MS`, the client does **not** sleep; it throws `DattoApiError` (`statusCode:429`, `retryAfterMs` populated with the parsed value) so the caller decides, rather than blocking indefinitely.
   - (c) throws immediately on **403** with **no** retry (Non-Goal: no auto-recovery), **always attaching the raw `response` body/headers** so a consumer can disambiguate. Because Datto returns 403 for **both** a rate-limit IP-block penalty **and** ordinary authorization failures (insufficient scope, revoked credentials), the status alone does not distinguish them: classify `code:'ip-block'` **only** when the 403 carries a rate/block indicator, otherwise `code:'forbidden'`. This test lives in a **named, exported predicate `isRateLimitBlock(response): boolean` in `src/http/http-client.ts`** (one documented, unit-tested source consumed by the error path — never inlined at the 403 site): it returns true when the 403 carries a `Retry-After` header or a rate-limit/block message in the body. Both codes are surfaced without retry. Confirming Datto's real IP-block 403 marker against a live block is Deferred Validation.
   - Files: `src/http/http-client.ts`, `src/http/axios-augment.d.ts`
4. **Auth** `src/auth/auth-manager.ts` + `src/auth/token-store.ts`: port `InMemoryTokenStore` (unchanged behavior, R10) and refactor `AuthManager` to **throw** on failure instead of returning `Result`. OAuth2 password grant to `{apiUrl}/auth/oauth/token`, HTTP basic `public-client:public`.
   - **Transport isolation (critical):** the token round-trip is **not** a v2 endpoint and must **not** carry a Bearer header, consume the v2 read rate-limit window, or run through the 429/403 retry+classification path. `AuthManager` therefore issues its grant/refresh POST through a **separate, bare axios instance** it constructs itself (or `axios.post` with an explicit config) that has **none** of the shared instance's request/response interceptors (no `rateDescriptor`/`limiter.acquire`, no `Authorization: Bearer`, no v2 error mapping). Only the shared, interceptor-bearing instance from Step 3 gets the Bearer/rate-limit/retry stack. State this boundary so the token call cannot consume the API budget or attach v2 auth.
     - **AuthManager maps its own transport failures (the auth path has no mapping interceptor).** Because the bare instance deliberately omits the shared response-error interceptor, a failed grant/refresh would otherwise propagate a raw `AxiosError`. `AuthManager` therefore wraps its own grant/refresh call in a `try/catch` and rethrows **`DattoApiError.fromAxiosError(err)`** (the same construction path Step 3's error handler uses), so a failed grant surfaces as a `DattoApiError` — the single defined source the Phase 5 "a failed grant throws `DattoApiError`" test asserts against. This is the one error-mapping site on the auth path; there is no other.
   - Proactive refresh: refresh when the remaining lifetime is below `tokenRefreshPct` of the original TTL, replacing the old fixed 60 s window. **Default `tokenRefreshPct = 25`** (refresh once <25% of the original TTL remains) when the config omits it — this exact number is the constant the auth-manager test asserts against, so refresh timing is deterministic across implementors. Import `DEFAULT_TOKEN_REFRESH_PCT = 25` from `src/defaults.ts` (the same single source the config default reads). Expose the token via a request interceptor on the **shared** instance that sets `Authorization: Bearer <token>` on outgoing v2 requests.
   - Files: `src/auth/auth-manager.ts`, `src/auth/token-store.ts`

### Opinionated Implementation Notes (Examples)
```ts
// descriptor threading: BaseResource primitives attach this to the axios config; the
// request interceptor reads it and awaits the limiter before the call goes out.
export interface RateDescriptor { kind: 'read' | 'write'; opKey?: string }

// 429 handling in the error path (inside the retry logic):
const status = error.response?.status;
if (status === 429) {
  const raw = error.response?.headers?.['retry-after'];
  const seconds = Number(raw);                       // delta-seconds form
  const dateMs = Number.isNaN(seconds) ? Date.parse(raw) - Date.now() : NaN; // HTTP-date form
  const waitMs = Number.isFinite(seconds) ? seconds * 1000
               : Number.isFinite(dateMs) ? Math.max(0, dateMs)
               : backoff(attempt);                   // unparseable ⇒ computed backoff
  if (waitMs > MAX_RETRY_AFTER_MS) {                  // don't sleep for hours on a hostile/large header
    throw new DattoApiError('Rate limited', { statusCode: 429, retryAfterMs: waitMs, response: error.response?.data, cause: error });
  }
  await sleep(waitMs); /* retry within maxAttempts */
}
if (status === 403) {
  // Datto returns 403 for BOTH a rate-limit IP-block penalty AND ordinary authorization
  // failures; distinguish by a rate/block marker, always surface the raw body, never retry.
  const code = isRateLimitBlock(error.response) ? 'ip-block' : 'forbidden';
  throw new DattoApiError(code === 'ip-block' ? 'IP block' : 'Forbidden',
    { statusCode: 403, code, response: error.response?.data, cause: error });
}
```

### Tests (in this phase, all via `nock` — no live calls)
- `tests/unit/rate-limit/rate-limiter.test.ts`: a burst of 101 `alert-resolve` writes trips the per-op 100 window while a burst of `device-udf-set` up to 600 does not; reads and writes are counted in separate windows; an unlisted write opKey falls back to 100.
- `tests/unit/http/http-client.test.ts` (nock): a 429 with `Retry-After: 1` (delta-seconds) is honored (retried after the delay, `retryAfterMs` populated); **a 429 with `Retry-After` as an HTTP-date (e.g. a timestamp ~1 s in the future) is also honored** (parsed via `Date.parse`), an unparseable `Retry-After` falls back to computed backoff, and **an over-large `Retry-After` (e.g. `86400`) exceeding `MAX_RETRY_AFTER_MS` throws `DattoApiError` with `retryAfterMs` populated instead of sleeping** (guards the unbounded-wait hang); a 403 **with** a rate/block marker throws `DattoApiError` with `code:'ip-block'` and a 403 **without** one throws with `code:'forbidden'` — both carry the raw `response` body and neither is retried; a 5xx retries exactly `DEFAULT_RETRY.maxAttempts` times (asserted against the imported constant, not a magic number) with backoff bounded by `DEFAULT_RETRY.baseDelayMs`/`maxDelayMs`; a 2xx returns the body. A config with an explicit `retry.maxAttempts` override is honored over the default.
- `tests/unit/auth/auth-manager.test.ts` (nock): password-grant token is cached and reused; with `tokenRefreshPct` unset, a token whose remaining lifetime has fallen below the pinned 25% default (`DEFAULT_TOKEN_REFRESH_PCT`) triggers a proactive refresh while a token above it does not; a failed grant throws `DattoApiError`.

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
Provide the validated HTTP primitives every resource extends (`httpGet`/`httpPost`/`httpPatch`/`httpDelete` — renamed from fuze-api's `get`/`post`/`patch`/`deleteRequest` to avoid colliding with public resource methods like `devices.get`, `validateRequest`/`validateResponse`/`validateArrayResponse`) plus a `paginate` helper that walks `pageDetails.nextPageUrl` — validating each page's named array leniently and each page's cursor **strictly** against a dedicated `pageDetails` override (a missing/malformed cursor **throws**; a `null` `nextPageUrl` is the normal terminal). Add the hand-maintained `src/schema-overrides/` module that reconciles UDFs, alert context, the pagination cursor, and required-field marks for the write set.

**Requirements:** R3, R6, R8

### Steps
1. **BaseResource** `src/client/resources/base-resource.ts`: port from `fuze-api`, rename error type to `DattoValidationError`, thread the injected (masked) `DattoLogger` and **the single shared, interceptor-bearing axios instance built in Phase 5** (there is exactly one axios instance in the client; the generated endpoints layer is unused/uncommitted, so every request BaseResource makes goes through the auth/rate-limit/retry stack — nothing bypasses it). Keep `coerceSchema`, `validateRequest` (strict, throws), `validateResponse` (lenient via `parseLenient`, throws), `validateArrayResponse` (per-item drop). **`validateArrayResponse` aggregates drops per call:** it accumulates every dropped item's index + zod error for the whole array and emits **one** `warn summary at the end (e.g. message `"dropped invalid items"`, meta `{ context, dropped: 50, total: 848, firstErrors: [...] }` capped at the first K errors) — **not** one `warn` line per dropped row. This bounds a systematic drift (one required field mistyped across a page dropping every item) to a single `warn` and keeps the deep-walk UDF masker off the per-row hot path, exactly as the strip/widen aggregation does (Phase 4 Step 3). Per R20, the dropped items' fields ride in `meta` (masked), never in the message string; the summary preserves visibility (a drop is real data loss) while capping volume. **Rename the protected HTTP primitives** to `httpGet`/`httpPost`/`httpPatch`/`httpDelete` (fuze-api's are `get`/`post`/`patch`/`deleteRequest`) so a resource subclass can expose a public `get(uid)`/`resolve(uid)`/etc. without shadowing a base method — a resource method reusing a primitive name (`get`) would redeclare it with an incompatible signature (TS2416) and its body would recurse into itself. Each primitive attaches a `RateDescriptor` to the axios config: `httpGet` → `{kind:'read'}`, and `httpPost/httpPatch/httpDelete` accept an **`opKey: WriteOpKey`** argument (the union exported from `rate-limits.ts`, so a bad opKey is a compile error) → `{kind:'write', opKey}`. **Rule:** resource classes call only the `http*` primitives, never a same-named method.
   - Files: `src/client/resources/base-resource.ts`
2. **`paginate` helper** on `BaseResource` with the signature `paginate(startPath, arrayKey, itemSchema, params?, context?)` (this exact parameter order — matching the example below): given the start path, the page's named-array key, the item schema, and optional params, walk `pageDetails.nextPageUrl` accumulating items. `paginate` calls the shared axios instance directly (not `httpGet`) because it reads the `{pageDetails, <array>}` envelope rather than a single validated schema; it therefore **must itself attach an explicit `{ kind: 'read' }` `RateDescriptor`** on each page's axios config (via the same `rateDescriptor` property the `http*` primitives use) so every paginated page consumes the read window — this is the single highest-volume read path (`account.devices()` and every list), and it must not bypass the limiter. Per page: validate the **cursor** with the strict `pageDetailsSchema` override (`.safeParse`; on failure **throw** `DattoValidationError('response')` — this is the R3 hard-fail, never a silent truncation) and validate the named array with `validateArrayResponse` (lenient, per-item drop). `null` `nextPageUrl` ends the walk normally. Leniency governs item payloads, never the walk cursor.
   - Files: `src/client/resources/base-resource.ts`
3. **Schema-override module** `src/schema-overrides/index.ts` (+ split files as needed): named to match the design (`src/schema-overrides.ts`, R8); this repo splits it into a directory for readability. It overrides the **generated zod schemas** (not the OpenAPI spec) — do not confuse it with Phase 2's `scripts/patch-spec.mjs`, which corrects the spec *before* generation; this module reconciles the *already-generated* schemas *after* generation. It lives outside `src/generated/`, imports generated zod schemas, and exports the reconciled forms resources use:
   - `udfSchema = z.record(z.string().regex(/^udf\d+$/), z.union([z.string(), z.number(), z.boolean(), z.record(z.string(), z.unknown()), z.array(z.unknown())]).nullable())` — the `udf1…udf300` record (clearer than 300 literal keys), with the value typed to **tolerate non-string UDFs**. UDF values are *not* guaranteed to be strings in reality (the Phase-3 mask decorator deliberately redacts numeric/object/array UDF values "regardless of wire type"); typing the value as `z.string().nullable()` would make a real non-string UDF fail per-item validation and **drop the whole device** — exactly the silent-data-loss class the design condemns. The two sites now agree: UDFs may be non-string, so both the schema and the masker accept that. The `Device` response schema is re-composed to use this `udfSchema`.
   - `alertContextSchema` — a permissive `@class`-tagged open object (`z.object({ '@class': z.string() }).catchall(z.unknown())` or `z.looseObject`), matching the Phase-2 spec patch.
   - `pageDetailsSchema` — the R3 cursor override: **strict on required fields/types but tolerant of extra keys** — `z.object({ count: z.number().int(), totalCount: z.number().int(), prevPageUrl: z.string().nullable(), nextPageUrl: z.string().nullable() }).catchall(z.unknown())`. Use plain `z.object(...).catchall(z.unknown())`, **not** `z.strictObject`: a failed parse **throws** and aborts the whole walk (Step 2), so rejecting an *unknown* key would hard-fail every paginated call across every namespace the moment Datto adds a benign envelope field (e.g. `pageSize`) — an added field is neither "missing" nor "malformed" (R3's actual triggers) and this would contradict the design's response-leniency philosophy. The throw is reserved for a missing/mistyped `count`/`totalCount`/`prevPageUrl`/`nextPageUrl`, never for an unknown key.
   - **Required-field marks** for the small write set (spec declares almost no `required`, so `.strict()` alone would accept an empty `device-move`/`udf-set` body): wrap each generated write-body schema marking the genuinely required fields, hand-verified against the endpoint docs, in this one place (R6).
   - **Reconciled entity types are the single source of truth (R4/R5 alignment):** for every entity this module reconciles (`Device`, `Alert`, and any other override-touched schema), the public TypeScript type is derived **primarily from the override schema's `z.infer`** (which carries the reconciled `udfSchema` record and the open `@class` `alertContext`) — *not* the raw generated type, whose pre-reconciliation shape (literal `udf1…udf300` props, generated `alertContext`) does **not** match what the resources validate and return.
     - **The open-enum widening must be grafted on explicitly — `z.infer` alone does not carry it.** The R5 `(string & {})` open-enum widening is a **TS-type-only** transform the Phase 2 codemod applies to `src/generated/types/**`; it has no runtime/zod representation, so `z.infer` of a composed override schema does **not** inherit it. Composing the generated zod enum yields either a **closed** union (a novel value fails to type-check — reintroducing the exact "compile-time claims an exhaustiveness the runtime relaxes" hazard R5 exists to kill) or, via `.or(z.string())`, a **collapsed plain `string`** (losing the literal members). Neither is the R5 shape. Therefore define each reconciled entity type as an **intersection that takes the enum fields from the codemod-widened generated type and everything else from `z.infer<override>`**: for a documented per-entity list of open-enum fields `ENUM_FIELDS` (e.g. `Device.deviceClass`; `Alert` fields as applicable), `export type Device = Omit<z.infer<typeof deviceResponseSchema>, 'deviceClass'> & Pick<GeneratedDevice, 'deviceClass'>` where `GeneratedDevice` is imported from `src/generated/types` (the codemod-widened `deviceClass: … | (string & {})`). This makes the exported compile-time type carry the reconciled fields **and** the open-enum widening, matching what `parseLenient`'s runtime enum degradation (Phase 4) accepts. The per-entity `ENUM_FIELDS` list is a documented constant in `types.ts`; Phase 9's enum-alignment test (using a **truly novel** value, not an existing member) guards that the graft and the runtime widening cover the same field set.
     - Resource method signatures (Phase 7/8) and the public barrel (Phase 8) use these exported types so the exported type faithfully describes the runtime value. Generated types are still used directly (verbatim) for entities the override module does **not** touch — those already carry the codemod-widened open enums.
   - Files: `src/schema-overrides/index.ts` (+ e.g. `device-overrides.ts`, `alert-overrides.ts`, `pagination.ts`, `write-bodies.ts`, `types.ts` for the reconciled entity types — the `z.infer` base intersected with the codemod-widened generated enum fields per `ENUM_FIELDS`)

### Opinionated Implementation Notes (Examples)
```ts
// strict pagination cursor — throws on malformed, terminates on null nextPageUrl
protected async paginate<T>(startPath: string, arrayKey: string, itemSchema: z.ZodType<T>,
                            params?: Record<string, unknown>, context?: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = startPath;
  let p = params;
  while (url) {
    // attach an explicit read RateDescriptor so each page consumes the read window
    const { data } = await this.axios.get(url, { params: p, rateDescriptor: { kind: 'read' } });
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
- `tests/unit/client/base-resource.test.ts` (nock): `validateRequest` throws `DattoValidationError('request')` on an unknown key / missing required write field; `validateResponse` strips unknowns and returns; `validateArrayResponse` drops one bad item and keeps the rest, emitting **exactly one** aggregated `warn` (assert the `warn` sink is called once with `meta` carrying `dropped`/`total`, not once per dropped item); **an array where every item is invalid still produces a single `warn` summary** (bounds the systematic-drift flood) and the dropped fields ride in `meta` (masked), not the message string.
- `tests/unit/client/paginate.test.ts` (nock): a two-page walk concatenates items and stops on `nextPageUrl:null`; a page missing `pageDetails` (or with a non-string `nextPageUrl`) **throws** `DattoValidationError` rather than truncating; a lenient item on page 2 is dropped without aborting the walk; **the walk consumes the read rate-limit window once per page** (assert `limiter.acquire` is called with `{ kind: 'read' }` for each page fetched — guards against the paginate path going out untagged/unthrottled).
- `tests/unit/schema-overrides/*.test.ts`: `udfSchema` accepts `udf1…udf300` including **null and non-string values** (a numeric/object udf validates, not just strings) and rejects a non-`udf` key; `pageDetailsSchema` **rejects a missing/mistyped `count` (throws-path) but accepts an unknown extra key** (e.g. `pageSize` — proving a benign added envelope field does not abort the walk); a write-body override rejects an empty body.

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
import type { Device } from '@/schema-overrides/types'; // reconciled type (z.infer base + widened generated enum graft), NOT the raw generated Device
export class DeviceResource extends BaseResource {
  // Public `get` is safe: the base HTTP primitive is `httpGet`, so no shadowing / recursion.
  // Return type is the reconciled `Device` (udf record + open alertContext), matching what the schema validates.
  get(uid: string): Promise<Device> {
    return this.httpGet(`/api/v2/device/${uid}`, deviceResponseSchema, 'GET /device/{uid}');
  }
  setUdf(uid: string, udf: DeviceUdfInput): Promise<void> {
    return this.httpPost(`/api/v2/device/${uid}/udf`, udf, udfWriteBodySchema, z.void(),
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
7. **New public barrel** `src/index.ts`: export `createDattoRmmClient`, `DattoRmmClient`, `DattoRmmClientConfig` + `DattoLogger` types, and the error classes (`DattoApiError`, `DattoValidationError`, `BaseError`). Remove the old `result`/`schemas` exports.
   - **Do not `export * from './generated/types'`.** That would (a) publish the raw generated `Device`/`Alert` types whose shape does **not** match the reconciled runtime value the resources return (architect-r1-f1 — udf record vs literal props, open `alertContext`), and (b) dump the entire regeneration-volatile generated surface — ~30 dead `*Context` schemas, every `*Body`/`*Params`/`*Query` type, internal envelope DTOs — as public API, so any spec/Orval rename becomes a silent breaking change with no diff-gate (architect-r1-f2), contradicting R19's clean break.
   - Instead route all public types through a **hand-maintained `src/public-types.ts`** curated re-export list: the reconciled entity types from `src/schema-overrides/types.ts` (`Device`, `Alert`, …, the `z.infer` single source of truth), the write-body **input** types consumers pass, and only the response DTOs consumers actually need — re-exported by name from `src/generated/types` for entities the override module does not touch. `src/index.ts` re-exports from `public-types.ts`. A regeneration that removes or renames a curated name then fails the Phase 8 `surface.test.ts` (below) rather than silently changing the surface.
   - Files: `src/index.ts`, `src/public-types.ts`
8. **Delete the old surface in this commit:** `src/client.ts`, `src/config.ts`, `src/logger.ts`, `src/result.ts`, `src/validation.ts`, `src/schemas.ts`, `src/httpClient.ts`, `src/auth.ts`, `src/rateLimiter.ts`, `src/tokenStore.ts`, `src/internal/`, and the four old `src/__tests__/*.test.ts` (their behavior is superseded by the new resource/validation tests). **Move the retained real capture fixtures `src/__tests__/fixtures/*.json` → `tests/fixtures/` (updating any references) so there is one fixture home**, then remove the now-empty `src/__tests__/` directory — Phase 9's synthesized fixtures live in `tests/fixtures/` too, so the real and synthetic corpora sit together rather than split across two trees.
   - Files: five resource files, `src/client/datto-rmm-client.ts`, `src/index.ts`, `tests/fixtures/*.json` (moved), plus deletions above.

### Opinionated Implementation Notes (Examples)
```ts
// src/index.ts (new surface)
export { createDattoRmmClient, DattoRmmClient } from './client/datto-rmm-client';
export type { DattoRmmClientConfig } from './client/datto-client-config';
export type { DattoLogger } from './logging/logger';
export { BaseError, DattoApiError, DattoValidationError } from './errors';
export * from './public-types'; // curated list — NOT `export * from './generated/types'`

// src/public-types.ts (hand-maintained, curated)
export type { Device, Alert /* …reconciled entities */ } from './schema-overrides/types'; // z.infer single source
export type { DeviceUdfInput /* …write-body inputs */ } from './schema-overrides/write-bodies';
// plus by-name response DTOs from ./generated/types for entities the override module does not touch
```

### Tests (in this phase, nock)
- One test file per new resource (as in Phase 7).
- `tests/unit/client/surface.test.ts`: all ten namespaces exist on a constructed client; `createDattoRmmClient` throws `DattoValidationError` on invalid config; the retired names (`getAccountDevices`, `getDeviceByUid`, `updateDeviceUdfs`, `Result`, `ProblemError`) are **not** exported (import assertions / type-level check); **the barrel does not re-export the raw generated type surface** (assert a known generated-only name — e.g. a dead `*Context` type or a `*Body`/`*Params` type — is absent from `src/index.ts`'s exports), and each name on the curated `public-types.ts` list resolves (a regeneration that renames/drops a curated response DTO fails here rather than silently changing the `1.0.0` surface).
- `tests/unit/client/coverage-map.test.ts`: derive the **authoritative** operation inventory from the committed `spec/openapi.json` (enumerate every `paths[path][method]`, keyed by `operationId` or `method+path`), and assert that a maintained `client.<ns>.<method>` → `{ method, path }` mapping table (declared in the test or a small committed `src/client/operation-map.ts`) covers **every** spec operation exactly once — no spec operation unmapped, no duplicate/omission slipping past a raw total. A bare count is insufficient because it passes when a namespace duplicates one operation and omits another. This is the real R1 guard; the coverage table is updated whenever the spec is refreshed. **The map must be verified against the actual resource implementations, not trusted on its own:** for each mapped `{ ns, method, path, verb }`, drive the constructed client's `client[ns][method](…sample args)` under a **nock intercept scoped to that exact `verb` + path pattern** and assert the intercept is hit — so a resource whose hand-written path/verb drifts from the map (or is missing) fails the guard, closing the gap where a correct map masks a wrong implementation. Path params are filled with placeholder ids; the assertion is on the request line reaching nock, not on response shape.
  - **Body-carrying write ops require a minimal valid sample body, not just placeholder path ids.** Write methods that send a validated body run strict `validateRequest`/the required-field write-body override (Phase 6) **before** the request is sent, so an empty/placeholder body would throw `DattoValidationError` and **the request would never reach nock** — making the intercept assertion impossible to satisfy and silently leaving that write unverified. The coverage map therefore carries, for **each write op that declares a request-body override**, a **minimal valid sample body** (a small factory keyed by the op's `opKey` or path, one entry per body-carrying write op) that satisfies that op's write-body override so `validateRequest` passes and the request reaches nock.
    - **Bodiless writes are explicitly exempt.** Several enumerated writes have **no request body and no write-body override** and mutate via path/verb alone: `filter-delete` is a `DELETE` (`httpDelete` carries an `opKey` but sends no validated body), and the bodiless-POST writes (`alert-resolve`, `alert-mute`, `alert-unmute`, `user-reset-keys`, `device-move` if it takes no body) run **no** `validateRequest`. For these the sample-body factory has **no entry**, and the coverage test drives them to the nock intercept with placeholder **path params only**. The "fail if a write op lacks a sample body" rule applies **only** to ops that declare a write-body override; a bodiless write missing a sample body is **not** a failure (the factory intentionally has no entry for it). So all writes — body-carrying and bodiless — are covered by the same intercept-hit guarantee as reads, and the guard covers all 75 operations, reads and writes alike.

### Documentation (if needed)
- None yet (README is Phase 10) — but keep JSDoc on each public method.

### Exit Gate
```bash
npm run lint
npm run typecheck
npm test
npm run build
! git grep -qn "Result<" -- src/            # Result contract fully removed
! git grep -qn "validationMode" -- src/     # three-mode config fully removed
for f in src/client.ts src/config.ts src/logger.ts src/result.ts src/validation.ts \
         src/schemas.ts src/httpClient.ts src/auth.ts src/rateLimiter.ts src/tokenStore.ts; do \
  test ! -e "$f" || { echo "old surface still present: $f"; exit 1; }; done
test ! -d src/internal
test ! -d src/__tests__                     # fixtures moved to tests/fixtures/, old test dir removed
! grep -qn "export \* from './generated/types'" src/index.ts src/public-types.ts  # curated public types only
! grep -qn "declare module 'axios'" dist/index.d.ts   # internal rateDescriptor augmentation NOT leaked to published types (architect-r2-f9)
```

---

## Phase 9: Fixtures, sanitization, and reconciled-schema validation

### Goal
Prove the generated + reconciled schemas validate against realistic captured shapes exercising every leniency path (nullability, unknown keys, per-item drop, open enums, epoch-ms timestamps, `udf1…udf300`, `@class` alert contexts), and provide a deterministic sanitization step so a maintainer capturing real sweep data commits a scrubbed fixture (all `udf*` redacted) rather than raw output.

**Requirements:** R17, R5, R7, R8, R20, R1

### Steps
1. **Synthesized-plus-real fixtures** under `tests/fixtures/`: keep/extend the real `device*.json` captures **moved here in Phase 8** (there is now one fixture home, `tests/fixtures/` — `src/__tests__/` was removed); add per-namespace fixtures that deliberately encode the design's observed reality — a device with `udf300` **set to a clearly-synthetic marker** (`SYNTHETIC-UDF-300`, a fixed low-entropy value that reads as obviously fabricated test data) and many nulls and `deviceClass:'rmmnetworkdevice'`; an alert with each `@class` context (`comp_script_ctx`, `eventlog_ctx`, `patch_ctx`, `antivirus_ctx`, `online_offline_status_ctx`, `perf_resource_usage_ctx`); a paged collection with a malformed item to drop; timestamps as epoch-ms integers. **No real secrets** in any committed fixture; synthetic `udf*` values use the `SYNTHETIC-UDF-<n>` form so a reviewer can see at a glance the fixture carries fabricated, not captured, data.
   - Files: `tests/fixtures/**`
2. **Sanitization script** `scripts/sanitize-fixtures.mjs`: given a raw sweep file, redact every `udf*` field to `null` (and any other value under a fixed, documented set of secret-bearing keys) while preserving type/nullability shape, emitting a commit-safe fixture. Deterministic and **key-based** (no content/"is-this-a-secret" heuristics — it redacts by field name, so it is complete and predictable for the fields it covers). This is the at-rest protection: a maintainer capturing real device data runs it **before** committing, and the README/`docs/` maintainer runbook documents that step. It is not run in CI against live data (CI has none).
   - Files: `scripts/sanitize-fixtures.mjs`
   - **No automated secret *detector*/scanner.** We deliberately do **not** ship a content-based secret-scanning gate over `spec/` or the fixture roots. An abstract "does this value look like a secret" heuristic is not reliably achievable — it false-positives on the committed OpenAPI document's prose and OAuth structural keys and false-negatives on novel secret shapes, so a content-scanning gate would add churn and false alarms without a dependable guarantee. The at-rest guarantee rests instead on: (a) the deterministic key-based sanitizer above, (b) commit-time human review of any added real capture, and (c) the fact that the currently committed `src/__tests__/fixtures/*.json` hold only benign `udf1:"value1"`/`"value2"` values. Runtime protection is unchanged: UDF log masking (R20) keeps UDF values out of all log output.
3. **Fixture-validation tests** `tests/integration/fixtures.test.ts`: parse each fixture through its reconciled schema via the resource/`parseLenient` path and assert:
   - Every fixture validates (leniency tolerates nulls/unknowns) (R5, R8, R17).
   - The malformed collection item is dropped, the rest survive (R7).
   - The `rmmnetworkdevice`/novel-enum fixture both **type-checks** against the reconciled, override-derived response type **and** survives `parseLenient` without being dropped — asserting the build-time and runtime enum widening cover the same field set (Success Criteria, R5). The compile-time assertion must use a **truly novel** value (`'quantumdevice'`, not the already-declared `'rmmnetworkdevice'` member) against `Device['deviceClass']`, so it fails if the open-enum graft (Phase 6 Step 3) is missing from the override-derived type rather than passing trivially on an existing member.
   - Logging any UDF-bearing fixture through the client's masked logger never emits the raw value to the sink (R20).

### Opinionated Implementation Notes (Examples)
```ts
// enum-alignment assertion (compile-time + runtime in one test)
const wire = loadFixture('device-rmmnetworkdevice.json');
const parsed = deviceResponseSchema /* via parseLenient */;
// TRULY NOVEL value (not the declared 'rmmnetworkdevice' member): only type-checks if the
// override-derived Device type carries the codemod-widened `(string & {})` graft (Phase 6 Step 3).
const dc: Device['deviceClass'] = 'quantumdevice';
expect(() => validateResponse(wire)).not.toThrow();
expect(validateResponse(wire).deviceClass).toBe('rmmnetworkdevice'); // not dropped
```

### Tests (in this phase)
- `tests/integration/fixtures.test.ts` (above).
- `tests/unit/scripts/sanitize-fixtures.test.ts`: sanitizing a raw sample redacts every `udf*` (and other configured secret-bearing keys) to `null` while preserving the full key set and the original null positions — i.e. the output has the same shape as the input with only the covered fields nulled.

### Documentation (if needed)
- None yet.

### Exit Gate
```bash
npm run lint
npm run typecheck
npm test
```
- `npm test` covers the fixture-validation suite (every fixture validates leniently, the malformed item is dropped, enum widening aligns compile-time and runtime, and UDF-bearing fixtures never emit a raw value through the masked logger) and the sanitizer unit test (real-sweep `udf*` fields are redacted to `null` with shape preserved). There is no secret-scan step: the at-rest protection is the deterministic key-based sanitizer plus commit-time review (see Step 2), not an automated content detector.

---

## Phase 10: README, upgrade guide, and 1.0.0 release prep

### Goal
Ship the documentation the design mandates and prepare the breaking `1.0.0`: a comprehensive README covering install, auth, every namespace (with the explicit namespace→endpoint map), error handling, logger injection + masking, validation leniency, and rate-limit config, plus the `0.1.x → 1.0.0` upgrade path; bump the version and verify the publish shape.

**Requirements:** R18, R16, R19

### Steps
1. **Rewrite `README.md`** (R18): install (ESM, Node ≥ 20); auth setup (`createDattoRmmClient` with `apiUrl`/`apiKey`/`apiSecret`); a **namespace→endpoint map** table making the `account.devices()` (list) vs `devices.get(uid)` (single/mutate) split explicit across all ten namespaces; error handling (`try/catch` on `DattoApiError`/`DattoValidationError`, the `retryAfterMs` field, and the 403 `code` field — noting a 403 may be a rate-limit `ip-block` **or** an ordinary `forbidden` authorization failure, both surfaced without retry with the raw `response` body attached so consumers can disambiguate); logger injection (the `DattoLogger` shape) and the UDF-masking guarantee ("no UDF value in cleartext"; note non-UDF fields like `variables`/`Site.notes` are the consumer's responsibility — a Non-Goal); validation leniency (response-lenient/open-enum, request-strict) and the caller's obligation to handle an unknown enum value; rate-limit config and `system.requestRate()`; and the `alertContext` `@class` discriminator with observed shapes.
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
test -f dist/index.js && test -f dist/index.d.ts    # publishable ESM + types emitted
```
- `README.md` contains the namespace→endpoint map (all ten namespaces), the error-handling section, the logger/masking section, the leniency section, the rate-limit section, and the `0.1.x → 1.0.0` upgrade guide (the `readme.test.ts` under `npm test` guards the namespace-map rows and the error/masking mentions).
- `dist/index.js` and `dist/index.d.ts` exist after `npm run build`.

---

## Deferred Validation (run after implementation is complete)
- **Live spec refresh & diff:** re-fetch `GET {apiUrl}/api/v3/api-docs/Datto-RMM` from a real region, overwrite `spec/openapi.json`, run `npm run generate`, and inspect `git diff spec/openapi-prev.json` and `src/generated/**` — confirms the patch step still covers upstream and that regeneration is clean. Requires egress to `*.centrastage.net`, so it cannot run unattended in CI.
- **Real captured-response validation (R17):** against a live Datto account, run a read-only sweep (devices, sites, users, alerts, audits), sanitize it with `scripts/sanitize-fixtures.mjs`, and confirm the reconciled schemas validate the real payloads with only expected leniency (widenings/strips) — grounds the synthesized fixtures against production. Needs live credentials and account data.
- **Printer/ESXi audit & proxy-settings shapes:** validate against a device population that actually includes printers/ESXi hosts and proxy settings (absent from the sampled account) — spec-derived-only until such hardware is available (design risk row).
- **Real 429/403 rate-limit behavior:** drive a real write burst past a per-operation ceiling to confirm the server's actual `Retry-After`/403 timing matches the modeled tiers, **and confirm the wire marker that distinguishes a rate-limit IP-block 403 from an authorization-failure 403** (header vs. body) so the `isRateLimitBlock(response)` predicate reflects Datto's real signal — requires a live account and risks a 5-minute IP-block, so it is deliberately not automated.
- **Published-package smoke test:** `npm pack` the `1.0.0` tarball and install it into a scratch consumer project to confirm ESM import + types resolve as published — final human check before `npm publish`.
