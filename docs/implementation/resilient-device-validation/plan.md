# Plan: Resilient Device Validation

- **Plan ID:** resilient-device-validation
- **Design Document:** docs/implementation/resilient-device-validation/design.md
- **Repo Context Checked:** Explored the full `src/` tree of `datto-rmm-api-client` (ESM-only TS package, `"type": "module"`, zod imported as `zod/v4`). Read `src/client.ts` — confirmed `getAllPages<T, P>(url, token, params, schema, extractor)` validates the whole page via `validate(schema, res.value, this.validationMode)` inside a `try/catch`, and that `getAccountDevices` passes `DevicesPageSchema` + `(p) => p.devices ?? []`, while `getDeviceByUid` catches `ZodError` → `{ ok: false }` with no logging. Read `src/validation.ts` — the sole `validate<T>(schema, data, mode)` seam; `off` returns raw, `strict` throws `result.error`, `warn` calls `console.warn` directly (no logger param). Read `src/schemas.ts` — `DeviceSchema` (closed `z.object`, required non-nullable `udf`/`antivirus`/`patchManagement`, closed `deviceClass`/`patchStatus`/`antivirusStatus` enums), `PaginationDataSchema` (exports `nextPageUrl: string | null`), `DevicesPageSchema = { pageDetails?, devices?: z.array(DeviceSchema) }`, all exported → public via the `src/index.ts` barrel (`export * from "./schemas.js"` and `"./client.js"`). Read `src/result.ts` — `Result<T>` already carries `warnings?: ProblemError[]` on the `ok: true` branch; `ProblemError` has `type/title/status/detail?/raw?` — no type change needed. Read `src/logger.ts` — `LoggerLike { debug/info/warn/error }`, `defaultLogger = console`. Read `src/config.ts` — `logger?` and `validationMode?` already present; client defaults `validationMode` to `"strict"`. Read `src/httpClient.ts` — `request<T>` returns `Result<T>` and is already given `config.logger ?? defaultLogger`. Examined tests in `src/__tests__/`: `deviceSchema.test.ts` calls `validate(DeviceSchema, device, "strict")` (3-arg — must keep compiling), `devicesMethod.test.ts` uses a `MockAxios` keyed by URL with fixtures under `src/__tests__/fixtures/` (`device.json`, `devicesPage.json`, `devicesPage1.json`, `devicesPage2.json`), `client.test.ts` is a smoke test. Checked `package.json` scripts — only `test` (jest), `build` (tsc), `format` (prettier); **no `lint` or `typecheck` script exists**. `jest.config.js` uses `ts-jest/presets/default-esm` (tests are type-checked at test time). `tsconfig.json` `strict: true`, excludes `src/__tests__` from the build so `npm run build` type-checks library code only.
- **External Research:** Confirmed against the Zod v4 docs (zod.dev) that `schema.safeParse(data)` returns a discriminated union whose `.error` is a `ZodError` exposing an `.issues` array, where each issue has `path` (array locating the failure) and `message`. This is the basis for building each rejected-device `ProblemError.detail` (`issues[0].path.join(".")`) with the full `ZodError` preserved in `raw`. `z.array(z.unknown())` and `z.infer` are stable v4 APIs used for the internal envelope schema.
- **Assumptions:**
  - The repo has **no** `lint`/`typecheck` npm scripts; the authoritative unattended verification is `npm run build` (tsc, library code) + `npm test` (jest/ts-jest, includes test type-checking). Exit gates use exactly these.
  - The `warnings[]` channel on `Result<T>`'s `ok: true` branch and the `ProblemError` shape are sufficient to carry rejected devices — no `result.ts` change is required (matches design).
  - The internal envelope schema must **not** be exported from `src/index.ts`; defining it as a non-`export` const inside `src/client.ts` keeps it off the public surface (the barrel re-exports only `export`ed members), satisfying R4.
  - Test payloads can be built by cloning the existing `device.json` fixture and mutating it (e.g. an out-of-enum `deviceClass`) rather than adding many new fixture files; this keeps fixtures maintainable and is consistent with the existing fixture-driven tests.
- **Quality Bar:** Extensibility and best practices prioritized. Backwards compatibility not prioritized unless explicitly stated. (The design *does* explicitly require preserving the public type surface and the `warn`/`off` returned-data contracts — those are honored as stated requirements, not general back-compat.)

---

