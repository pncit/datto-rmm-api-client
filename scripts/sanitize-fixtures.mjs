#!/usr/bin/env node
/**
 * Fixture sanitization script (R17, design "Real-response fixtures... at rest" risk mitigation).
 *
 * A maintainer who captures a real Datto RMM sweep (devices/sites/users/alerts/audits, for the
 * Deferred Validation real-response check) must **never** commit the raw response: UDF values
 * have been observed in practice to carry secrets (BitLocker recovery keys, admin usernames,
 * credentials — design "Reality findings"/Risk table). This script is the deterministic, at-rest
 * guard run **before** committing: it redacts every secret-bearing field to `null`, in place at
 * whatever depth it occurs, and writes a commit-safe copy.
 *
 * **Key-based, not content-based.** This does not attempt to detect "does this value look like a
 * secret" — a reliable content heuristic isn't achievable (it false-positives on the committed
 * OpenAPI document's own prose and OAuth structural keys, and false-negatives on a novel secret
 * shape neither pattern nor keyword catches). Redacting by field name alone is complete and
 * predictable for exactly the fields it covers (design "Redaction is key-based, not
 * content-based"). We deliberately do **not** ship an automated secret detector/scanner — see
 * the plan's Phase 9 Step 2 for why.
 *
 * **Schema-independent.** A raw captured sweep can be a single entity, a `{pageDetails, <array>}`
 * page envelope, or a whole multi-entity sweep file; this walks the parsed JSON generically
 * (any object/array/primitive) rather than driving off a Zod schema, so it works uniformly
 * across whatever shape a captured response actually has.
 *
 * @example
 * ```bash
 * node scripts/sanitize-fixtures.mjs raw-sweep.json tests/fixtures/sanitized-sweep.json
 * ```
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Every field-name pattern this script treats as secret-bearing and redacts to `null`, at any
 * nesting depth, regardless of which entity the field appears on. UDFs (`udf1`…`udf300`) are the
 * only field currently confirmed to carry secrets in real Datto data (design "Reality findings").
 * Kept as an array — rather than a single hardcoded regex — so a future confirmed secret-bearing
 * field (should one ever be found) has one documented place to add to, without restructuring the
 * walk in {@link sanitizeValue}.
 *
 * @type {readonly RegExp[]}
 */
export const SECRET_KEY_PATTERNS = [/^udf\d+$/];

/**
 * @param {string} key
 * @returns {boolean}
 */
function isSecretKey(key) {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Recursively walks an arbitrary JSON value, replacing the value of every key matching
 * {@link SECRET_KEY_PATTERNS} — at any depth — with `null`, while leaving every other key,
 * value, and the original key's position in its containing object **entirely unchanged**. Only a
 * secret-bearing key's *value* is touched; the key itself is always preserved, so the sanitized
 * output has exactly the same shape (key set, nesting, array lengths) as the input — the
 * "preserving type/nullability shape" the design's mitigation names.
 *
 * Idempotent: a value that is already `null` (redacted or genuinely absent on the wire) is set to
 * `null` again, so re-running this against an already-sanitized fixture is a no-op.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }
  if (value !== null && typeof value === "object") {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, entryValue] of Object.entries(
      /** @type {Record<string, unknown>} */ (value),
    )) {
      out[key] = isSecretKey(key) ? null : sanitizeValue(entryValue);
    }
    return out;
  }
  return value;
}

function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error(
      "Usage: node scripts/sanitize-fixtures.mjs <raw-sweep-file.json> <sanitized-output.json>",
    );
    process.exitCode = 1;
    return;
  }

  const raw = JSON.parse(readFileSync(inputPath, "utf8"));
  const sanitized = sanitizeValue(raw);
  writeFileSync(outputPath, JSON.stringify(sanitized, null, 2) + "\n", "utf8");
  console.log(`sanitize-fixtures: wrote ${outputPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
