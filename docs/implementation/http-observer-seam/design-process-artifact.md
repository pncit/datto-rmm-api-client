# HTTP Observer Seam — Design Process Artifact

_This cycle designed a transport-agnostic HTTP observer seam that restores, for the 1.0.x client, the raw per-exchange observability that 0.1.x consumers lost — without reopening axios injection._

## Genesis

The 1.0.x rewrite deliberately took ownership of the HTTP transport: the client constructs its
own axios instances, wires authentication, rate limiting, retry, and pagination into them, and the
strict config schema hard-rejects a caller-supplied `axiosInstance`. That isolation was a correct
decision, but it removed a capability some 0.1.x consumers depended on. In 0.1.x a consumer could
inject an axios instance and register interceptors to emit a redacted observability artifact for
every Datto RMM HTTP exchange — request/response URL, headers, body, status, duration, and error —
into a compliance/audit pipeline, including the internal OAuth token-grant call (whose form body
carries the API key) and every pagination page.

In 1.0.x there was no supported way to observe HTTP exchanges at all: the only observability
surface, `DattoLogger`, is deliberately body/header-free and UDF-masked, so it cannot carry the raw
payloads an audit artifact needs. A consumer with a compliance obligation to record every outbound
exchange therefore could not adopt 1.0.x without forking the transport or staying on 0.1.x — both of
which forfeit the isolation the rewrite was built to provide. This design set out to close that gap.

## Outcome

The design adds an optional `httpObserver` to `DattoRmmClientConfig`: a `DattoHttpObserver` object
with three independently-optional pure-observer callbacks — `onRequest`, `onResponse`, `onError` —
each firing once per physical HTTP attempt with a structured, raw (un-redacted) payload of the
request, the response or mapped error, and the wire duration. The axios instances stay entirely
internal; auth, rate limiting, retry, and pagination are unchanged, and axios appears nowhere in the
public type contract. The seam is instrumented at two layers — the shared instance (via an
interceptor) and the bare OAuth grant client (at its `performRefresh` call site) — routed through a
single internal helper (`src/http/observer.ts`) so the two sites cannot drift. Delivery is raw and
explicitly exempt from the logger's UDF-masking boundary; the consumer owns all redaction. The
change is purely additive with no breaking changes.

The public surface settles at **five** exported types: `DattoHttpObserver`, the three named payload
types (`DattoHttpRequestEvent` / `DattoHttpResponseEvent` / `DattoHttpErrorEvent`), and the shared
`DattoHttpHeaders` alias.

The living design is `docs/implementation/http-observer-seam/design.md`.

## Process at a glance

Six review rounds on the design itself (every remedy a direct edit to `design.md`; no upstream doc
to amend). Three reviewers contributed: a **design-auditor** (rounds 1–3, focused on current-state
accuracy and contract consistency), an **engineer** (rounds 1–5, feasibility and terminal-event
mechanics), and an **architect** (rounds 1–5, public API surface and implementation structure). A
mediator triaged each round. Every finding was routed `Remediate` and applied by the reviser; no
finding was challenged, none required a binding ruling, and nothing was escalated to a human. The
work converged from substantive mechanism gaps in the early rounds down to single-sentence prose
tightening by round 6.

## Key findings

The findings clustered into a few themes, resolved in order of depth.

- **Under-specified capture mechanism (rounds 1, 3).** The design asserted the *properties* of the
  observation point ("fires after auth and after throttle"; request fields at wire fidelity) without
  the *mechanism* that makes them true. Two mechanics were pinned: (1) the observer's request
  interceptor must be registered **first** in `createHttpClient` so that, under axios's LIFO ordering,
  it runs **last** — after the rate-limit interceptor and after the Bearer interceptor that
  `AuthManager.attachTo` registers later from a separate module; and (2) `onRequest` must **capture
  and stash** method/URL/headers/body plus the dispatch timestamp on per-attempt internal state
  (the existing `rateDescriptor`/`axios-augment.d.ts` precedent), because by the terminal event axios
  has already serialized the body and normalized the headers, so re-reading `response.config` would
  diverge from what `onRequest` observed. The engineer later located the two response-side terminal
  events onto concrete slots: `onResponse` fires from the fulfilled `(response) => response` handler,
  `onError` from the rejected `handleResponseError`.

- **Body-form and header-fidelity contract stated inconsistently (round 1).** R5 was internally
  contradictory for JSON ("wire form" vs "the object"). It was reworded to two unambiguous cases:
  form/urlencoded (the grant) is delivered as the serialized string; JSON requests as the
  pre-serialization object; JSON responses as the parsed object — never pre-redacted. The grant's
  `Authorization: Basic` header (the non-secret `public-client:public` pair, applied by axios
  internally) was documented as absent-by-design from the captured header map, with the
  security-relevant API key riding in the captured body; this caveat was moved from the Risks table
  into the contract definition itself.

- **Terminal-event selection across non-standard paths (rounds 2, 3).** Several failure paths did
  not fit a naive "fire `onError` on any throw" model. Decision 4 was tightened so terminal selection
  keys on the **HTTP status of the physical response**, not on whether the surrounding method later
  throws. Two post-2xx failures were carved out as non-firing (the attempt already fired
  `onResponse`): `BaseResource`'s `DattoValidationError`, and the grant's malformed-token
  `DattoApiError` thrown by `performRefresh` after a 2xx token POST. Separately, the shared-instance
  `onError` gate was restated as a *mechanism* — it fires only for an attempt that reached dispatch
  (whose stash was written), realized by placing the call after the `!axios.isAxiosError` rethrow
  guard — after the engineer showed a **second** non-dispatched path beyond the rate-limiter
  rejection: the Bearer interceptor's `getToken()` can throw a `DattoApiError` on lazy-refresh
  failure, which must not double-report as a spurious shared-instance `onError`.

