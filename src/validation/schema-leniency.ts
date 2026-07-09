import { z } from "zod";

import { DiagnosticsCollector } from "./diagnostics";

/**
 * Lenient response validation module.
 *
 * Ported from `@pncit/fuze-api`'s `src/validation/schema-leniency.ts` (unknown-key strip +
 * recursive catchall, schema caching, union-branch matching) and extended for the Datto reality
 * (R5, R7):
 *
 * - **Nullability/presence leniency.** The spec carries no reliable presence/nullability
 *   information (design Decision 2), so every named object field — at every nesting depth — is
 *   additionally tolerant of `null` and of being entirely absent on the response path,
 *   regardless of what the (unreliable) spec declared. See `toLenientField`.
 * - **Enum degradation.** A response enum field is widened to accept any string, and an
 *   out-of-set value is recorded as a widening diagnostic rather than failing the item (an
 *   unobserved value must never silently vanish — see `addCatchallRecursive`'s `'enum'` case).
 *   Request bodies are validated by the strict `validateRequest` path (Phase 6), which never
 *   calls `parseLenient`, so enums stay closed on requests automatically.
 * - **Aggregated, leveled diagnostics.** Rather than fuze-api's immediate per-occurrence `warn`,
 *   every diagnostic this module produces is benign (`debug`) and routed through a
 *   `DiagnosticsCollector` (`./diagnostics.ts`) that dedupes and summarizes per `parseLenient`
 *   call — see `detectUnknownProperties`'s module doc for why array element paths deliberately
 *   drop their index to make this aggregation actually collapse across a collection, and for how
 *   each diagnostic's `total` tracks the *enclosing* collection it was found in (not just the
 *   top-level response shape), so an enveloped list response (e.g. `{ pageDetails, devices }`)
 *   still reports `count`/`total` against `devices.length`, not `1`.
 *
 * All Zod v4 internal access is isolated here. No other module should read `_zod.def` directly.
 */

/** Minimal logger interface needed by the lenient parse module. Not exported. */
type LenientParseLogger = {
  readonly debug: (message: string, meta?: Record<string, unknown>) => void;
};

// ---------------------------------------------------------------------------
// Schema transformation cache (module-level, per-node)
// ---------------------------------------------------------------------------

const wrappedSchemaCache = new WeakMap<z.ZodType, z.ZodType>();

// ---------------------------------------------------------------------------
// Internal: Zod v4 def accessor
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Access the Zod v4 internal `def` for a schema.
 * Zod v4 moved `_def` to `_zod.def`.
 */
function getDef(schema: z.ZodType): any {
  return (schema as any)._zod.def;
}

/**
 * Wraps a field's value schema so it independently tolerates `null` and an absent key, on top of
 * whatever leniency `addCatchallRecursive` already applied to it — regardless of what the
 * (unreliable) spec declared for that field's own presence/nullability (R5, design Decision 2:
 * "782 properties with pervasive, data-dependent nullability makes per-field annotation both
 * enormous and perpetually stale; recursive response leniency covers it in one place"). Applied
 * only to named object fields — a record's dynamic values are left to their own declared
 * shape, since "optional" has no clear meaning for an already-dynamic key.
 *
 * **Invariant this relies on:** making every named field independently optional also makes a
 * union branch's own discriminator no longer required by the permissive parse, so a payload
 * matching no branch's real shape will match the first (now effectively all-optional) branch
 * instead of failing. This is sound only because no response schema under `src/generated/schemas/**`
 * declares a `z.union` today (verified by grep; Datto's spec has no `oneOf` response bodies). A
 * future spec refresh or hand-written override (`src/schema-overrides.ts`, Phase 6) that
 * introduces a response union would silently mismatch branches instead of failing — Phase 9's
 * schema-completeness audit should assert `src/generated/schemas/**` stays union-free so this
 * fails loudly if that ever changes.
 */
function toLenientField(fieldSchema: z.ZodType): z.ZodType {
  return fieldSchema.nullable().optional();
}

// ---------------------------------------------------------------------------
// addCatchallRecursive
// ---------------------------------------------------------------------------

