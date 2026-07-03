# datto-rmm-api-client

Typescript package for interacting with the Datto RMM REST API

## Resilient validation

### Behavioral changes

1. In `strict` mode, `getAccountDevices()` no longer fails the whole call when one or more
   devices in the account diverge from `DeviceSchema`. It now returns `{ ok: true }` with every
   schema-valid device in `value` and each rejected device recorded in `result.warnings` as a
   `ProblemError` naming the device (`id`/`uid`) and the failing field path. `getAccountDevices`
   now **always** populates `result.warnings` — an empty array (`[]`) on a clean account, not an
   omitted field — so a consumer that previously branched on `!result.ok` to detect drift must
   instead inspect `result.warnings.length` (not truthiness: an empty array is truthy).
2. In `warn` mode, a _structurally malformed_ page envelope (e.g. the response body isn't an
   object, or `devices` is present but not an array) now returns `{ ok: false, error: { type:
"validation-error" } }`, where it previously logged and returned `{ ok: true, value: [] }`. A
   malformed envelope is a protocol error, not per-device drift, and is now treated as a hard
   failure in every mode that validates at all. `off` is unaffected — it runs no envelope check.
3. In `warn` mode, drift diagnostics now route through the client's configured `logger` (never
   `console` directly) and are emitted **one per divergent device** rather than one `console.warn`
   per page — finer-grained than before, but otherwise the returned device data is unchanged.

The public `Device` type, `DeviceSchema`, and every other export are unchanged — a rejected
device is a signal that this package's schema has drifted from upstream Datto RMM, not a reason
to loosen it.
