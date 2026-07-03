# Plan: Resilient Device Validation

- **Plan ID:** resilient-device-validation
- **Design Document:** docs/implementation/resilient-device-validation/design.md
- **Repo Context Checked:** Explored the full `src/` tree of `datto-rmm-api-client` (ESM-only TS package, `"type": "module"`, zod imported as `zod/v4`). Read `src/client.ts` — confirmed `getAllPages<T, P>(url, token, params, schema, extractor)` validates the whole page via `validate(schema, res.value, this.validationMode)` inside a `try/catch`, and that `getAccountDevices` passes `DevicesPageSchema` + `(p) => p.devices ?? []`, while `getDeviceByUid` catches `ZodError` → `{ ok: false }` with no logging. Read `src/validation.ts` — the sole `validate<T>(schema, data, mode)` seam; `off` returns raw, `strict` throws `result.error`, `warn` calls `console.warn` directly (no logger param). Read `src/schemas.ts` — `DeviceSchema` (closed `z.object`, required non-nullable `udf`/`antivirus`/`patchManagement`, closed `deviceClass`/`patchStatus`/`antivirusStatus` enums), `PaginationDataSchema` (exports `nextPageUrl: string | null`), `DevicesPageSchema = { pageDetails?, devices?: z.array(DeviceSchema) }`, all exported → public via the `src/index.ts` barrel (`export * from "./schemas.js"` and `"./client.js"`). Read `src/result.ts` — `Result<T>` already carries `warnings?: ProblemError[]` on the `ok: true` branch; `ProblemError` has `type/title/status/detail?/raw?` — no type change needed. Read `src/logger.ts` — `LoggerLike { debug/info/warn/error }`, `defaultLogger = console`. Read `src/config.ts` — `logger?` and `validationMode?` already present; client defaults `validationMode` to `"strict"`. Read `src/httpClient.ts` — `request<T>` returns `Result<T>` and is already given `config.logger ?? defaultLogger`. Examined tests in `src/__tests__/`: `deviceSchema.test.ts` calls `validate(DeviceSchema, device, "strict")` (3-arg — must keep compiling), `devicesMethod.test.ts` uses a `MockAxios` keyed by URL with fixtures under `src/__tests__/fixtures/` (`device.json`, `devicesPage.json`, `devicesPage1.json`, `devicesPage2.json`), `client.test.ts` is a smoke test. Checked `package.json` scripts — only `test` (jest), `build` (tsc), `format` (prettier); **no `lint` or `typecheck` script exists**. `jest.config.js` uses `ts-jest/presets/default-esm` (tests are type-checked at test time). `tsconfig.json` `strict: true`, excludes `src/__tests__` from the build so `npm run build` type-checks library code only.
- **External Research:** Confirmed against the Zod v4 docs (zod.dev) that `schema.safeParse(data)` returns a discriminated union whose `.error` is a `ZodError` exposing an `.issues` array, where each issue has `path` (array locating the failure) and `message`. This is the basis for building each rejected-device `ProblemError.detail` (`issues[0].path.join(".")`) with the full `ZodError` preserved in `raw`. `z.array(z.unknown())` and `z.infer` are stable v4 APIs used for the internal envelope schema.
- **Assumptions:**
  - The repo has **no** `lint`/`typecheck` npm scripts; the authoritative unattended verification is `npm run build` (tsc, library code) + `npm test` (jest/ts-jest, includes test type-checking). Exit gates use exactly these.
  - The `warnings[]` channel on `Result<T>`'s `ok: true` branch and the `ProblemError` shape are sufficient to carry rejected devices — no `result.ts` change is required (matches design).
  - The internal envelope schema must **not** be reachable from `src/index.ts`. `src/index.ts` barrels exactly four modules (`export *` of `./client.js`, `./config.js`, `./result.js`, `./schemas.js`) — so **anything exported from `client.ts` becomes public**. The envelope schema therefore lives in a dedicated **un-barrelled** module `src/internal/devicesEnvelope.ts` (a sibling of the already-non-barrelled `validation.ts`), which both `client.ts` and the Phase 2 test import. This keeps the schema off the public surface *and* lets the fixture-acceptance test reference the real schema (not a copy), satisfying R4. `src/index.ts` must not add an `export * from "./internal/..."`.
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
- **Do not** make the new internal envelope schema reachable from `src/index.ts`. Put it in a new un-barrelled module `src/internal/devicesEnvelope.ts` (do **not** add `src/internal` to the `src/index.ts` barrel); `client.ts` and the Phase 2 test both import it from there.
- **Resolve the logger once.** Declare an **uninitialized** `private logger: LoggerLike` field (or `private logger!: LoggerLike`) and **assign it in the constructor body** — `this.logger = config.logger ?? defaultLogger;` — reusing the value already computed for `HttpClient`. Do **not** write it as an inline field initializer (`private logger: LoggerLike = config.logger ?? defaultLogger`): in the live class `config` is a constructor *parameter property* (`constructor(private config: DattoRmmClientConfig)`), so a field initializer cannot reference the bare name `config` and would fail `npm run build` with TS2663 "Cannot find name 'config'". Reference `this.logger` in `getAllPages`/`getDeviceByUid` — do **not** re-derive `config.logger ?? defaultLogger` per method. Requires importing `LoggerLike` (and `defaultLogger`) in `client.ts`.
- Preserve the `warn` and `off` **returned-data** contracts exactly: in `warn`, every device (valid or not) is returned **raw and unparsed** (never re-parsed, which would strip unknown keys); in `off`, nothing is validated or logged. The only behavioral break allowed is the envelope hard-fail in `warn` (design Decision 2 / Breaking Change #2).
- `validate()`'s new `logger` parameter is an **optional trailing** parameter defaulting to `defaultLogger`, so existing 3-arg calls (e.g. in `deviceSchema.test.ts`) keep compiling untouched.
- `validate()` must **not** log in `strict` mode — it throws, and the caller (`getDeviceByUid`) decides fatality and emits the error log. The per-item helper, which does not throw, owns its own error/warn logging.
- **One error shape, one message.** Every `type: "validation-error"` `ProblemError` (per-device rejections, the `getDeviceByUid` catch, and the envelope hard-fail) uses a **short stable `title`**, specifics in `detail`, and the `ZodError` in `raw` — never the serialized `ZodError.message` in `title`. The per-device and `getDeviceByUid` sites share the exported `toProblemError(entityLabel, …)` builder; the envelope site follows the same convention with title `"Malformed devices page envelope"`. Log lines interpolate the corresponding `detail` (which names the device/field), not the bare `ZodError.message`, so logs and `warnings[]` describe the same failure.
- **Single source of truth for the error `type`/`status`.** The literals `type: "validation-error"` and `status: 400` are exported once from `validation.ts` as `VALIDATION_ERROR_TYPE`/`VALIDATION_ERROR_STATUS` and consumed by **both** `toProblemError` and the envelope hard-fail branch (which can't call `toProblemError` because its `title` differs). Do not hand-write those two literals a second time in `client.ts`. (Tests may still assert the literal `"validation-error"` string.)
- **`validate()`'s `warn` log names the failing path, not a raw `ZodError` dump.** The single-value seam is generic (no `entityLabel`), so it cannot name the device, but it **must not** log the multi-line `result.error.message` blob. It logs the first Zod issue path (`result.error.issues[0]?.path?.join(".") || "(root)"`), mirroring `toProblemError`, so the sole `warn`-mode `getDeviceByUid` caller gets a structured "which field drifted" line consistent with the strict path (whose `getDeviceByUid` caller already names the uid from context).
- `validateItems`/`toProblemError` are **generic** and take an `entityLabel` (`"Device"` today) rather than hardcoding device copy, so the design's stated reuse for a future paginated collection endpoint is not blocked. `toProblemError` is exported from `validation.ts`, which is **not** in the `src/index.ts` barrel, so it stays off the public surface.

---

## Phase 1: Logger-aware validation seam + per-item helper

### Goal
Turn the single validation module into the two primitives the resilient pagination path needs, with no client wiring yet: (1) a logger-aware `validate()` whose `warn` branch routes through a `LoggerLike` instead of `console`, and (2) a new `validateItems()` helper that validates an array element-by-element and partitions results by mode, returning surviving items plus per-device `ProblemError` rejections and emitting the correct log level per mode. This phase is self-contained and fully unit-testable without touching `client.ts`.

**Requirements:** R2, R3, R4, R6

### Steps
1. **Add a logger-aware `validate()` overload-compatible signature**: give `validate` an optional trailing `logger: LoggerLike = defaultLogger` and route the `warn` diagnostic through `logger.warn`. Leave `strict` (throw, no log) and `off` (raw passthrough) semantics exactly as they are.
   - Files: `src/validation.ts`
   - Notes: Import `defaultLogger` and `LoggerLike` from `./logger.js`. The default keeps `deviceSchema.test.ts`'s 3-arg call compiling. Do **not** log in `strict`. The `warn` log must name the **failing path** (`result.error.issues[0]?.path?.join(".") || "(root)"`) — **not** the raw `result.error.message` blob — so the single-value seam's `warn` diagnostic is as structured as the strict/array paths.
   - Also add the shared error-literal constants here: `export const VALIDATION_ERROR_TYPE = "validation-error"` and `export const VALIDATION_ERROR_STATUS = 400`, reused by `toProblemError` (this file) and the envelope hard-fail (`client.ts`).
2. **Add the `validateItems()` per-item helper**: validate each element of `unknown[]` against a `ZodType<T>`, partitioning by mode into `{ valid: T[]; warnings: ProblemError[] }`. The helper is **generic** — it takes an `entityLabel: string` (the caller passes `"Device"`) so no domain copy is hardcoded and it can be reused for a future paginated collection endpoint (design Future Considerations) without emitting "Device …" for non-devices.
   - Files: `src/validation.ts`
   - Notes: Signature `validateItems<T>(schema, items, mode, entityLabel, logger = defaultLogger)`. `off` → all items pass through as `T` (guarded by `Array.isArray` — a non-array `items` yields `[]`, never a thrown `TypeError`), no logging, no warnings. `warn` → every item returned **raw** (both would-validate and divergent), each divergence logged via `logger.warn`, nothing dropped, no warnings pushed. `strict` → only valid items returned (parsed), each divergent item logged via `logger.error` and pushed to `warnings`. In **both** `warn` and `strict`, build the per-item `ProblemError` **once** via `toProblemError` and interpolate its `detail` (identity + failing path) into the log line — the log and the `warnings[]` entry must name the same device and field, not the bare `ZodError.message`.
3. **Add and export `toProblemError()` (+ best-effort id extraction)** used by `validateItems` for its rejections and reused by `getDeviceByUid` in Phase 2 so all `validation-error` `ProblemError`s share one shape.
   - Files: `src/validation.ts`
   - Notes: Signature `toProblemError(entityLabel, error, item, index)`. `type: "validation-error"`, `status: 400`; a **short stable** `title` (`` `${entityLabel} failed schema validation` ``); `detail` names the entity (`id=`/`uid=` extracted best-effort from the raw object, else `index N`) and the first Zod issue `path`; put the whole `ZodError` in `raw`. `export` it from `validation.ts` (which is **not** re-exported by the `src/index.ts` barrel, so this stays off the public surface — architect confirmed `validation.ts` is not barrelled) so `getDeviceByUid` can reuse it. Import `ProblemError` from `./result.js` and `ZodError`/`ZodType` from `zod/v4`.

### Opinionated Implementation Notes (Examples)
```ts
// src/validation.ts
import { ZodError, ZodType } from "zod/v4";
import { defaultLogger, LoggerLike } from "./logger.js";
import { ProblemError } from "./result.js";

export type ValidationMode = "strict" | "warn" | "off";

// Single source of truth for the validation-error ProblemError type/status; reused by the envelope
// hard-fail in client.ts (which can't call toProblemError because its title differs).
export const VALIDATION_ERROR_TYPE = "validation-error";
export const VALIDATION_ERROR_STATUS = 400;

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
      // Name the failing path, not the raw multi-line ZodError.message blob (mirrors toProblemError).
      logger.warn(`Validation warning at path: ${result.error.issues[0]?.path?.join(".") || "(root)"}`);
      return data as T;                 // raw passthrough preserved
    default:
      throw new Error(`Unknown validation mode: ${mode}`);
  }
}

// Array seam (used by the pagination path). Never throws — partitions and continues.
// Generic: `entityLabel` ("Device") is injected so no domain copy is hardcoded (reusable per design).
export function validateItems<T>(
  schema: ZodType<T>,
  items: unknown[],
  mode: ValidationMode,
  entityLabel: string,
  logger: LoggerLike = defaultLogger,
): { valid: T[]; warnings: ProblemError[] } {
  // off: raw passthrough. Array.isArray guard keeps a non-array `items` from throwing on spread upstream.
  if (mode === "off") return { valid: (Array.isArray(items) ? items : []) as T[], warnings: [] };

  const valid: T[] = [];
  const warnings: ProblemError[] = [];
  items.forEach((item, index) => {
    const result = schema.safeParse(item);
    if (result.success) {
      // warn returns raw (unparsed) even for valid items so unknown keys survive; strict returns parsed.
      valid.push(mode === "warn" ? (item as T) : result.data);
      return;
    }
    // Build the ProblemError once; its `detail` (identity + failing path) drives BOTH the log line and warnings[].
    const problem = toProblemError(entityLabel, result.error, item, index);
    if (mode === "warn") {
      logger.warn(`Validation warning: ${problem.detail}`);
      valid.push(item as T);            // nothing dropped in warn
    } else {
      logger.error(`Validation error: ${problem.detail}`); // names which device + field, not a raw ZodError dump
      warnings.push(problem);           // dropped -> warnings (strict)
    }
  });
  return { valid, warnings };
}

// Exported so getDeviceByUid can reuse it. validation.ts is NOT in the src/index.ts barrel -> stays non-public.
export function toProblemError(
  entityLabel: string,
  error: ZodError,
  item: unknown,
  index: number,
): ProblemError {
  const identity = extractIdentity(item) ?? `index ${index}`;
  const path = error.issues[0]?.path?.join(".") || "(root)";
  return {
    type: VALIDATION_ERROR_TYPE,
    title: `${entityLabel} failed schema validation`,   // short stable title; specifics go in detail, full error in raw
    status: VALIDATION_ERROR_STATUS,
    detail: `${entityLabel} ${identity} failed validation at path: ${path}`,
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
- `validate()` cases: `strict` on valid returns parsed value; `strict` on invalid **throws a `ZodError`** and does **not** call any logger method; `warn` on invalid returns the raw value and calls `logger.warn` **with a message naming the failing path** (assert the log contains the path segment, e.g. `"name"`, and does **not** contain the raw multi-line `ZodError.message` blob) — via `logger.warn`, not `console`; `off` returns raw with no logger calls; 3-arg call (no logger) still works (uses default).
- `validateItems()` cases (pass `entityLabel: "Device"`):
  - `strict`, mixed `[valid, invalid]` → `valid` contains exactly the parsed valid item; `warnings` has one entry with `type: "validation-error"`, a short `title` (`"Device failed schema validation"`), a `detail` naming the item (`id=`/`uid=`) and the failing path, and a `ZodError` in `raw`; `logger.error` called once **with a message containing that same `detail` string** (assert the log names the device + field, not the bare `ZodError.message`), `logger.warn` never.
  - `strict`, invalid item **missing id and uid** → `detail` falls back to `index N`.
  - `warn`, mixed → all items returned **raw/unmutated** (assert an unknown extra key on the valid item survives, proving no re-parse), `warnings` empty, `logger.warn` called once per divergent item **with the identity + path message**, `logger.error` never.
  - `off`, mixed → all items returned as-is, `warnings` empty, no logger calls.
  - `off`, `items` deliberately **not an array** (pass a non-array value) → returns `{ valid: [], warnings: [] }` and does **not** throw (guards the spread upstream).

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
1. **Resolve the logger once on the client.** Declare an **uninitialized** `private logger: LoggerLike` field and **assign it in the constructor body** — `this.logger = config.logger ?? defaultLogger;` (reuse the value already passed to `HttpClient`) — so `getAllPages`/`getDeviceByUid` reference `this.logger` instead of re-deriving it.
   - Files: `src/client.ts`
   - Notes: Import `LoggerLike` and `defaultLogger` from `./logger.js`. Do **not** use an inline field initializer (`private logger: LoggerLike = config.logger ?? defaultLogger`): `config` is a constructor *parameter property* (`constructor(private config: DattoRmmClientConfig)`), so a field-initializer reference to the bare `config` fails to compile (TS2663). Declare the field, assign in the constructor body. No Phase 2 method re-computes `config.logger ?? defaultLogger`; all read `this.logger`.
2. **Define the internal envelope schema** in a new **un-barrelled** module `src/internal/devicesEnvelope.ts` (so it stays off the public surface *and* is importable by the Phase 2 test).
   - Files: `src/internal/devicesEnvelope.ts` (new)
   - Notes: `export const DevicesEnvelopeSchema = z.object({ pageDetails: PaginationDataSchema.optional(), devices: z.array(z.unknown()).optional() })` and `export type DevicesEnvelope = z.infer<typeof DevicesEnvelopeSchema>`. Import `z` from `zod/v4` and `PaginationDataSchema` from `../schemas.js`. It is exported from *this module*, but the module is **not** added to the `src/index.ts` barrel (which only `export *`s `client/config/result/schemas`), so it never becomes public — mirroring how `validateItems`/`toProblemError` stay non-public in the un-barrelled `validation.ts`. `client.ts` and the Phase 2 test both import `DevicesEnvelopeSchema` from `./internal/devicesEnvelope.js`. `DevicesPageSchema` stays exported/unchanged in `schemas.ts`. Do **not** add `export * from "./internal/..."` to `src/index.ts`.
   - **Scope of the envelope hard-fail (intentional, documented gap vs design L139):** `devices` is **optional** — deliberately, matching the existing `DevicesPageSchema.devices` (which the design leaves unchanged) and the design's own conceptual envelope (design L89–93), so a legitimate **zero-device page** that omits `devices` is not falsely rejected. Consequence: the envelope hard-fail (R5) catches the cases that actually reach validation — a body that is **not a JSON object** (string/HTML error page → axios returns a string → `z.object` rejects → hard-fail), a **present-but-wrong-type** `devices` (e.g. `"devices": "nope"` → `z.array` rejects → hard-fail), and unreadable `pageDetails`/`nextPageUrl`. It does **not** catch a 200 body that *is* a JSON object but carries **neither** `pageDetails` **nor** `devices` (e.g. `{}` or an auth-error `{ error: "unauthorized" }`): both optional fields absent + `z.object` strips unknown keys → it parses as an **empty page** yielding `{ ok: true, value: [] }` with no `logger.error`. This is an accepted residual gap relative to the design's Decision-2 rhetoric (L139, "an auth-error body … hard-fails"): in practice auth failures surface as non-2xx and are already short-circuited by `res.ok` upstream (`HttpClient` returns `{ ok: false }` before validation), so a 200-status non-devices-page object is rare, and the safer choice is to not regress legitimate empty accounts by making `devices` required. Tightening the envelope to require `devices` is left as a deferred follow-up (see Deferred Validation) should real traffic show 200 non-devices-page bodies. A test (below) pins this "object lacking both keys → empty page, not a hard-fail" behavior so it is a chosen, verified contract rather than an accident.
3. **Rewrite `getAllPages`** to the new signature `getAllPages<T, P>(url, token, params, envelopeSchema, itemSchema, extractor: (page: P) => unknown[])`.
   - Files: `src/client.ts`
   - Notes: Use the `this.logger` field (from Step 1) — do **not** re-derive `config.logger ?? defaultLogger`. Per page: in `off`, treat `res.value as P` and read `pageDetails?.nextPageUrl` best-effort (no envelope check, no logging); in `strict`/`warn`, `envelopeSchema.safeParse(res.value)` directly — **not** `validate()`. On envelope failure, first `this.logger.error(...)` — a **single-line, path-named** message consistent with every other log in the feature: `` `Malformed devices page envelope at ${nextUrl} (path: ${parsed.error.issues[0]?.path?.join(".") || "(root)"})` ``. Do **not** interpolate the raw multi-line `parsed.error.message` blob into the log line (that is the exact anti-pattern removed from the per-device path and `validate()`'s `warn` seam); the full serialized error is preserved in the `ProblemError`'s `detail`/`raw` instead. This is the loudest, protocol-level failure and must be observable through the same logger as per-device drift; in `warn` it also replaces the old page-level `console.warn`. Then return `{ ok: false, error: { type: VALIDATION_ERROR_TYPE, title: "Malformed devices page envelope", status: VALIDATION_ERROR_STATUS, detail: parsed.error.message, raw: parsed.error } }` (R5) — a **short stable** `title` with the serialized error in `detail`, mirroring `toProblemError`'s convention (do **not** dump `parsed.error.message` into `title`), and reusing the shared `VALIDATION_ERROR_TYPE`/`VALIDATION_ERROR_STATUS` constants rather than hand-written literals. Then `validateItems(itemSchema, extractor(page), this.validationMode, "Device", this.logger)`, pushing `valid` into the accumulator and `warnings` into a page-spanning `warnings[]`. Advance `nextUrl = page?.pageDetails?.nextPageUrl` (optional-chain **`page` itself**, not only `pageDetails` — see off-path null-safety below; on a `null` off-mode body `page.pageDetails?.…` would throw before the `?.` helps). On completion `return { ok: true, value: items, warnings }` — **`warnings` is always present, even when empty (`[]`)** on a clean account. This is a deliberate choice (not omit-when-empty): a stable shape is simpler to reason about and to test, and `Result.warnings` is already optional so it compiles. **Consequence to document (release note item 1 already tells drift-detecting consumers to "inspect `result.warnings`"): consumers must test `result.warnings.length`/`?.length`, not truthiness — an empty `[]` is truthy.** Add this caveat to the README "Behavioral changes" bullet for item 1. (The two existing `devicesMethod.test.ts` cases assert via `.length`/property checks, not whole-object `toEqual`, so always-present `warnings` does not break them.) A mid-walk envelope failure discards accumulated `items`/`warnings` (returns `{ ok: false }`), exactly as pagination cannot continue past an unreadable `nextPageUrl`.
   - **Off-path null-safety (Result contract) — two dereference sites, both null-safed:** in `off` there is no envelope check, so `res.value` may be `null` or a primitive, and it is assigned to `page` as-is. **Two** statements dereference `page` on the off path and **both** must be null-safe: (1) the devices extractor, optional-chained as `(p) => p?.devices ?? []` (see Step 4); and (2) the walk-advance read of `nextPageUrl`, which **must** be written `nextUrl = page?.pageDetails?.nextPageUrl` — note the `?.` **after `page`**, not only after `pageDetails`. Writing `page.pageDetails?.nextPageUrl` (the naive form) still throws `TypeError: Cannot read properties of null (reading 'pageDetails')` on a `null` page, because that `?.` guards `.nextPageUrl` but not the `page.pageDetails` access itself — and this read is a **separate statement** the extractor guard cannot cover. With both sites guarded, `validateItems`' `Array.isArray` guard then handles a non-array `devices`. Together these keep the "never throw, always `{ ok: false | true }`" Result contract mode-independent even though `off` runs no envelope validation, and make the "`null`/primitive page body does not throw" test (Tests below) pass. (In `strict`/`warn`, `page = parsed.data` is always a validated non-null object, so `page?.` is a harmless no-op there.)
4. **Update `getAccountDevices`** to call the new `getAllPages`.
   - Files: `src/client.ts`
   - Notes: `getAllPages<Device, DevicesEnvelope>(url, token, params, DevicesEnvelopeSchema, DeviceSchema, (p) => p?.devices ?? [])`. The extractor is **optional-chained** (`p?.devices`) so an `off`-mode `null`/primitive page body never throws a `TypeError` (see Step 3 off-path null-safety). Return type stays `Result<Device[]>`.
5. **Update `getDeviceByUid`** to use `this.logger`, pass it to `validate`, and log at error level on a `ZodError` in its `catch`.
   - Files: `src/client.ts`
   - Notes: Use the `this.logger` field (Step 1) — the current method has no logger in scope, so without it both the `validate(...)` call and the `catch` `this.logger.error(...)` fail to compile (`Cannot find name 'logger'`) and Phase 2's own exit gate cannot pass. Call `validate(DeviceSchema, res.value, this.validationMode, this.logger)`; in the `catch`, when `e instanceof ZodError`, **build the `ProblemError` once**: `const problem = toProblemError("Device", e, res.value, 0);` (the **same** builder/shape used by `validateItems`, so all three `validation-error` sites share one shape — short stable `title`, specifics in `detail`, `ZodError` in `raw` — replacing the preexisting `title: e.message` dump). Then `this.logger.error(...)` with `problem.detail` and `return { ok: false, error: problem };` — do **not** call `toProblemError` a second time for the return, and do **not** prefix the log with a duplicative `"Device … for {uid}"` (which double-prints the word "Device", since `problem.detail` already begins with `Device …`). Note the identity in `problem.detail` is `extractIdentity`'s **id-first** result: because every valid `Device` carries a numeric `id` (`schemas.ts`), a divergent device that still has its `id` yields `Device id={id} failed validation at path: …` (it falls back to `uid={uid}`, then `index N`, only when `id` is absent) — so the log/warning names `id=`, **not** `uid=`, for the common case even though the endpoint is addressed by uid. That is acceptable (R2 permits either id or uid); just keep the prose and test assertions aligned to `id=`. Log `problem.detail` directly, or with a non-duplicative prefix like `` `getDeviceByUid: ${problem.detail}` ``. Keep the `unknown-error` branch unchanged. `validate` itself still does not log in strict, so this is the single error log (no double-logging).
6. **Clean up imports** in `client.ts`.
   - Files: `src/client.ts`
   - Notes: Add `validateItems`, `toProblemError`, `VALIDATION_ERROR_TYPE`, `VALIDATION_ERROR_STATUS` and keep `validate` (all from `./validation.js`); import `DevicesEnvelopeSchema`/`DevicesEnvelope` from `./internal/devicesEnvelope.js`; import `LoggerLike` + `defaultLogger` from `./logger.js`; drop now-unused `DevicesPageSchema`/`DevicesPage` imports if unreferenced (they remain defined/exported in `schemas.ts`). `ProblemError` is only needed as a type for the page-spanning `warnings[]` accumulator — import it if referenced. `z`/`PaginationDataSchema` move to `src/internal/devicesEnvelope.ts` and are no longer imported by `client.ts` unless otherwise referenced.

### Opinionated Implementation Notes (Examples)
```ts
// src/internal/devicesEnvelope.ts (exported from this module, but NOT barrelled by src/index.ts)
import { z } from "zod/v4";
import { PaginationDataSchema } from "../schemas.js";

export const DevicesEnvelopeSchema = z.object({
  pageDetails: PaginationDataSchema.optional(),
  devices: z.array(z.unknown()).optional(),   // devices validated per-item, not here
});
export type DevicesEnvelope = z.infer<typeof DevicesEnvelopeSchema>;
```

```ts
// src/client.ts
import { ZodType, ZodError } from "zod/v4";
import { DeviceSchema, Device } from "./schemas.js";
import {
  validate, validateItems, toProblemError,
  VALIDATION_ERROR_TYPE, VALIDATION_ERROR_STATUS, ValidationMode,
} from "./validation.js";
import { DevicesEnvelopeSchema, DevicesEnvelope } from "./internal/devicesEnvelope.js";
import { LoggerLike, defaultLogger } from "./logger.js";
import { Result, ProblemError } from "./result.js";

// Declare an uninitialized field `private logger: LoggerLike;` and assign in the constructor BODY
// (config is a `private config` parameter property, so a field initializer referencing bare `config` won't compile):
//   this.logger = config.logger ?? defaultLogger;   // reusing the value already passed to HttpClient
// Referenced by both methods below.

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
  const logger = this.logger;            // resolved once in the constructor
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
        // Single-line, path-named (like every other log in the feature); full error stays in detail/raw, not the log line.
        logger.error(`Malformed devices page envelope at ${nextUrl} (path: ${parsed.error.issues[0]?.path?.join(".") || "(root)"})`);
        return {
          ok: false,
          error: {
            type: VALIDATION_ERROR_TYPE,               // shared constant, not a hand-written literal
            title: "Malformed devices page envelope",  // short stable title; error blob goes in detail/raw
            status: VALIDATION_ERROR_STATUS,
            detail: parsed.error.message,
            raw: parsed.error,
          },
        };
      }
      page = parsed.data;
    }

    // entityLabel "Device"; validateItems' off branch is Array.isArray-guarded so a non-array devices never throws.
    const partition = validateItems(itemSchema, extractor(page), this.validationMode, "Device", logger);
    items.push(...partition.valid);
    warnings.push(...partition.warnings);

    nextUrl = page?.pageDetails?.nextPageUrl;   // optional-chain `page` too: off-mode null body must not throw here
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
    (p) => p?.devices ?? [],   // optional-chained: off-mode null/primitive page never throws
  );
}