/**
 * Recursively walks a Zod schema tree, applying `.catchall(z.unknown())` to every object schema
 * (including inside unions, arrays, records, etc.), widening every enum node to accept any
 * string (R5), and making every named object field tolerate `null`/absent (R5).
 *
 * This transforms strict, spec-derived schemas into permissive ones whose `.safeParse` cannot
 * fail on the specific defects production responses are known to carry: unknown keys, missing
 * nullability, and an enum member the spec hasn't documented yet. `detectUnknownProperties` then
 * walks the *original* (unwrapped) schema in parallel to clean the result and report what was
 * tolerated.
 *
 * Handles both `z.object()` and `z.strictObject()` identically since both share
 * `def.type === 'object'` in Zod v4 -- the branch reconstructs the shape and applies
 * `.catchall(z.unknown())`, overriding any existing catchall.
 */
function addCatchallRecursive(schema: z.ZodType): z.ZodType {
  const cached = wrappedSchemaCache.get(schema);
  if (cached) return cached;

  const def = getDef(schema);
  let result: z.ZodType;

  switch (def.type as string) {
    case "object": {
      const shape = (schema as any).shape as Record<string, z.ZodType>;
      const newShape: Record<string, z.ZodType> = {};
      for (const key of Object.keys(shape)) {
        newShape[key] = toLenientField(addCatchallRecursive(shape[key]!));
      }
      result = z.object(newShape).catchall(z.unknown());
      break;
    }

    case "array": {
      const innerType = def.element as z.ZodType;
      result = z.array(addCatchallRecursive(innerType));
      break;
    }

    case "union": {
      const options = def.options as z.ZodType[];
      const newOptions = options.map((opt) => addCatchallRecursive(opt));
      if (newOptions.length < 2) {
        result = newOptions[0] ?? schema;
        break;
      }
      result = z.union(newOptions as [z.ZodType, z.ZodType, ...z.ZodType[]]);
      break;
    }

    case "optional": {
      const innerType = def.innerType as z.ZodType;
      result = addCatchallRecursive(innerType).optional();
      break;
    }

    case "nullable": {
      const innerType = def.innerType as z.ZodType;
      result = addCatchallRecursive(innerType).nullable();
      break;
    }

    case "record": {
      const { keyType } = def;
      const valueType = def.valueType as z.ZodType;
      result = z.record(keyType as any, addCatchallRecursive(valueType));
      break;
    }

    case "pipe": {
      const inSchema = def.in as z.ZodType;
      const outSchema = def.out as z.ZodType;
      result = addCatchallRecursive(inSchema).pipe(
        addCatchallRecursive(outSchema),
      );
      break;
    }

    case "default": {
      const innerType = def.innerType as z.ZodType;
      const { defaultValue } = def;
      result = addCatchallRecursive(innerType).default(defaultValue);
      break;
    }

    case "enum": {
      // Response-side enum degradation (R5): widen to passthrough so an unobserved member
      // — Datto adding a new device class, alert priority, etc. before this client's spec is
      // refreshed — parses instead of failing the whole item (which, combined with R7's
      // per-item drop, would silently discard the record: the exact `rmmnetworkdevice`
      // regression the design exists to prevent). `detectUnknownProperties` below consults the
      // *original* (un-widened) entries to detect and report when this actually happens.
      const entries = (def.entries ?? {}) as Record<string, string>;
      const values = Object.values(entries);
      result =
        values.length > 0
          ? z.enum(values as [string, ...string[]]).or(z.string())
          : schema;
      break;
    }

    // Terminal types -- return unchanged
    case "string":
    case "number":
    case "boolean":
    case "literal":
    case "null":
    case "unknown":
    case "undefined":
    case "date":
    case "never":
    case "void":
    case "any":
    case "bigint": {
      result = schema;
      break;
    }

    default: {
      // Defensive: unknown schema type -- return unchanged to avoid crashes
      result = schema;
      break;
    }
  }

  wrappedSchemaCache.set(schema, result);
  return result;
}

// ---------------------------------------------------------------------------
// detectUnknownProperties
// ---------------------------------------------------------------------------

