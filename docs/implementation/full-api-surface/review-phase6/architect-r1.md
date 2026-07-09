## architect — round 1

First architect turn on Phase 6 (no prior `architect-r*` turns in this review dir). The
implementation-auditor and reviser turns are from other pipeline workers; I conduct my own
independent architectural review rather than reconciling against their dispositions.

Scope confirmed via `git diff main`: Phase 6 adds `src/client/resources/base-resource.ts` and the
`src/schema-overrides/**` module (plus tests). No old-surface file changed — coexistence holds.
Boundaries are clean and downward-flowing (`base-resource` → `schema-overrides`, `validation`,
`errors`, `logging`, `rate-limit`; `schema-overrides` → `generated` only); no circular deps; the
`rateDescriptor` axios augmentation is correctly kept as a private, non-emitted `.d.ts`. The
`httpPut` deviation and the write-body build-out are well-grounded and I do not re-litigate them.

The findings below are the structural gaps I consider material. The dominant one (f1) is a
missing primitive that strands real R1 operations from the sanctioned transport path — the same
class of gap the Implementor correctly recognized when adding `httpPut`, but for GET.

### Analysis of the primitive-set gap (f1)

`BaseResource` offers exactly three response shapes: `httpGet` → a single value via
`validateResponse`; `paginate` → a `{ pageDetails, <array> }` envelope; and the `protected`
`validateArrayResponse` helper (not an HTTP primitive — it takes already-fetched `data`, not a
path). The committed spec has **four** GET operations whose response is a *bare, non-paginated
top-level array*: `getByMacAddressResponse` and `getDeviceAuditByMacAddressResponse`
(device/audit lookups), `getStdOutResponse`, `getStdErrResponse` (job output) — all in the "75
operations" R1 coverage set. None fit `httpGet` (which runs `parseLenient` over the *whole* array,
so a single bad item fails the entire `safeParse` and `validateResponse` throws — the exact
whole-collection failure R7 forbids) and none fit `paginate` (no envelope). Since resources may
call **only** `http*` primitives (the class's own stated invariant), Phase 7/8 has no correct way
to serve these ops. This mirrors the `httpPut` situation and warrants the same "add the missing
validated primitive now" fix.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | High | Open | PublicAPI | `src/client/resources/base-resource.ts` (primitive set) | The primitive set has no validated primitive for a **non-paginated, top-level array** GET response. Four real R1 GET operations return bare arrays — `getByMacAddress`, `getDeviceAuditByMacAddress`, `getStdOut`, `getStdErr` (`src/generated/schemas/-v2-device`/`-v2-audit`/`-v2-job`) — that are neither single values (`httpGet`) nor `{pageDetails,<array>}` envelopes (`paginate`). Routing them through `httpGet` with a `z.array(...)` schema runs `parseLenient` over the whole array, so one bad item fails the entire `safeParse` and `validateResponse` **throws** — the wholesale-collection failure R7 exists to prevent, with no per-item drop. Because resources may call only `http*` primitives, Phase 7/8 cannot correctly implement these ops. Same class of gap as the (correctly added) `httpPut`. | Add an array-fetching primitive in this phase, e.g. `protected async httpGetArray<T>(path, itemSchema, context, params?): Promise<T[]>` that does the `axios.get` (tagging `{kind:'read'}`) then delegates to `validateArrayResponse` — giving these bare-array endpoints the same per-item lenient drop `paginate` gives enveloped pages. Add a nock test covering a bad item being dropped without failing the call. |
| architect-r1-f2 | Medium | Open | Security | `src/client/resources/base-resource.ts:387-408` (`paginate`) | `paginate` follows the server-controlled `nextPageUrl` (a fully-qualified absolute URL in the Datto contract — `spec/openapi.json` `PaginationConfiguration.nextPageUrl: string`) by passing it straight to `this.axios.get(url, …)`. Axios treats an absolute URL as authoritative and **ignores `baseURL`**, while the auth interceptor still attaches the Datto bearer token to *whatever host that URL names*. A malicious or compromised upstream response can therefore redirect the credentialed request to an attacker-controlled host (credential exfiltration / SSRF). The strict-cursor validation guards structure, not origin. | Before following, pin the origin: reject (throw `DattoValidationError('response')`) or rewrite any `nextPageUrl` whose scheme+host does not match the configured `apiUrl` — e.g. parse it and reissue as `pathname+search` against the shared `baseURL`, so the token can never leave the configured host. Add a test that a cross-origin `nextPageUrl` is refused. |
| architect-r1-f3 | Medium | Open | Performance | `src/client/resources/base-resource.ts:387-409` (`paginate` walk loop) | The `while (url)` walk has no maximum-page bound and no cycle detection. A server (buggy or hostile) that returns a `nextPageUrl` pointing back to an already-seen page — or an ever-advancing chain — drives an unbounded/infinite loop accumulating into one in-memory `items` array on the single highest-volume read path, an availability/OOM hazard with no escape hatch. | Add a defensive cap (e.g. a `maxPages` guard, or track visited URLs) that throws `DattoValidationError('response')` / a bounded error when exceeded, so a pathological cursor chain fails fast instead of hanging the process. |
| architect-r1-f4 | Medium | Open | PublicAPI | `src/schema-overrides/types.ts:42-53`, `src/schema-overrides/index.ts`, `coerceSchema` at `base-resource.ts:25` | The reconciled `Device`/`Alert` **types** are exported decoupled from their **schemas**: the module exports `deviceResponseSchema` typed by its own `z.infer` (closed enums) and, separately, the widened `Device` type, with nothing binding them. A Phase 7 author writing the plan's own example — `this.httpGet(path, deviceResponseSchema, ctx)` — gets `Promise<{closed-enum device}>`, **not** `Promise<Device>`, silently re-narrowing the public return type to closed enums and reviving the exact compile-time-claims-more-than-runtime hazard R5 exists to kill; the only guard is the author *remembering* to wrap in `coerceSchema<Device>`. Compounding this, `coerceSchema` lives in the client transport layer (`base-resource.ts`), so binding it onto the schema in `schema-overrides` would invert the dependency direction. | Export a ready-to-use, pre-coerced schema value from `schema-overrides` (e.g. `export const deviceSchema: z.ZodType<Device> = deviceResponseSchema as unknown as z.ZodType<Device>` and the `Alert` analogue), so `Promise<Device>` is the path of least resistance and closed-enum narrowing can't happen by omission. Consider relocating the pure-cast `coerceSchema` to `schema-overrides`/a shared util so the correct binding lives with the schemas, not upward in the transport layer. |
| architect-r1-f5 | Low | Open | Maintainability | `docs/implementation/full-api-surface/implementation-phase6-notes.md` §5, §6 Decision 4, §11, §13 | The phase-6 notes are now stale/self-contradictory versus the shipped code: §5 asserts "No other deviations" and §6 Decision 4 states write-body marking is "scoped to `device-udf-set` only, not 'every write body,'" and §13's Final Assertion echoes this — but `src/schema-overrides/write-bodies.ts` reconciles **all** body-carrying write ops (warranty `.nullable()`, both variable creates/updates, proxy). The historian synthesizes from these notes and future readers will treat them as the record. | Update §5/§6/§11/§13 to reflect the shipped scope (all write bodies reconciled; warranty made required-but-nullable) so the notes match the code, or add a closing revision addendum recording the round-2/round-3 expansion. |