// getDeviceByUid: use this.logger (resolved in the constructor) in the validate() call and the catch.
// ... validate(DeviceSchema, res.value, this.validationMode, this.logger) inside the try ...
} catch (e) {
  if (e instanceof ZodError) {
    const problem = toProblemError("Device", e, res.value, 0); // built ONCE; same builder/shape as validateItems
    this.logger.error(`getDeviceByUid: ${problem.detail}`);    // problem.detail already names Device + uid + path
    return { ok: false, error: problem };                       // reuse the same object, no second toProblemError call
  }
  return { ok: false, error: { type: "unknown-error", title: String(e), status: 500, raw: e } };
}
```

### Tests (in this phase)
- Extend `src/__tests__/devicesMethod.test.ts` (reuse its `MockAxios`) and add a capturing mock logger passed via `createDattoRmmClient({ ..., logger })`. Build divergent payloads by cloning the valid `device.json` fixture and mutating one copy (e.g. `deviceClass: "router"` — outside the enum) rather than adding many fixtures.
- **Strict, clean page emits an empty `warnings[]` (shape guard for engineer-r3-f5):** a page of all-valid devices → `result.ok === true`, `Array.isArray(result.warnings) === true`, `result.warnings.length === 0`, and `logger.error` not called. Pins the "always present, even when empty" contract so a consumer checking `.length` (not truthiness) is relying on a tested shape.
- **Strict, mixed page (R1, R2, R3):** page with `[validDevice, divergentDevice]` → `result.ok === true`, `value.length === 1` (only the valid device), `result.warnings.length === 1` with a `detail` naming the divergent device and the failing path, and `logger.error` called once. Existing "returns validated data" / "paginates automatically" tests must still pass.
- **Envelope schema accepts existing fixtures (design Risks & Mitigations row 3):** assert `DevicesEnvelopeSchema.safeParse(...)` succeeds (`.success === true`) on each existing page fixture (`devicesPage.json`, `devicesPage1.json`, `devicesPage2.json`), guarding the envelope-vs-`DevicesPageSchema` `pageDetails` consistency directly rather than by side effect. The test imports the real schema from `../internal/devicesEnvelope.js` (the same non-barrelled module `client.ts` uses) — **no** test-only re-export from `client.ts` and **no** inline reconstruction, so the test guards the actual schema the client runs, and the schema never reaches `src/index.ts`.
- **Strict, malformed envelope (R5) + log:** response where `devices` is not an array (e.g. `"devices": "nope"`) → `{ ok: false, error: { type: "validation-error", title: "Malformed devices page envelope" } }`, and `logger.error` called once (envelope failure is observable through the configured logger, not silent).
- **Strict, object lacking both `pageDetails` and `devices` → empty page, NOT a hard-fail (pins the documented Step 2 gap):** `validationMode: "strict"` with a 200 body that is an object carrying neither key (test both `{}` and an auth-error-shaped `{ error: "unauthorized" }`) → `{ ok: true, value: [] }`, `warnings` empty, and `logger.error` **not** called. This locks in the intentional "absent-both-keys is treated as an empty page" contract (envelope hard-fail is scoped to non-object bodies, present-but-wrong-type `devices`, and unreadable `pageDetails`), so the residual gap vs design L139 is a verified decision, not a silent accident. Pair with a comment in the test referencing the Step 2 scope note.
- **Strict, cross-page warnings accumulation (R1, R2, R3):** page1 `[valid1, divergent1]` (with `nextPageUrl` → page2), page2 `[valid2, divergent2]` (terminal, falsy `nextPageUrl`) → `result.ok === true`, `value` contains exactly `valid1` and `valid2` (both valid devices from both pages), `warnings.length === 2` (one entry naming each divergent device), and `logger.error` called twice. Proves the `while (nextUrl)` loop concatenates `valid` and `warnings` across successful pages rather than only returning the last page's.
- **Warn, logger routing + passthrough (R6, R8):** `validationMode: "warn"`, page with a divergent device → device **still present** in `value` (returned raw), `logger.warn` called, `console.warn` **not** used (assert via a `jest.spyOn(console, "warn")` that stays uncalled).
- **Warn, malformed envelope hard-fail (R5, Breaking Change #2) + log:** `validationMode: "warn"` with `devices` not an array → `{ ok: false, error: { type: "validation-error", title: "Malformed devices page envelope" } }`, and `logger.error` called once (replacing the old page-level `console.warn`).
- **Off, per-device passthrough (R8):** `validationMode: "off"` with a **well-formed page whose `devices` is an array containing a divergent device** → the divergent device flows through untouched into `value` (no drop, no re-parse), no envelope check runs, and **no logger calls** are made.
- **Off, non-array `devices` does not throw (Result-contract guard):** `validationMode: "off"` with a page whose `devices` is a non-array object → `getAllPages` returns `{ ok: true }` (that page contributes zero items) rather than throwing a `TypeError` out of `getAccountDevices`. This is guaranteed by `validateItems`' `off` branch `Array.isArray` guard (Phase 1), keeping the Result contract — every failure returned as `{ ok: false }`, never thrown — mode-independent even though `off` runs no envelope check.
- **Off, `null`/primitive page body does not throw (Result-contract guard, two dereference sites):** `validationMode: "off"` with a response body that is `null` (and a second case: a primitive, e.g. a string) → `getAllPages` returns `{ ok: true, value: [] }` and does **not** throw a `TypeError`. A `null` page has **two** unguarded-if-naive dereference sites: the **optional-chained extractor** (`(p) => p?.devices ?? []`, Step 4) and the **walk-advance read** (`nextUrl = page?.pageDetails?.nextPageUrl`, Step 3). Both must optional-chain `page` itself: the `Array.isArray` guard alone cannot cover a `null` page (the extractor throw precedes `validateItems`), and — critically — the `nextPageUrl` read is a *separate statement* after the extractor, so `page.pageDetails?.…` (guarding only `.nextPageUrl`) still throws on a `null` page. This test must exercise the `null` case specifically (not just a primitive: `"s".pageDetails` is `undefined` via auto-boxing and never throws, so a string-only test would pass even with the naive `page.pageDetails?.…` and fail to catch the bug). Together the two guards make the "never throw" claim hold for `off` regardless of body shape.
- **`getDeviceByUid` fail-hard + log (R7):** strict, divergent single device → `{ ok: false, error: { type: "validation-error", title: "Device failed schema validation" } }` (the shared `toProblemError` shape — short stable `title`, `ZodError` in `raw`, not the old `title: e.message` dump) and `logger.error` called once **with `problem.detail` and no duplicated "Device"/uid** (assert the message equals `problem.detail` or the `getDeviceByUid: ${problem.detail}` prefix form — it must not contain "Device" twice).
- **`getDeviceByUid` warn-mode log names the path (R6, engineer-r2-f1):** `validationMode: "warn"`, divergent single device → device returned raw (`{ ok: true }`, per the warn passthrough contract for a single value), and `logger.warn` called with a message that **names the failing path** (contains the path segment) and does **not** contain the raw multi-line `ZodError.message` blob. Proves the single-value seam's warn log is structured, consistent with the strict path.

### Documentation (if needed)
- Files: `README.md`.
- Add a new top-level section titled exactly `## Resilient validation` (append it after the existing content; place a `### Behavioral changes` subsection under it for the bullets). Using this exact heading is what the Phase 2 exit-gate `grep` guard verifies, so the target is unambiguous.
- Under that section, add release-note bullets for the three behavioral changes from the design's Breaking Changes: (1) `strict` now returns `{ ok: true }` + `warnings[]` for drifted accounts instead of `{ ok: false }` — and note that `getAccountDevices` now **always** populates `result.warnings` (an empty `[]` on a clean account), so consumers detecting drift must inspect `result.warnings.length`, **not** truthiness (an empty array is truthy); (2) `warn` now hard-fails on a malformed **envelope** (`off` unaffected); (3) `warn` drift diagnostics now route to `config.logger` and are emitted **one per divergent device** (finer-grained) rather than one `console.warn` per page.

