import { z } from "zod";

/**
 * The R3 pagination-cursor override: the `pageDetails` envelope every collection response shares
 * (`{ count, totalCount, prevPageUrl, nextPageUrl }`), validated **strictly on structure** by
 * `BaseResource.paginate` (`../client/resources/base-resource.ts`) — a missing or malformed cursor
 * **throws** `DattoValidationError` and aborts the walk, rather than silently truncating it. A
 * `null` `nextPageUrl` is the normal end-of-walk terminal, not an error.
 *
 * This is deliberately **not** `z.strictObject`: a failed parse here throws and aborts the whole
 * paginated call across every namespace, so rejecting an *unknown* key would hard-fail every list
 * operation the moment Datto adds a benign envelope field (e.g. `pageSize`) — an added field is
 * neither "missing" nor "malformed" (R3's actual triggers) and would contradict the design's
 * response-leniency philosophy. `.catchall(z.unknown())` tolerates an unrecognized extra key while
 * still requiring `count`/`totalCount`/`prevPageUrl`/`nextPageUrl` to be present with the right
 * type — the throw is reserved for those, never for an unknown key.
 *
 * Response leniency (unknown-key strip, null tolerance, enum widening — `parseLenient`,
 * `src/validation/schema-leniency.ts`) governs the *item* payloads a page carries, never this walk
 * cursor: `paginate` validates this schema with a plain `.safeParse`, not `parseLenient`.
 */
export const pageDetailsSchema = z
  .object({
    count: z.number().int(),
    totalCount: z.number().int(),
    prevPageUrl: z.string().nullable(),
    nextPageUrl: z.string().nullable(),
  })
  .catchall(z.unknown());

/** The validated shape `pageDetailsSchema` parses to. */
export type PageDetails = z.infer<typeof pageDetailsSchema>;