- **Public surface and shared implementation (round 3).** The payloads were originally anonymous
  inline types, making the "payload types are exported" criterion unachievable; they were named and
  exported. The two instrumentation sites, which must reproduce identical header normalization,
  capture-and-stash, and swallow behavior, were given a single named internal helper
  (`src/http/observer.ts`) to prevent drift. The stash's per-pass overwrite invariant was pinned:
  retries reuse the same config object, so the stash must be **unconditionally overwritten on every
  interceptor pass**, or attempt N+1 would report attempt N's stale fields, breaking per-attempt
  fidelity (R2).

- **Observer isolation contract (round 3).** R7 said the callback return value was "ignored (never
  awaited)," contradicting the promise to swallow an accidentally-async callback's rejection. It was
  tightened: the return value is not awaited, but a thenable return gets an unawaited `.catch` that
  logs once at `warn` and swallows — so neither a synchronous `throw` nor an async rejection can
  propagate or delay the request.

- **Optional-callback decoupling (round 5).** Because all three callbacks are independently optional,
  the engineer showed the capture-and-stash could not be narrated as a side-effect of `onRequest`:
  an `onError`-only consumer would otherwise get empty request fields, or — under the literal
  "stash exists" gate — no terminal `onError` at all. Decision 5 was reframed so the stash is written
  at dispatch whenever `httpObserver` is present, independent of which callbacks are supplied, and the
  rule-2 gate was re-keyed to "reached dispatch (stash written)."

## Key decisions

- **An observer seam, not instance or interceptor injection.** Three pure-observer callbacks under
  `httpObserver` deliver a structured, transport-agnostic payload. Reinstating `axiosInstance`
  injection and accepting caller-supplied interceptors were both rejected: they re-couple consumers to
  axios and let them clobber the auth/rate-limit/retry wiring the client exists to guarantee — the
  exact regression 1.0.x removed, and not what the consumer asked for. Extending `DattoLogger` to
  carry bodies was rejected as it would break its masking guarantee.

- **Instrument both transport layers.** Because the grant call runs on a bare client carrying none of
  the shared instance's interceptors, a single shared-instance interceptor could never observe it
  (R3). Each layer is instrumented where it already knows the attempt boundary, elapsed time, and
  mapped `DattoApiError`. A single internal helper backs both sites (the architect's fix) so they
  cannot diverge.

- **`onError.error` is always a mapped `DattoApiError`.** The consumer proposed `error: unknown`; the
  design chose the stronger concrete type, since every HTTP-attempt failure the client acts on is
  already mapped to a `DattoApiError` before use, and a *structured* artifact is the seam's whole
  value. `DattoValidationError` was deliberately excluded from the type because it is a post-exchange,
  non-HTTP failure outside the seam's scope. The honest guarantee has an accepted cost: a mapped
  `DattoApiError` must be constructed even on retried attempts the client swallows — paid on the
  already-slow retry path.

- **Raw delivery, exempt from masking.** Unlike the logger, the observer is not UDF-masked and the
  client redacts nothing — including bearer tokens and the grant-body API key. This is a conscious,
  documented divergence: the consumer's redactor operates on raw wire data and owns all redaction, so
  any client-side masking would corrupt the fidelity it depends on. Partial client-side redaction was
  rejected as riskier than raw delivery under a clear contract.

- **`DattoHttpHeaders` exported (Option A).** When the header alias was found referenced by name in
  every public event field but absent from the export set, the reviser chose to export it (making the
  count "five") rather than inline the `Record<…>` form — consistent with the design's own rationale
  for exporting the named payloads: give a consumer an importable name to annotate a standalone helper.

- **Decision 4 restructured for scannability (round 4).** Three rounds of correct remediations had
  accreted into Decision 4 as a ~600-word rationale wall with the load-bearing gate rule buried and
  the grant carve-outs restated near-verbatim across four sites. The architect and engineer converged
  on the same defect from different axes; the fix moved the gate rules into a scannable numbered list
  in the Decision block, trimmed the rationale to *why*, and reduced satellite sites to
  cross-references — a structure-only edit that the triage chain-watch guarded against silent rule
  loss. A final phrasing residue (round 6) recast one negative clause as a property of the gate rather
  than of a non-existent attempt class.

## Known limitations

- **Deferred capabilities, out of scope by design.** Correlation/attempt identifiers on the payload
  (to stitch retries of one logical operation together) and a bundled default redactor were both
  deferred: the current consumer's artifact is per-attempt and self-contained, and it explicitly wants
  raw delivery and redacts on its own side. Both are recorded as future considerations to revisit on
  concrete demand.

- **Accepted header caveat.** The grant call's `Authorization: Basic` header is absent by design from
  the captured header map (axios applies it internally from the per-request `auth:` option). This is
  accepted because the header is the non-secret `public-client:public` pair and the security-relevant
  API key is captured faithfully in the body. It is documented in the contract and carries a test
  assertion.

- No findings were escalated and no rulings were issued in any round; the design converged with all
  findings resolved.