## Summary
- **Executive Summary:** Today a single device whose shape drifts from the client's strict schema fails the *entire* `getAccountDevices()` call for an account — a real, standing daily-sync outage. This change makes device validation resilient: in `strict` mode the client returns every device that conforms and reports each divergent device as a structured warning (identifying the device and the field that diverged) routed through the consumer's own logger at error level, instead of failing wholesale. A truly malformed page (a response that isn't a devices page at all) still fails hard, because that is a protocol error rather than device drift. The public `Device` type and all schemas are left exactly as they are — divergence is treated as a signal that a maintainer must reconcile the schema with upstream Datto RMM, not as a reason to loosen it.
- **Goals:**
  - One divergent device never blocks retrieval of the account's other devices (R1).
  - Rejected devices are returned as structured `warnings[]` naming the device and the failing field path (R2).
  - Validation failures reach the consumer's configured logger at error level (R3, R6, R7).
  - Envelope (protocol) errors remain hard failures in `strict`/`warn`, and are not run in `off` (R5, R8).
  - The public `Device` type, `DeviceSchema`, and all exports are unchanged (R4).
- **Non-Goals:**
  - Relaxing `DeviceSchema` (no fields made optional/nullable, no enums widened, no `.catch()` fallbacks).
  - Changing any exported type, including `Device`, `Result`, `ProblemError`, `DevicesPageSchema`.
  - Partial results for `getDeviceByUid()` (single device: no subset to salvage — stays fail-hard).
  - Introducing a new validation mode or config flag.

---

## Implementation Notes for the Implementor(s)
- Implement **one phase at a time**; run the phase exit gate before moving on.
- Verification commands for this repo are `npm run build` and `npm test`. There is **no** `npm run lint` or `npm run typecheck` — do not invent them.
- **Do not** modify `src/schemas.ts` `DeviceSchema` / `PaginationDataSchema` / `DevicesPageSchema` shapes, or `src/result.ts`, or any exported type. `DevicesPageSchema` stays exported and unchanged even though the pagination path stops using it.
- **Do not** export the new internal envelope schema from `src/index.ts` — keep it a non-`export` const in `src/client.ts`.
- Preserve the `warn` and `off` **returned-data** contracts exactly: in `warn`, every device (valid or not) is returned **raw and unparsed** (never re-parsed, which would strip unknown keys); in `off`, nothing is validated or logged. The only behavioral break allowed is the envelope hard-fail in `warn` (design Decision 2 / Breaking Change #2).
- `validate()`'s new `logger` parameter is an **optional trailing** parameter defaulting to `defaultLogger`, so existing 3-arg calls (e.g. in `deviceSchema.test.ts`) keep compiling untouched.
- `validate()` must **not** log in `strict` mode — it throws, and the caller (`getDeviceByUid`) decides fatality and emits the error log. The per-item helper, which does not throw, owns its own error/warn logging.

---

## Phase 1: Logger-aware validation seam + per-item helper

### Goal
Turn the single validation module into the two primitives the resilient pagination path needs, with no client wiring yet: (1) a logger-aware `validate()` whose `warn` branch routes through a `LoggerLike` instead of `console`, and (2) a new `validateItems()` helper that validates an array element-by-element and partitions results by mode, returning surviving items plus per-device `ProblemError` rejections and emitting the correct log level per mode. This phase is self-contained and fully unit-testable without touching `client.ts`.

**Requirements:** R2, R3, R4, R6

### Steps
1. **Add a logger-aware `validate()` overload-compatible signature**: give `validate` an optional trailing `logger: LoggerLike = defaultLogger` and route the `warn` diagnostic through `logger.warn`. Leave `strict` (throw, no log) and `off` (raw passthrough) semantics exactly as they are.
   - Files: `src/validation.ts`
   - Notes: Import `defaultLogger` and `LoggerLike` from `./logger.js`. The default keeps `deviceSchema.test.ts`'s 3-arg call compiling. Do **not** log in `strict`.
2. **Add the `validateItems()` per-item helper**: validate each element of `unknown[]` against a `ZodType<T>`, partitioning by mode into `{ valid: T[]; warnings: ProblemError[] }`.
   - Files: `src/validation.ts`
   - Notes: `off` → all items pass through as `T`, no logging, no warnings. `warn` → every item returned **raw** (both would-validate and divergent), each divergence logged via `logger.warn`, nothing dropped, no warnings pushed. `strict` → only valid items returned (parsed), each divergent item logged via `logger.error` and pushed to `warnings`.
3. **Add a private `toProblemError()` (+ best-effort id extraction)** used by `validateItems` for strict rejections.
   - Files: `src/validation.ts`
   - Notes: `type: "validation-error"`, `status: 400`; `detail` names the device (`id=`/`uid=` extracted best-effort from the raw object, else `index N`) and the first Zod issue `path`; put the whole `ZodError` in `raw`. Import `ProblemError` from `./result.js` and `ZodError`/`ZodType` from `zod/v4`.

### Opinionated Implementation Notes (Examples)
```ts
// src/validation.ts
import { ZodError, ZodType } from "zod/v4";
import { defaultLogger, LoggerLike } from "./logger.js";
import { ProblemError } from "./result.js";

export type ValidationMode = "strict" | "warn" | "off";

// Single-value seam (used by getDeviceByUid). Optional trailing logger keeps 3-arg calls compiling.
export function validate<T>(
  schema: ZodType<T>,
  data: unknown,
  mode: ValidationMode,
  logger: LoggerLike = defaultLogger,
): T {
  if (mode === "off") return data as T;
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  switch (mode) {
    case "strict":
      throw result.error;               // caller decides fatality + logging; validate() does NOT log here
    case "warn":
      logger.warn(`Validation warning: ${result.error.message}`);
      return data as T;                 // raw passthrough preserved
    default:
      throw new Error(`Unknown validation mode: ${mode}`);
  }
}

// Array seam (used by the pagination path). Never throws — partitions and continues.
export function validateItems<T>(
  schema: ZodType<T>,
  items: unknown[],
  mode: ValidationMode,
  logger: LoggerLike = defaultLogger,
): { valid: T[]; warnings: ProblemError[] } {
  if (mode === "off") return { valid: items as T[], warnings: [] };

  const valid: T[] = [];
  const warnings: ProblemError[] = [];
  items.forEach((item, index) => {
    const result = schema.safeParse(item);
    if (result.success) {
      // warn returns raw (unparsed) even for valid items so unknown keys survive; strict returns parsed.
      valid.push(mode === "warn" ? (item as T) : result.data);
      return;
    }
    if (mode === "warn") {
      logger.warn(`Validation warning: ${result.error.message}`);
      valid.push(item as T);            // nothing dropped in warn
    } else {
      logger.error(`Validation error: ${result.error.message}`);
      warnings.push(toProblemError(result.error, item, index)); // dropped -> warnings (strict)
    }
  });
  return { valid, warnings };
}

function toProblemError(error: ZodError, item: unknown, index: number): ProblemError {
  const identity = extractIdentity(item) ?? `index ${index}`;
  const path = error.issues[0]?.path?.join(".") || "(root)";
  return {
    type: "validation-error",
    title: "Device failed schema validation",
    status: 400,
    detail: `Device ${identity} failed validation at path: ${path}`,
    raw: error,
  };
}

function extractIdentity(item: unknown): string | undefined {
  if (item && typeof item === "object") {
    const rec = item as Record<string, unknown>;
    if (typeof rec.id === "number" || typeof rec.id === "string") return `id=${rec.id}`;
    if (typeof rec.uid === "string") return `uid=${rec.uid}`;
  }
  return undefined;
}
```

### Tests (in this phase)
- Add `src/__tests__/validation.test.ts`.
- Build a minimal schema inline (e.g. `z.object({ id: z.number(), name: z.string() })`) and a capturing mock logger `{ debug/info/warn/error: jest.fn() }`.
- `validate()` cases: `strict` on valid returns parsed value; `strict` on invalid **throws a `ZodError`** and does **not** call any logger method; `warn` on invalid returns the raw value and calls `logger.warn` (not `console`); `off` returns raw with no logger calls; 3-arg call (no logger) still works (uses default).
- `validateItems()` cases:
  - `strict`, mixed `[valid, invalid]` → `valid` contains exactly the parsed valid item; `warnings` has one entry with `type: "validation-error"`, a `detail` naming the item (`id=`/`uid=`) and the failing path, and a `ZodError` in `raw`; `logger.error` called once, `logger.warn` never.
  - `strict`, invalid item **missing id and uid** → `detail` falls back to `index N`.
  - `warn`, mixed → all items returned **raw/unmutated** (assert an unknown extra key on the valid item survives, proving no re-parse), `warnings` empty, `logger.warn` called once per divergent item, `logger.error` never.
  - `off`, mixed → all items returned as-is, `warnings` empty, no logger calls.

### Documentation (if needed)
- None in this phase (internal seam). Release-note-worthy behavior changes are captured in Phase 2 docs.

### Exit Gate
```bash
npm run build
npm test
# R4 guard (mechanically enforced): none of the protected files may change in this phase.
# Use `HEAD` so staged/committed edits are caught too, not just unstaged working-tree changes.
git diff --name-only HEAD | grep -qE '^src/(schemas|result|index)\.ts$' && { echo 'R4 violation: a protected file (schemas.ts/result.ts/index.ts) changed'; exit 1; } || true
```
- The `git diff` guard above exits non-zero if `src/schemas.ts`, `src/result.ts`, or `src/index.ts` is modified in this phase (all Phase 1 work is confined to `src/validation.ts` + the new test file).
- `deviceSchema.test.ts` still passes unmodified (proves the 3-arg `validate` call and `DeviceSchema` are unchanged — R4).

---

## Phase 2: Wire resilient validation into the client

### Goal
Rewire `getAllPages` to validate the page **envelope** structurally (via a direct `safeParse` on an internal envelope schema, mode-gated to `strict`/`warn`) and then validate each device individually through `validateItems`, accumulating surviving devices and `warnings[]` across all pages. Update `getAccountDevices` to pass the envelope schema + `DeviceSchema` + a raw-item extractor, and update `getDeviceByUid` to keep failing hard on divergence while emitting an error-level log through the configured logger. After this phase the reported outage is fixed: a drifted account returns `{ ok: true }` with its valid devices and populated `warnings[]`.

**Requirements:** R1, R2, R3, R4, R5, R7, R8

### Steps
1. **Define the internal envelope schema** (non-exported) in `client.ts`.
   - Files: `src/client.ts`
   - Notes: `const DevicesEnvelopeSchema = z.object({ pageDetails: PaginationDataSchema.optional(), devices: z.array(z.unknown()).optional() })` and `type DevicesEnvelope = z.infer<typeof DevicesEnvelopeSchema>`. Import `z` and `PaginationDataSchema` from `./schemas.js`. Must **not** be `export`ed. `DevicesPageSchema` stays exported/unchanged in `schemas.ts`.
2. **Rewrite `getAllPages`** to the new signature `getAllPages<T, P>(url, token, params, envelopeSchema, itemSchema, extractor: (page: P) => unknown[])`.
   - Files: `src/client.ts`
   - Notes: Resolve `const logger = this.config.logger ?? defaultLogger` once. Per page: in `off`, treat `res.value as P` and read `pageDetails?.nextPageUrl` best-effort (no envelope check, no logging); in `strict`/`warn`, `envelopeSchema.safeParse(res.value)` directly — **not** `validate()` — and on failure return `{ ok: false, error: { type: "validation-error", title, status: 400, raw } }` (R5). Then `validateItems(itemSchema, extractor(page), this.validationMode, logger)`, pushing `valid` into the accumulator and `warnings` into a page-spanning `warnings[]`. Advance `nextUrl = page.pageDetails?.nextPageUrl`. On completion `return { ok: true, value: items, warnings }`. A mid-walk envelope failure discards accumulated `items`/`warnings` (returns `{ ok: false }`), exactly as pagination cannot continue past an unreadable `nextPageUrl`.
3. **Update `getAccountDevices`** to call the new `getAllPages`.
   - Files: `src/client.ts`
   - Notes: `getAllPages<Device, DevicesEnvelope>(url, token, params, DevicesEnvelopeSchema, DeviceSchema, (p) => p.devices ?? [])`. Return type stays `Result<Device[]>`.
4. **Update `getDeviceByUid`** to declare a `logger` local, pass it to `validate`, and log at error level on a `ZodError` in its `catch`.
   - Files: `src/client.ts`
   - Notes: **First**, resolve `const logger = this.config.logger ?? defaultLogger;` at the top of `getDeviceByUid` (mirroring the Step 2 line in `getAllPages`) — the current method has no `logger` in scope, so without this both the `validate(...)` call and the `catch` `logger.error(...)` fail to compile (`Cannot find name 'logger'`) and Phase 2's own exit gate cannot pass. Then call `validate(DeviceSchema, res.value, this.validationMode, logger)`; in the `catch`, when `e instanceof ZodError`, call `logger.error(...)` **before** returning `{ ok: false, error: { type: "validation-error", ... } }` (R7). Keep the `unknown-error` branch. `validate` itself still does not log in strict, so this is the single error log (no double-logging).
5. **Clean up imports** in `client.ts`.
   - Files: `src/client.ts`
   - Notes: Add `validateItems` and keep `validate`; add `z` + `PaginationDataSchema`; drop now-unused `DevicesPageSchema`/`DevicesPage` imports if unreferenced (they remain defined/exported in `schemas.ts`). Ensure `defaultLogger` and `ProblemError` are imported.

### Opinionated Implementation Notes (Examples)
```ts
// src/client.ts (internal, NOT exported)
import { z, ZodType } from "zod/v4";
import { DeviceSchema, Device, PaginationDataSchema } from "./schemas.js";
import { validate, validateItems, ValidationMode } from "./validation.js";
import { defaultLogger } from "./logger.js";
import { Result, ProblemError } from "./result.js";

const DevicesEnvelopeSchema = z.object({
  pageDetails: PaginationDataSchema.optional(),
  devices: z.array(z.unknown()).optional(),   // devices validated per-item, not here
});
type DevicesEnvelope = z.infer<typeof DevicesEnvelopeSchema>;

private async getAllPages<
  T,
  P extends { pageDetails?: { nextPageUrl: string | null } },
>(
  url: string,
  token: string,
  params: Record<string, any> | undefined,
  envelopeSchema: ZodType<P>,
  itemSchema: ZodType<T>,
  extractor: (page: P) => unknown[],
): Promise<Result<T[]>> {
  const logger = this.config.logger ?? defaultLogger;
  let nextUrl: string | null | undefined = url;
  let nextParams = params;
  const items: T[] = [];
  const warnings: ProblemError[] = [];

  while (nextUrl) {
    const res: Result<unknown> = await this.http.request<unknown>({
      method: "GET",
      url: nextUrl,
      headers: { Authorization: `Bearer ${token}` },
      params: nextParams,
    });
    if (!res.ok) return res;

    let page: P;
    if (this.validationMode === "off") {
      page = res.value as P;                           // no envelope check, best-effort walk
    } else {
      const parsed = envelopeSchema.safeParse(res.value); // direct safeParse — NOT validate()
      if (!parsed.success) {
        return { ok: false, error: { type: "validation-error", title: parsed.error.message, status: 400, raw: parsed.error } };
      }
      page = parsed.data;
    }

    const partition = validateItems(itemSchema, extractor(page), this.validationMode, logger);
    items.push(...partition.valid);
    warnings.push(...partition.warnings);

    nextUrl = page.pageDetails?.nextPageUrl;
    nextParams = undefined;
  }

  return { ok: true, value: items, warnings };
}

async getAccountDevices(params?: Record<string, any>): Promise<Result<Device[]>> {
  const tokenRes = await this.auth.getToken();
  if (!tokenRes.ok) return tokenRes as any;
  return this.getAllPages<Device, DevicesEnvelope>(
    `${this.config.apiUrl}/api/v2/account/devices`,
    tokenRes.value.accessToken,
    params,
    DevicesEnvelopeSchema,
    DeviceSchema,
    (p) => p.devices ?? [],
  );
}

// getDeviceByUid: declare a logger local at the top of the method (none exists today),
// then reuse it in the validate() call and the catch. Without this, `logger` is undefined.
const logger = this.config.logger ?? defaultLogger;
// ... validate(DeviceSchema, res.value, this.validationMode, logger) inside the try ...
} catch (e) {
  if (e instanceof ZodError) {
    logger.error(`Device validation failed for ${deviceUid}: ${e.message}`);
    return { ok: false, error: { type: "validation-error", title: e.message, status: 400, raw: e } };
  }
  return { ok: false, error: { type: "unknown-error", title: String(e), status: 500, raw: e } };
}
```

### Tests (in this phase)
- Extend `src/__tests__/devicesMethod.test.ts` (reuse its `MockAxios`) and add a capturing mock logger passed via `createDattoRmmClient({ ..., logger })`. Build divergent payloads by cloning the valid `device.json` fixture and mutating one copy (e.g. `deviceClass: "router"` — outside the enum) rather than adding many fixtures.
- **Strict, mixed page (R1, R2, R3):** page with `[validDevice, divergentDevice]` → `result.ok === true`, `value.length === 1` (only the valid device), `result.warnings.length === 1` with a `detail` naming the divergent device and the failing path, and `logger.error` called once. Existing "returns validated data" / "paginates automatically" tests must still pass.
- **Strict, malformed envelope (R5):** response where `devices` is not an array (e.g. `"devices": "nope"`) → `{ ok: false, error: { type: "validation-error" } }`.
- **Strict, multi-page abort (R5):** page1 valid (with `nextPageUrl` → page2), page2 envelope malformed → `{ ok: false }`, no partial `value`; assert page1's would-be valid device is **not** returned.
- **Strict, cross-page warnings accumulation (R1, R2, R3):** page1 `[valid1, divergent1]` (with `nextPageUrl` → page2), page2 `[valid2, divergent2]` (terminal, falsy `nextPageUrl`) → `result.ok === true`, `value` contains exactly `valid1` and `valid2` (both valid devices from both pages), `warnings.length === 2` (one entry naming each divergent device), and `logger.error` called twice. Proves the `while (nextUrl)` loop concatenates `valid` and `warnings` across successful pages rather than only returning the last page's.
- **Warn, logger routing + passthrough (R6, R8):** `validationMode: "warn"`, page with a divergent device → device **still present** in `value` (returned raw), `logger.warn` called, `console.warn` **not** used (assert via a `jest.spyOn(console, "warn")` that stays uncalled).
- **Warn, malformed envelope hard-fail (R5, Breaking Change #2):** `validationMode: "warn"` with `devices` not an array → `{ ok: false, error: { type: "validation-error" } }`.
- **Off, per-device passthrough (R8):** `validationMode: "off"` with a **well-formed page whose `devices` is an array containing a divergent device** → the divergent device flows through untouched into `value` (no drop, no re-parse), no envelope check runs, and **no logger calls** are made. Note: a *non-array* `devices` in `off` is an inherited best-effort edge — `getAllPages` does `items.push(...extractor(page))` and `extractor = (p) => p.devices ?? []`, so a non-array `devices` (object/number) would throw on spread and a string would spread characters; R8's "no fail on shape" does **not** cover that case, so the design's non-array `devices` example is deliberately **not** the off-mode case tested here (it is exercised only under strict/warn, where the envelope check hard-fails first).
- **`getDeviceByUid` fail-hard + log (R7):** strict, divergent single device → `{ ok: false, error: { type: "validation-error" } }` and `logger.error` called once.

### Documentation (if needed)
- Files: `README.md`.
- Add a new top-level section titled exactly `## Resilient validation` (append it after the existing content; place a `### Behavioral changes` subsection under it for the bullets). Using this exact heading is what the Phase 2 exit-gate `grep` guard verifies, so the target is unambiguous.
- Under that section, add release-note bullets for the three behavioral changes from the design's Breaking Changes: (1) `strict` now returns `{ ok: true }` + `warnings[]` for drifted accounts instead of `{ ok: false }`; (2) `warn` now hard-fails on a malformed **envelope** (`off` unaffected); (3) `warn` drift diagnostics now route to `config.logger` and are emitted **one per divergent device** (finer-grained) rather than one `console.warn` per page.

### Exit Gate
```bash
npm run build
npm test
# R4 guard (mechanically enforced): schemas.ts/result.ts/index.ts must not change — the envelope schema stays internal to client.ts.
# Use `HEAD` so staged/committed edits are caught too, not just unstaged working-tree changes.
git diff --name-only HEAD | grep -qE '^src/(schemas|result|index)\.ts$' && { echo 'R4 violation: a protected file (schemas.ts/result.ts/index.ts) changed'; exit 1; } || true
# Doc-landing guard: the release-note section added in the Documentation step must exist.
grep -q '## Resilient validation' README.md || { echo 'Documentation not landed: missing "## Resilient validation" section in README.md'; exit 1; }
```
- The `git diff` guard exits non-zero if `src/schemas.ts`, `src/result.ts`, or `src/index.ts` is modified — mechanically enforcing that all Phase 2 work is confined to `src/client.ts` (+ the test file) and that the internal envelope schema is never exported (R4).
- The `grep` guard confirms the README release-note section landed.
- All pre-existing tests (`deviceSchema.test.ts`, `client.test.ts`, and the original two `devicesMethod.test.ts` cases) pass unmodified.

---

## Deferred Validation (run after implementation is complete)
- Live drifted-account smoke check: point a client at the real Datto RMM API v2 with `validationMode: "strict"` and call `getAccountDevices()` for the known-drifting account, confirming it now returns `{ ok: true }` with the valid devices, a populated `warnings[]`, and an error-level log line on the configured logger — requires live Datto credentials and the real drifted inventory, so it cannot run unattended in CI. The automated phase tests already cover the same behavior against mocked payloads.