### Exit Gate
```bash
npm run build
npm test
# R4 guard (a) — the barrelled schemas/result/index modules must not change (envelope schema lives in the
# un-barrelled src/internal/devicesEnvelope.ts, and index.ts must NOT gain an `export * from "./internal/..."`).
# Use `HEAD` so staged/committed edits are caught too, not just unstaged working-tree changes.
git diff --name-only HEAD | grep -qE '^src/(schemas|result|index)\.ts$' && { echo 'R4 violation: a protected file (schemas.ts/result.ts/index.ts) changed'; exit 1; } || true
# R4 guard (b) — public-surface growth via a NEW top-level export in a barrelled module the phase edits.
# client.ts and config.ts are re-exported by index.ts with `export *`, so a new `export` in them is a new public API.
# (Class methods are not top-level `export`s, so this does not false-positive on method edits.)
git diff HEAD -- src/client.ts src/config.ts | grep -qE '^\+export ' && { echo 'R4 violation: a new top-level export was added to a barrelled module (client.ts/config.ts)'; exit 1; } || true
# Doc-landing guard: the release-note section added in the Documentation step must exist.
grep -q '## Resilient validation' README.md || { echo 'Documentation not landed: missing "## Resilient validation" section in README.md'; exit 1; }
```
- Guard (a) exits non-zero if `src/schemas.ts`, `src/result.ts`, or `src/index.ts` is modified — confining Phase 2 to `src/client.ts` + `src/internal/devicesEnvelope.ts` (+ the test file) and, because it also trips on any `index.ts` edit, mechanically preventing the internal envelope module from being barrelled (R4).
- Guard (b) closes the blind spot in guard (a): a new top-level `export` added to `client.ts` or `config.ts` widens the public surface **without** touching any file guard (a) watches. It fails the gate if either barrelled module gains a `+export ` line (R4).
- The `grep` guard confirms the README release-note section landed.
- All pre-existing tests (`deviceSchema.test.ts`, `client.test.ts`, and the original two `devicesMethod.test.ts` cases) pass unmodified.

---

## Deferred Validation (run after implementation is complete)
- **Envelope-tightening follow-up (evidence-driven):** the envelope keeps `devices` optional (Phase 2 Step 2), so a 200 body that is an object lacking both `pageDetails` and `devices` is treated as an empty page rather than a protocol hard-fail. If, after rollout, the error logs / traffic show real 200-status non-devices-page bodies (e.g. auth-error JSON slipping through with a 200), revisit requiring `devices` in `DevicesEnvelopeSchema` (weighing against whether Datto omits `devices` for legitimately empty accounts). This cannot be validated unattended without live traffic samples.
- Live drifted-account smoke check: point a client at the real Datto RMM API v2 with `validationMode: "strict"` and call `getAccountDevices()` for the known-drifting account, confirming it now returns `{ ok: true }` with the valid devices, a populated `warnings[]`, and an error-level log line on the configured logger — requires live Datto credentials and the real drifted inventory, so it cannot run unattended in CI. The automated phase tests already cover the same behavior against mocked payloads.