/**
 * Walks parsed output and the *original* (non-wrapped) schema in parallel, cleaning the result
 * and recording diagnostics into `diagnostics` (flushed once, summarized, by `parseLenient`
 * itself — see its doc).
 *
 * For objects, compares keys against `schema.shape` to identify and strip unknowns. For an
 * `enum`-typed leaf, checks the parsed string against the *original* schema's declared members
 * and records a widening event when it falls outside them (R5) — the value itself was already
 * accepted by the permissive parse (`addCatchallRecursive`'s `'enum'` case); this pass only
 * detects and reports that it happened, it never rejects or alters the value.
 *
 * **Array element paths intentionally drop the index.** Recursing into an array's elements
 * passes the *same* `path` to every element rather than appending `[i]`, so the same field at
 * the same structural position across many collection items — e.g. every device's `deviceClass`
 * in a page of 848 — shares one diagnostic identity instead of 848 distinct ones. Without this,
 * `parseLenient`'s per-call aggregation (via `DiagnosticsCollector`) could never actually
 * collapse a collection's worth of identical events into the single summarized line the design
 * requires ("widened deviceClass=rmmnetworkdevice on 3/848 devices") — the array index would
 * make every occurrence's key unique. This is the one deliberate divergence from fuze-api's
 * original per-occurrence, index-qualified `path` (which that port logs immediately and has no
 * aggregation step to collapse).
 *
 * **`collectionSize` tracks the *nearest enclosing array*, not the top-level response shape.**
 * It starts at `1` (a bare single-object parse) and is set to `parsed.length` whenever the walk
 * enters an array, then threaded unchanged through every other node type. This makes `total` (see
 * `DiagnosticsCollector.record`) correct for Datto's dominant real response shape — an enveloped
 * list, e.g. `{ pageDetails: {...}, devices: [...848 items] }` — where the array being walked is
 * nested inside an object, not the top-level value: a diagnostic recorded on `devices[i].deviceClass`
 * reports `total: 848` (the `devices` array's length), not `1` (the envelope object's "length").
 *
 * Returns a cleaned copy of the parsed data with unknown properties removed.
 */
