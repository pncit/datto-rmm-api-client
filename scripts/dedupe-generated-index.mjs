#!/usr/bin/env node
/**
 * Post-generation script to deduplicate the generated types index file.
 *
 * Orval sometimes emits duplicate export lines in `src/generated/types/index.ts` (e.g. both
 * `./foo` and `./foo.js` for the same module). This script normalizes each `export …` line
 * (stripping a trailing `.js` extension), drops exact duplicates, and rewrites the index only
 * when duplicates were found (idempotent — a second pass is a no-op).
 *
 * Ported near-verbatim from fuze-api's scripts/dedupe-generated-index.mjs (the "port, don't
 * reinvent" rule); only GENERATED_INDEX_PATH is adjusted to this repo's layout, and the
 * dedupe/read/write logic is split into a pure, testable core (`dedupeExportLines`) plus a
 * thin CLI wrapper.
 *
 * Runs after Orval and before the enum-widening codemod, so the index the widen step scans is
 * already deduped.
 *
 * @example
 * ```bash
 * node scripts/dedupe-generated-index.mjs
 * ```
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATED_INDEX_PATH = resolve(
  __dirname,
  "../src/generated/types/index.ts",
);

/**
 * Normalizes an export line by removing a trailing `.js` extension and trimming whitespace, so
 * `export * from './foo'` and `export * from './foo.js'` are treated as the same export.
 */
function normalizeExportLine(line) {
  return line
    .trim()
    .replace(/\.js(['"])/, "$1") // Remove .js before quote
    .replace(/\.js;$/, ";"); // Remove .js before semicolon
}

/**
 * Deduplicates the `export …` lines in a generated index file's content.
 *
 * @param {string} content - The current file content.
 * @returns {{ content: string, duplicatesRemoved: number }} the deduped content and how many
 *   duplicate export lines were dropped (0 means the input was already deduped).
 */
export function dedupeExportLines(content) {
  const lines = content.split("\n");
  const seen = new Set();
  const deduped = [];
  let duplicatesRemoved = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Keep non-export lines (comments, blank lines, etc.) as-is.
    if (!trimmed.startsWith("export ")) {
      deduped.push(line);
      continue;
    }

    const normalized = normalizeExportLine(line);
    if (seen.has(normalized)) {
      duplicatesRemoved++;
      continue;
    }

    seen.add(normalized);
    deduped.push(normalized);
  }

  return { content: deduped.join("\n"), duplicatesRemoved };
}

function main() {
  let content;
  try {
    content = readFileSync(GENERATED_INDEX_PATH, "utf-8");
  } catch (error) {
    console.error(`Could not read ${GENERATED_INDEX_PATH}:`, error.message);
    process.exitCode = 1;
    return;
  }

  const { content: deduped, duplicatesRemoved } = dedupeExportLines(content);

  if (duplicatesRemoved > 0) {
    writeFileSync(GENERATED_INDEX_PATH, deduped, "utf-8");
    console.log(
      `dedupe-generated-index: removed ${duplicatesRemoved} duplicate export(s)`,
    );
  } else {
    console.log("dedupe-generated-index: no duplicates found");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
