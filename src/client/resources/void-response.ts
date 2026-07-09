import { z } from "zod";

/**
 * Response schema for a write whose real Datto endpoint declares no success response body at
 * all (verified directly against `spec/openapi.json`: either no 2xx response object at all —
 * `POST /alert/{uid}/resolve`, `PUT /device/{uid}/site/{siteUid}` — or a 2xx with no `content` —
 * `PUT /account/variable`, `POST /account/variable/{variableId}`, and their site-scoped
 * counterparts).
 *
 * **`z.void()` cannot validate a real empty HTTP response — confirmed, not assumed.** `z.void()`
 * only accepts an actual `undefined` value, but axios's real wire behavior for a genuinely empty
 * response body is the empty string `""`, not `undefined` (verified directly: a `nock`-mocked
 * `.reply(200)` with no body resolves `response.data` to `""`, exercising axios's own default
 * JSON-response transform on an unparseable empty body). Validating a real empty response
 * against `z.void()` would therefore fail every one of these writes in production, not just in a
 * test — this is a defect in the plan's own illustrative `z.void()` snippet (Phase 7 "Opinionated
 * Implementation Notes"), corrected here since this phase is the first to actually exercise a
 * bodiless-response write's response validation against a real (nock-mocked) HTTP transport.
 *
 * `z.unknown()` accepts whatever the server actually sends back for a write this client does not
 * model a response for (an empty string today; conceivably a stray `{}` from a future server
 * change) without failing the call. The resource method's own declared `Promise<void>` return
 * type — not this schema — is what tells a caller there is nothing useful in the response; every
 * method that uses this schema discards the resolved value rather than returning it.
 */
export const voidResponseSchema = z.unknown();