function detectUnknownProperties(
  parsed: unknown,
  schema: z.ZodType,
  path: string,
  diagnostics: DiagnosticsCollector,
  collectionSize: number,
): unknown {
  if (parsed === null || parsed === undefined) {
    return parsed;
  }

  const def = getDef(schema);
  const defType = def.type as string;

  switch (defType) {
    case "object": {
      if (typeof parsed !== "object" || Array.isArray(parsed)) {
        return parsed;
      }

      const shape = (schema as any).shape as Record<string, z.ZodType>;
      const shapeKeys = new Set(Object.keys(shape));
      const parsedRecord = parsed as Record<string, unknown>;
      const parsedKeys = Object.keys(parsedRecord);
      const cleaned: Record<string, unknown> = {};

      for (const key of parsedKeys) {
        if (shapeKeys.has(key)) {
          cleaned[key] = detectUnknownProperties(
            parsedRecord[key],
            shape[key]!,
            path ? `${path}.${key}` : key,
            diagnostics,
            collectionSize,
          );
        } else {
          // Deliberately no `value` here (dedup by field only): a stripped key's own value is
          // typically unique per record and would defeat aggregation across a collection if it
          // participated in the dedup key, and fuze-api's own precedent already excludes it
          // from the log line ("prevents log noise and data leakage").
          diagnostics.record(
            "stripped unknown response property",
            path ? `${path}.${key}` : key,
            undefined,
            collectionSize,
          );
        }
      }

      return cleaned;
    }

    case "array": {
      if (!Array.isArray(parsed)) {
        return parsed;
      }

      const elementSchema = def.element as z.ZodType;
      const arraySize = parsed.length;
      return parsed.map((item) =>
        detectUnknownProperties(
          item,
          elementSchema,
          path,
          diagnostics,
          arraySize,
        ),
      );
    }

    case "optional":
    case "nullable": {
      const innerType = def.innerType as z.ZodType;
      return detectUnknownProperties(
        parsed,
        innerType,
        path,
        diagnostics,
        collectionSize,
      );
    }

    case "union": {
      const options = def.options as z.ZodType[];

      if (Array.isArray(parsed)) {
        // Match against array-typed union options
        const arrayOption = options.find(
          (opt: z.ZodType) => getDef(opt).type === "array",
        );
        if (arrayOption) {
          return detectUnknownProperties(
            parsed,
            arrayOption,
            path,
            diagnostics,
            collectionSize,
          );
        }
        return parsed;
      }

      if (typeof parsed === "object" && parsed !== null) {
        const parsedKeys = new Set(
          Object.keys(parsed as Record<string, unknown>),
        );

        // Collect object-typed options and sort by descending shape key count
        // to match the most specific branch first
        const objectOptions = options
          .filter((opt: z.ZodType) => getDef(opt).type === "object")
          .sort(
            (a: z.ZodType, b: z.ZodType) =>
              Object.keys((b as any).shape).length -
              Object.keys((a as any).shape).length,
          );

        for (const option of objectOptions) {
          const optionKeys = Object.keys(
            (option as any).shape as Record<string, z.ZodType>,
          );
          const allKnownPresent = optionKeys.every((k: string) =>
            parsedKeys.has(k),
          );
          if (allKnownPresent) {
            return detectUnknownProperties(
              parsed,
              option,
              path,
              diagnostics,
              collectionSize,
            );
          }
        }

        // Fallback: try record-typed options for object values that didn't
        // match any object branch (e.g., dynamic key-value maps)
        const recordOption = options.find(
          (opt: z.ZodType) => getDef(opt).type === "record",
        );
        if (recordOption) {
          return detectUnknownProperties(
            parsed,
            recordOption,
            path,
            diagnostics,
            collectionSize,
          );
        }
      }

      // Primitive union branches -- no unknown properties to strip
      return parsed;
    }

    case "record": {
      if (typeof parsed !== "object" || Array.isArray(parsed)) {
        return parsed;
      }

      const valueType = def.valueType as z.ZodType;
      const valueDefType = getDef(valueType).type as string;

      // If the value type is a terminal (e.g., z.unknown()), skip recursion
      if (valueDefType === "unknown" || valueDefType === "any") {
        return parsed;
      }

      const parsedRecord = parsed as Record<string, unknown>;
      const cleaned: Record<string, unknown> = {};
      for (const key of Object.keys(parsedRecord)) {
        cleaned[key] = detectUnknownProperties(
          parsedRecord[key],
          valueType,
          path ? `${path}.${key}` : key,
          diagnostics,
          collectionSize,
        );
      }
      return cleaned;
    }

    case "pipe": {
      // Recurse using the output schema since parsed data has been
      // transformed through the pipe
      const outSchema = def.out as z.ZodType;
      return detectUnknownProperties(
        parsed,
        outSchema,
        path,
        diagnostics,
        collectionSize,
      );
    }

    case "default": {
      // Unwrap to inner type, same as optional/nullable
      const innerType = def.innerType as z.ZodType;
      return detectUnknownProperties(
        parsed,
        innerType,
        path,
        diagnostics,
        collectionSize,
      );
    }

    case "enum": {
      // Response-side enum-widening detection (R5): the permissive parse already accepted
      // `parsed` regardless of membership (see `addCatchallRecursive`'s `'enum'` case); this
      // only detects and records when it fell outside the *original* schema's declared set, it
      // never rejects or rewrites the value.
      if (typeof parsed === "string") {
        const entries = (def.entries ?? {}) as Record<string, string>;
        const allowed = new Set(Object.values(entries));
        if (!allowed.has(parsed)) {
          diagnostics.record(
            "widened response enum",
            path,
            parsed,
            collectionSize,
          );
        }
      }
      return parsed;
    }

    // Terminal types: string, number, boolean, literal, null, unknown, etc.
    default: {
      return parsed;
    }
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// enumFieldPaths
// ---------------------------------------------------------------------------

/**
 * Returns the dotted path of every `enum`-typed node in `schema`, at every nesting depth (e.g.
 * `['deviceClass', 'antivirus.antivirusStatus', 'patchManagement.patchStatus']`).
 *
 * Reuses the same schema-tree walk as `addCatchallRecursive`/`detectUnknownProperties` (object
 * keys, array elements, union options, optional/nullable/record/pipe/default unwrapping), but
 * over the *original* schema rather than data — so, like `detectUnknownProperties`, an array
 * element contributes no path segment of its own (a schema has no index to contribute). Confines
 * this additional `_zod.def` introspection to this one file (per the module doc's isolation
 * rule) rather than adding a second parallel site in Phase 9's completeness-guard test code,
 * which imports this helper directly.
 */
export function enumFieldPaths(schema: z.ZodType): string[] {
  const paths = new Set<string>();
  walk(schema, "", new Set<z.ZodType>());
  return [...paths].sort();

  /* eslint-disable @typescript-eslint/no-explicit-any */
  function walk(node: z.ZodType, path: string, visiting: Set<z.ZodType>): void {
    if (visiting.has(node)) return; // cycle guard (defensive; Datto's schemas are not recursive)
    visiting.add(node);
    try {
      const def = getDef(node);
      switch (def.type as string) {
        case "object": {
          const shape = (node as any).shape as Record<string, z.ZodType>;
          for (const key of Object.keys(shape)) {
            walk(shape[key]!, path ? `${path}.${key}` : key, visiting);
          }
          break;
        }
        case "array": {
          walk(def.element as z.ZodType, path, visiting);
          break;
        }
        case "union": {
          for (const opt of def.options as z.ZodType[])
            walk(opt, path, visiting);
          break;
        }
        case "optional":
        case "nullable": {
          walk(def.innerType as z.ZodType, path, visiting);
          break;
        }
        case "record": {
          walk(def.valueType as z.ZodType, path, visiting);
          break;
        }
        case "pipe": {
          walk(def.out as z.ZodType, path, visiting);
          break;
        }
        case "default": {
          walk(def.innerType as z.ZodType, path, visiting);
          break;
        }
        case "enum": {
          if (path) paths.add(path);
          break;
        }
        default:
          break;
      }
    } finally {
      visiting.delete(node);
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

// ---------------------------------------------------------------------------
// parseLenient (public API)
// ---------------------------------------------------------------------------

/**
 * Leniently parses data against a Zod schema, tolerating the response-side defects production
 * Datto RMM traffic is known to exhibit: unknown keys (stripped), missing nullability (any named
 * field tolerates `null`/absent), and an undocumented enum member (widened to passthrough) — R5,
 * R7. Every tolerated occurrence is aggregated and reported as one summarized `debug` line per
 * `(field, value?)` via `DiagnosticsCollector`, not logged per occurrence (see
 * `detectUnknownProperties`'s doc for why array element paths drop their index to make this
 * aggregation actually collapse, and for how each diagnostic's `total` tracks the collection it
 * was actually found in).
 *
 * **The `logger` argument gates all three leniency behaviors, not just diagnostics.** When no
 * logger is provided, this delegates directly to `schema.safeParse(data)` — the original, *strict*
 * schema — for zero overhead; null tolerance, presence tolerance, and enum degradation are then
 * **not applied**, so a response carrying an undocumented enum member or an unexpectedly-null
 * field fails validation exactly as it would without this module. This mirrors fuze-api's own
 * ported precedent (`schema.safeParse(data)` on the unwrapped schema when `logger` is falsy) and
 * is safe in practice only because every real call site (`BaseResource`, Phase 6) always
 * constructs its resources with the client's always-present `DattoLogger` and therefore always
 * passes one — `parseLenient` itself does not and cannot enforce that; treat `logger` as
 * effectively required for any response actually reaching production traffic, optional only for
 * lightweight/no-diagnostics callers (e.g. this module's own "matches safeParse exactly" tests).
 * When a logger *is* present, this wraps the schema to preserve unknown properties and tolerate
 * null/absent + open enums during parsing, then runs a detection pass to clean and diagnose,
 * returning a clean result.
 *
 * @param schema - The Zod schema to validate against
 * @param data - The raw data to parse
 * @param logger - Logger with a `debug` method for reporting leniency diagnostics. Optional only
 *   for callers that intentionally want strict, non-degrading `safeParse` behavior — see above.
 * @param context - Optional context string identifying the endpoint/stage (e.g., 'GET /device/{uid}')
 * @returns A Zod ZodSafeParseResult with unknown properties stripped from successful results
 */
export function parseLenient<T>(
  schema: z.ZodType<T>,
  data: unknown,
  logger?: LenientParseLogger,
  context?: string,
): z.ZodSafeParseResult<T> {
  if (!logger) {
    return schema.safeParse(data);
  }

  const wrapped = addCatchallRecursive(schema);
  const result = wrapped.safeParse(data);

  if (!result.success) {
    return result as z.ZodSafeParseResult<T>;
  }

  const diagnostics = new DiagnosticsCollector();
  const cleaned = detectUnknownProperties(
    result.data,
    schema,
    "",
    diagnostics,
    1,
  );

  diagnostics.flush(
    (message, meta) => logger.debug(message, meta),
    context ?? "(unknown)",
  );

  return { success: true, data: cleaned as T };
}
