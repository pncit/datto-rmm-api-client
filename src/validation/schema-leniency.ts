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
 *   call — see `cleanAndDiagnoseResponse`'s doc for why array element paths deliberately drop
 *   their index to make this aggregation actually collapse across a collection, and for how each
 *   diagnostic's `total` is resolved against the number of items actually examined at that
 *   field's structural position, accumulated across every iteration of every array that feeds it
 *   — including one nested inside another (e.g. `alerts[i].responseActions[j].actionType`) — not
 *   just the size of the nearest single array or the top-level response shape.
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
 * The minimal shape this module relies on out of Zod v4's untyped internal `_zod.def`. Every
 * property beyond `type` still needs its own explicit cast at the call site (there are too many
 * node-kind-specific shapes to model precisely here), but a renamed/missing property now
 * surfaces as `undefined` through a typed, `unknown`-based path instead of compiling silently
 * through a bare `any`.
 */
type ZodInternalDef = { readonly type: string } & Record<string, unknown>;

/**
 * Access the Zod v4 internal `def` for a schema.
 * Zod v4 moved `_def` to `_zod.def`.
 */
function getDef(schema: z.ZodType): ZodInternalDef {
  return (schema as any)._zod.def;
}

/** A named object schema's field shape. Zod v4 exposes this as `.shape`, not through `_zod.def`. */
function objectShape(schema: z.ZodType): Record<string, z.ZodType> {
  return (schema as any).shape as Record<string, z.ZodType>;
}

/**
 * A named object schema's own **meaningful** `.catchall(...)` value schema, if one was declared —
 * `undefined` for a plain `z.object()` with none, and (critically) also `undefined` for
 * `z.strictObject()`. Zod v4 gives every object node a `_zod.def.catchall`, alongside `.shape`
 * (see {@link objectShape}) — but `z.strictObject()`'s is a `ZodNever` (`.catchall(z.never())`
 * under the hood, confirmed directly against zod v4's runtime `_zod.def`), which *means* "no
 * extra key is ever valid here," the opposite of "preserve an extra key." Treating a `never`
 * catchall as meaningful would silently start preserving unknown keys on every one of this
 * project's `zod.strictObject(...)` write-body schemas (`src/generated/schemas/**`) — those
 * never reach this function today (request validation runs plain `.safeParse`, not
 * `parseLenient`), but the helper is still named and typed to be correct standalone, not correct
 * only by the accident of its current one caller. A real, hand-declared `.catchall(z.unknown())`
 * (or any other non-`never` value schema) is the only case this returns non-`undefined` for.
 *
 * Consulted only by {@link cleanAndDiagnoseResponse}'s `'object'` case, over the *original*
 * (un-widened) schema a resource actually declared — e.g. `alertContextSchema`/`pageDetailsSchema`
 * (`src/schema-overrides/**`), each hand-written with an explicit `.catchall(z.unknown())` so a
 * real, undocumented extra key (a `@class`-specific alert-context field; a future benign
 * `pageDetails` addition) is accepted rather than rejected. `addCatchallRecursive` already forces
 * *every* object node's *wrapped* (permissive-parse) copy to carry `.catchall(z.unknown())`
 * regardless of what the original declared, purely so `.safeParse` cannot fail on an unknown key
 * — that wrapped copy is never what this function reads.
 */
function objectCatchall(schema: z.ZodType): z.ZodType | undefined {
  const catchall = (schema as any)._zod.def.catchall as z.ZodType | undefined;
  return catchall && getDef(catchall).type !== "never" ? catchall : undefined;
}

/**
 * The child schema(s) (and any other per-kind payload) each recognized `_zod.def` node kind
 * carries, keyed by kind-specific slot name — `undefined` slots simply don't apply to whichever
 * kind was passed in. This is the single place the zod-internal property name that holds each
 * kind's children (`element`, `options`, `innerType`, `valueType`/`keyType`, `in`/`out`,
 * `entries`) is read: `addCatchallRecursive`, `cleanAndDiagnoseResponse`, and `enumFieldPaths`'s
 * `walk` all navigate a node's children through this rather than each repeating the same
 * property-name lookups, so a Zod-internal rename or a new node kind needs updating in exactly
 * one place, not three.
 */
function nodeChildren(def: ZodInternalDef): {
  element?: z.ZodType;
  options?: z.ZodType[];
  innerType?: z.ZodType;
  valueType?: z.ZodType;
  keyType?: unknown;
  pipeIn?: z.ZodType;
  pipeOut?: z.ZodType;
  defaultValue?: unknown;
  enumValues?: string[];
} {
  switch (def.type) {
    case "array":
      return { element: def.element as z.ZodType };
    case "union":
      return { options: def.options as z.ZodType[] };
    case "optional":
    case "nullable":
      return { innerType: def.innerType as z.ZodType };
    case "default":
      return {
        innerType: def.innerType as z.ZodType,
        defaultValue: def.defaultValue,
      };
    case "record":
      return {
        valueType: def.valueType as z.ZodType,
        keyType: def.keyType,
      };
    case "pipe":
      return { pipeIn: def.in as z.ZodType, pipeOut: def.out as z.ZodType };
    case "enum":
      return {
        enumValues: Object.values(
          (def.entries ?? {}) as Record<string, string>,
        ),
      };
    default:
      return {};
  }
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
 * declares a `z.union` today. That invariant is not just a one-time verified assumption: it is
 * enforced by `tests/generated/schema-union-freedom.test.ts`, which scans every generated
 * `*.zod.ts` file for `zod.union(`/`zod.discriminatedUnion(` and fails the build the moment a
 * future spec refresh or hand-written override (`src/schema-overrides.ts`, Phase 6) introduces
 * one — at which point this function's blanket approach needs revisiting for that schema.
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
 * nullability, and an enum member the spec hasn't documented yet. `cleanAndDiagnoseResponse` then
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

  switch (def.type) {
    case "object": {
      const shape = objectShape(schema);
      const newShape: Record<string, z.ZodType> = {};
      for (const key of Object.keys(shape)) {
        newShape[key] = toLenientField(addCatchallRecursive(shape[key]!));
      }
      result = z.object(newShape).catchall(z.unknown());
      break;
    }

    case "array": {
      const { element } = nodeChildren(def);
      result = z.array(addCatchallRecursive(element!));
      break;
    }

    case "union": {
      const { options = [] } = nodeChildren(def);
      const newOptions = options.map((opt) => addCatchallRecursive(opt));
      if (newOptions.length < 2) {
        result = newOptions[0] ?? schema;
        break;
      }
      result = z.union(newOptions as [z.ZodType, z.ZodType, ...z.ZodType[]]);
      break;
    }

    case "optional": {
      const { innerType } = nodeChildren(def);
      result = addCatchallRecursive(innerType!).optional();
      break;
    }

    case "nullable": {
      const { innerType } = nodeChildren(def);
      result = addCatchallRecursive(innerType!).nullable();
      break;
    }

    case "record": {
      const { keyType, valueType } = nodeChildren(def);
      result = z.record(keyType as any, addCatchallRecursive(valueType!));
      break;
    }

    case "pipe": {
      const { pipeIn, pipeOut } = nodeChildren(def);
      result = addCatchallRecursive(pipeIn!).pipe(
        addCatchallRecursive(pipeOut!),
      );
      break;
    }

    case "default": {
      const { innerType, defaultValue } = nodeChildren(def);
      result = addCatchallRecursive(innerType!).default(defaultValue);
      break;
    }

    case "enum": {
      // Response-side enum degradation (R5): widen to passthrough so an unobserved member
      // — Datto adding a new device class, alert priority, etc. before this client's spec is
      // refreshed — parses instead of failing the whole item (which, combined with R7's
      // per-item drop, would silently discard the record: the exact `rmmnetworkdevice`
      // regression the design exists to prevent). `cleanAndDiagnoseResponse` below consults the
      // *original* (un-widened) entries to detect and report when this actually happens.
      const { enumValues = [] } = nodeChildren(def);
      result =
        enumValues.length > 0
          ? z.enum(enumValues as [string, ...string[]]).or(z.string())
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

    // A `.transform()` step, typically the `in` side of a `.pipe()` (e.g. a hand-written
    // coercion override composing `z.string().transform(JSON.parse).pipe(...)`). Its own
    // transform function isn't independently walkable, and the schema this module actually
    // needs to clean/widen is the pipe's `out` side, not this node -- treated as opaque and
    // returned unchanged, like the terminals above.
    case "transform": {
      result = schema;
      break;
    }

    default: {
      // An unrecognized `_zod.def` node kind reaching here means a Zod-internal shape drift or a
      // newly-generated schema shape this module has never seen — silently returning it
      // unchanged would disable catchall-stripping, nullability leniency, and enum widening for
      // that entire subtree with zero signal. Fail loudly instead so it surfaces in whatever
      // test (or, worst case, request) first exercises it, rather than quietly degrading R5/R7
      // coverage in production.
      throw new Error(
        `schema-leniency: unrecognized zod schema node type "${def.type}" -- add a case for it to addCatchallRecursive`,
      );
    }
  }

  wrappedSchemaCache.set(schema, result);
  return result;
}

// ---------------------------------------------------------------------------
// cleanAndDiagnoseResponse
// ---------------------------------------------------------------------------

/**
 * Walks parsed output and the *original* (non-wrapped) schema in parallel, cleaning the result
 * and recording diagnostics into `diagnostics` (flushed once, summarized, by `parseLenient`
 * itself — see its doc). Returns a cleaned copy of the parsed data with unknown properties
 * removed.
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
 * **`collectionKey` identifies the nearest enclosing array's own structural path**, not a
 * snapshotted size. It is `undefined` until the walk first enters an array, at which point it
 * becomes that array's own `path` — the same string every element of that array shares (since,
 * per the point above, elements carry no index of their own) — and is threaded unchanged through
 * every other node type until a nested array replaces it with *its* path. `DiagnosticsCollector`
 * resolves each occurrence's `total` from this key lazily, at `flush()` time via `trackExamined`
 * (see `parseLenient`'s call into the `array` case below), by which point every element of every
 * array sharing that key — including every outer iteration that repeats a nested array, e.g.
 * `alerts[i].responseActions` for every `i` — has been visited and its length accumulated. This
 * is what makes `total` correct even for a diagnostic recorded beneath *two* enclosing arrays
 * (e.g. `alerts.responseActions.actionType`): each alert's `responseActions` visit adds that
 * alert's own count into the running total for the `alerts.responseActions` key, so the final
 * total is the number of `responseActions` objects examined across the whole page, not just the
 * length of whichever alert's array happened to be walked last. `undefined` denotes "no
 * enclosing array at all" (a bare single-object parse), which resolves to a total of `1`.
 */
function cleanAndDiagnoseResponse(
  parsed: unknown,
  schema: z.ZodType,
  path: string,
  diagnostics: DiagnosticsCollector,
  collectionKey: string | undefined,
): unknown {
  if (parsed === null || parsed === undefined) {
    return parsed;
  }

  const def = getDef(schema);

  switch (def.type) {
    case "object": {
      if (typeof parsed !== "object" || Array.isArray(parsed)) {
        return parsed;
      }

      const shape = objectShape(schema);
      const shapeKeys = new Set(Object.keys(shape));
      const catchall = objectCatchall(schema);
      const parsedRecord = parsed as Record<string, unknown>;
      const parsedKeys = Object.keys(parsedRecord);
      const cleaned: Record<string, unknown> = {};

      for (const key of parsedKeys) {
        if (shapeKeys.has(key)) {
          cleaned[key] = cleanAndDiagnoseResponse(
            parsedRecord[key],
            shape[key]!,
            path ? `${path}.${key}` : key,
            diagnostics,
            collectionKey,
          );
        } else if (catchall) {
          // The *original* schema declared its own `.catchall(...)` (e.g. `alertContextSchema`,
          // `pageDetailsSchema` — src/schema-overrides/**) — an explicit, hand-written signal
          // that an undocumented extra key here is expected and meaningful, not noise. Keep it
          // (recursively cleaned against the catchall's own value schema) rather than stripping
          // it as if it were unknown; this is what actually delivers R8's "an alert's real
          // context fields survive validation" guarantee end-to-end through `parseLenient`, not
          // just through the catchall schema's own un-cleaned `.safeParse`.
          cleaned[key] = cleanAndDiagnoseResponse(
            parsedRecord[key],
            catchall,
            path ? `${path}.${key}` : key,
            diagnostics,
            collectionKey,
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
            collectionKey,
          );
        }
      }

      return cleaned;
    }

    case "array": {
      if (!Array.isArray(parsed)) {
        return parsed;
      }

      const { element } = nodeChildren(def);
      diagnostics.trackExamined(path, parsed.length);
      return parsed.map((item) =>
        cleanAndDiagnoseResponse(item, element!, path, diagnostics, path),
      );
    }

    case "optional":
    case "nullable": {
      const { innerType } = nodeChildren(def);
      return cleanAndDiagnoseResponse(
        parsed,
        innerType!,
        path,
        diagnostics,
        collectionKey,
      );
    }

    case "union": {
      const { options = [] } = nodeChildren(def);

      if (Array.isArray(parsed)) {
        // Match against array-typed union options
        const arrayOption = options.find(
          (opt: z.ZodType) => getDef(opt).type === "array",
        );
        if (arrayOption) {
          return cleanAndDiagnoseResponse(
            parsed,
            arrayOption,
            path,
            diagnostics,
            collectionKey,
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
              Object.keys(objectShape(b)).length -
              Object.keys(objectShape(a)).length,
          );

        for (const option of objectOptions) {
          const optionKeys = Object.keys(objectShape(option));
          const allKnownPresent = optionKeys.every((k: string) =>
            parsedKeys.has(k),
          );
          if (allKnownPresent) {
            return cleanAndDiagnoseResponse(
              parsed,
              option,
              path,
              diagnostics,
              collectionKey,
            );
          }
        }

        // Fallback: try record-typed options for object values that didn't
        // match any object branch (e.g., dynamic key-value maps)
        const recordOption = options.find(
          (opt: z.ZodType) => getDef(opt).type === "record",
        );
        if (recordOption) {
          return cleanAndDiagnoseResponse(
            parsed,
            recordOption,
            path,
            diagnostics,
            collectionKey,
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

      const { valueType } = nodeChildren(def);
      const valueDefType = getDef(valueType!).type;

      // If the value type is a terminal (e.g., z.unknown()), skip recursion
      if (valueDefType === "unknown" || valueDefType === "any") {
        return parsed;
      }

      const parsedRecord = parsed as Record<string, unknown>;
      const cleaned: Record<string, unknown> = {};
      for (const key of Object.keys(parsedRecord)) {
        cleaned[key] = cleanAndDiagnoseResponse(
          parsedRecord[key],
          valueType!,
          path ? `${path}.${key}` : key,
          diagnostics,
          collectionKey,
        );
      }
      return cleaned;
    }

    case "pipe": {
      // Recurse using the output schema since parsed data has been
      // transformed through the pipe
      const { pipeOut } = nodeChildren(def);
      return cleanAndDiagnoseResponse(
        parsed,
        pipeOut!,
        path,
        diagnostics,
        collectionKey,
      );
    }

    case "default": {
      // Unwrap to inner type, same as optional/nullable
      const { innerType } = nodeChildren(def);
      return cleanAndDiagnoseResponse(
        parsed,
        innerType!,
        path,
        diagnostics,
        collectionKey,
      );
    }

    case "enum": {
      // Response-side enum-widening detection (R5): the permissive parse already accepted
      // `parsed` regardless of membership (see `addCatchallRecursive`'s `'enum'` case); this
      // only detects and records when it fell outside the *original* schema's declared set, it
      // never rejects or rewrites the value.
      if (typeof parsed === "string") {
        const { enumValues = [] } = nodeChildren(def);
        const allowed = new Set(enumValues);
        if (!allowed.has(parsed)) {
          diagnostics.record(
            "widened response enum",
            path,
            parsed,
            collectionKey,
          );
        }
      }
      return parsed;
    }

    // Terminal types: string, number, boolean, literal, null, unknown, etc.
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
      return parsed;
    }

    // A `.transform()` step reached directly (not via `pipe`'s `pipeOut` recursion above -- see
    // that case). A bare `z.string().transform(fn)` is itself a `ZodPipe` whose `out` side is a
    // `ZodTransform` node (`def.type === "transform"`), so the `pipe` case's recursion into
    // `pipeOut` can land here for a schema that pipes straight into a transform rather than into
    // an object. Mirrors `addCatchallRecursive`'s identical `'transform'` terminal case: the node
    // carries no shape to clean or diagnose, so `parsed` is returned unchanged, opaque, exactly
    // like the terminals above -- not routed to the throwing `default` below.
    case "transform": {
      return parsed;
    }

    default: {
      // See addCatchallRecursive's identical default case: an unrecognized node kind here means
      // this pass would silently skip cleaning/diagnosing that entire subtree. Fail loudly.
      throw new Error(
        `schema-leniency: unrecognized zod schema node type "${def.type}" -- add a case for it to cleanAndDiagnoseResponse`,
      );
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
 * Reuses the same schema-tree navigation as `addCatchallRecursive`/`cleanAndDiagnoseResponse`
 * (object keys via `objectShape`, and array/union/optional/nullable/record/pipe/default children
 * via `nodeChildren`), but over the *original* schema rather than data — so, like
 * `cleanAndDiagnoseResponse`, an array element contributes no path segment of its own (a schema
 * has no index to contribute). Confines this additional `_zod.def` introspection to this one
 * file (per the module doc's isolation rule) rather than adding a second parallel site in
 * Phase 9's completeness-guard test code, which imports this helper directly.
 *
 * Does not guard against a cyclic schema (an object reachable from itself): Datto's generated
 * schemas are not recursive (verified: no self-referential `z.lazy()`/circular `$ref` anywhere
 * under `src/generated/schemas/**`), and `addCatchallRecursive`/`cleanAndDiagnoseResponse` rely on
 * that same invariant with no cycle guard of their own — `addCatchallRecursive`'s cache is
 * populated only after a node's recursion returns, so a genuine cycle would stack-overflow there
 * regardless of any guard here. Recording the invariant once, in this one comment, rather than
 * defending against it three times inconsistently.
 */
export function enumFieldPaths(schema: z.ZodType): string[] {
  const paths = new Set<string>();
  walk(schema, "");
  return [...paths].sort();

  function walk(node: z.ZodType, path: string): void {
    const def = getDef(node);
    switch (def.type) {
      case "object": {
        const shape = objectShape(node);
        for (const key of Object.keys(shape)) {
          walk(shape[key]!, path ? `${path}.${key}` : key);
        }
        break;
      }
      case "array": {
        const { element } = nodeChildren(def);
        walk(element!, path);
        break;
      }
      case "union": {
        const { options = [] } = nodeChildren(def);
        for (const opt of options) walk(opt, path);
        break;
      }
      case "optional":
      case "nullable": {
        const { innerType } = nodeChildren(def);
        walk(innerType!, path);
        break;
      }
      case "record": {
        const { valueType } = nodeChildren(def);
        walk(valueType!, path);
        break;
      }
      case "pipe": {
        const { pipeOut } = nodeChildren(def);
        walk(pipeOut!, path);
        break;
      }
      case "default": {
        const { innerType } = nodeChildren(def);
        walk(innerType!, path);
        break;
      }
      case "enum": {
        if (path) paths.add(path);
        break;
      }
      default:
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Lenient<T> — the shape parseLenient actually returns on success
// ---------------------------------------------------------------------------

/**
 * Maps a response type `T` to the shape `parseLenient` actually returns on success: every object
 * field — named or nested, at any depth — additionally accepts `null` on top of whatever
 * optionality it already declared, mirroring `toLenientField`'s runtime leniency exactly (every
 * named field independently tolerates `null`/absent regardless of what the generated type
 * claims). Array elements are mapped through unchanged and are not themselves independently
 * nullable (only named object fields are — `addCatchallRecursive`'s `array` case does not wrap
 * its element schema in `toLenientField`), and primitives pass through as-is.
 *
 * A record's dynamic (index-signature) values are structurally indistinguishable from a named
 * object's own fields once `T` erases to plain TypeScript types, so this conservatively treats
 * them the same (nullable) even though `addCatchallRecursive`'s `record` case does not actually
 * wrap dynamic values in `toLenientField`. That mismatch only ever *widens* the static type (an
 * extra `null` branch a caller may need to narrow away that can never actually occur) — it can
 * never *narrow* it the way returning the bare, unmapped `T` did, which is precisely the defect
 * this type exists to fix.
 *
 * **Primitives are checked before `object` — deliberately, not merely for clarity.** `T` is a bare
 * (naked) type parameter in every branch here, so a conditional type on it *distributes* over a
 * union: when `T` is one of the widened response-enum types every generated schema actually uses
 * (`EnumUnion | (string & {})`, `widen-response-enums.mjs`, Phase 2), `Lenient<T>` is evaluated
 * per union member, including the open `(string & {})` branch on its own. That branded-primitive
 * idiom structurally satisfies TypeScript's `extends object` check (the intersected `{}` makes it
 * so) even though every value it describes is a plain string — so an `object`-first ordering would
 * incorrectly map `Lenient` over `String.prototype`'s own members for that branch, corrupting the
 * type of every enum field this client has (`deviceClass`, `alertPriority`, `antivirusStatus`,
 * …). Checking the primitive-type branch first short-circuits every string/number/boolean/bigint/
 * symbol/null/undefined union member — including a branded one — before the `object` branch can
 * ever misfire on it. Pinned by `tests/generated/lenient-type-pin.ts`, which asserts
 * `Lenient<Device>['deviceClass']` equals the field's own (unmodified) enum type plus `| null |
 * undefined`, not a mapped object.
 */
export type Lenient<T> = T extends readonly (infer U)[]
  ? Lenient<U>[]
  : T extends string | number | boolean | bigint | symbol | null | undefined
    ? T
    : T extends object
      ? { [K in keyof T]: Lenient<T[K]> | null }
      : T;

// ---------------------------------------------------------------------------
// parseLenient (public API)
// ---------------------------------------------------------------------------

/**
 * Leniently parses data against a Zod schema, tolerating the response-side defects production
 * Datto RMM traffic is known to exhibit: unknown keys (stripped), missing nullability (any named
 * field tolerates `null`/absent), and an undocumented enum member (widened to passthrough) — R5,
 * R7. Every tolerated occurrence is aggregated and reported as one summarized `debug` line per
 * `(field, value?)` via `DiagnosticsCollector`, not logged per occurrence (see
 * `cleanAndDiagnoseResponse`'s doc for why array element paths drop their index to make this
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
 * The overload below reflects this gate in the return type itself, not just prose: passing a
 * `logger` returns `Lenient<T>` (every field additionally typed to admit `null`, matching what
 * null/presence leniency can actually hand back), while omitting it returns the untouched `T`
 * (accurate, since the strict-`safeParse` fallback applies none of that leniency).
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
  logger: LenientParseLogger,
  context?: string,
): z.ZodSafeParseResult<Lenient<T>>;
// eslint-disable-next-line no-redeclare -- TS overload signature, not a duplicate declaration
export function parseLenient<T>(
  schema: z.ZodType<T>,
  data: unknown,
): z.ZodSafeParseResult<T>;
// eslint-disable-next-line no-redeclare -- implementation signature for the overloads above
export function parseLenient<T>(
  schema: z.ZodType<T>,
  data: unknown,
  logger?: LenientParseLogger,
  context?: string,
): z.ZodSafeParseResult<T> | z.ZodSafeParseResult<Lenient<T>> {
  if (!logger) {
    return schema.safeParse(data);
  }

  const wrapped = addCatchallRecursive(schema);
  const result = wrapped.safeParse(data);

  if (!result.success) {
    return result as z.ZodSafeParseResult<Lenient<T>>;
  }

  const diagnostics = new DiagnosticsCollector();
  const cleaned = cleanAndDiagnoseResponse(
    result.data,
    schema,
    "",
    diagnostics,
    undefined,
  );

  diagnostics.flush(
    (message, meta) => logger.debug(message, meta),
    context ?? "(unknown)",
  );

  return { success: true, data: cleaned as Lenient<T> };
}
