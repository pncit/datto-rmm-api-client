/**
 * Dedupe-and-summarize diagnostics collector for lenient response validation.
 *
 * Response leniency (unknown-key strips, enum widenings — see `schema-leniency.ts`) can fire
 * once per item across a large collection: a page of 848 devices or 1500 alerts. Logging each
 * occurrence individually would flood the sink and run the UDF-masking decorator
 * (`src/logging/mask.ts`) in a per-row hot path (design "Leniency diagnostics volume & levels").
 *
 * `DiagnosticsCollector` instead accumulates one group per distinct `(message, field, value?)`
 * recorded during a single `parseLenient` call and emits exactly one summarized line per group
 * when `flush()` runs at the end of that call, each carrying how many occurrences were folded
 * into it (`count`) and the number of items actually examined at that field's structural
 * position (`total` — see `record`/`trackExamined`).
 *
 * Scoped to the two benign events `schema-leniency.ts` produces in this phase at `debug`
 * (unknown-key strip, enum widening). `flush` takes a plain `(message, meta?) => void` sink
 * rather than a whole logger, so the per-item **drop** path (R7 — actual data loss, logged at
 * `warn`) that `BaseResource.validateArrayResponse` aggregates the same way (Phase 6) can reuse
 * this class unmodified by passing `(message, meta) => logger.warn(message, meta)` — this file
 * never has to know which level a caller uses.
 */

/** The emit sink `flush` calls once per group. Not exported — an implementation detail. */
type DiagnosticsSink = (
  message: string,
  meta?: Record<string, unknown>,
) => void;

interface DiagnosticGroup {
  readonly message: string;
  readonly field: string;
  readonly value: string | undefined;
  count: number;
  /**
   * Identifies which `trackExamined` accumulation this group's `total` resolves from at
   * `flush()` time (see `record`). `undefined` means the occurrence was found outside any array
   * (a bare single-object parse), which resolves to a total of `1`.
   */
  readonly collectionKey: string | undefined;
}

/**
 * Builds the dedup key for a `(message, field, value)` triple. Uses `JSON.stringify` on the
 * tuple rather than plain-text concatenation: `field` and `value` can both be arbitrary
 * wire-derived strings (a stripped record key, a widened enum value) that are not guaranteed to
 * exclude any particular delimiter, so a text join risks two distinct triples colliding onto the
 * same key. `JSON.stringify` escapes each component, so no component's own content can produce a
 * false collision with another's.
 */
function groupKey(
  message: string,
  field: string,
  value: string | undefined,
): string {
  return JSON.stringify([message, field, value ?? null]);
}

export class DiagnosticsCollector {
  private readonly groups = new Map<string, DiagnosticGroup>();
  private readonly examined = new Map<string, number>();

  /**
   * Records that `size` items were visited at the structural array position identified by
   * `collectionKey` (the array's own field path — see `cleanAndDiagnoseResponse`'s doc).
   * Accumulates (adds) rather than overwrites: a nested array is revisited once per element of
   * whichever array encloses it (e.g. `alerts[i].responseActions` once per alert), and each of
   * those visits contributes its own length toward the true total number of items examined at
   * that position across the whole call — not just the length of whichever visit happened last.
   */
  trackExamined(collectionKey: string, size: number): void {
    this.examined.set(
      collectionKey,
      (this.examined.get(collectionKey) ?? 0) + size,
    );
  }

  /**
   * Records one occurrence of a diagnostic event, folding it into the existing group for the
   * same `(message, field, value)` if one already exists (its `count` is incremented) or
   * starting a new group otherwise.
   *
   * Pass `value` when the observed value itself is the informative signal and has naturally
   * bounded cardinality — e.g. a specific out-of-set enum member, where distinct values are each
   * worth surfacing on their own line. Omit it (leave `undefined`) when it is not — e.g. an
   * unknown key's own value, which is typically unique per record and would defeat aggregation
   * (and leak the value into a diagnostic line for no benefit) if it participated in the dedup
   * key.
   *
   * `collectionKey` identifies which array position's accumulated `trackExamined` count this
   * group's `total` is resolved from once `flush()` runs — by which point every element of every
   * array sharing that key has been visited, so the resolved total is exact even when the same
   * key is revisited many times (a nested array, once per outer element). Omit it (leave
   * `undefined`) for an occurrence found outside any array, which resolves to a total of `1`.
   */
  record(
    message: string,
    field: string,
    value?: string,
    collectionKey?: string,
  ): void {
    const key = groupKey(message, field, value);
    const existing = this.groups.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    this.groups.set(key, { message, field, value, count: 1, collectionKey });
  }

  /** `true` if nothing has been recorded since construction (or the last `flush()`). */
  get isEmpty(): boolean {
    return this.groups.size === 0;
  }

  /**
   * Emits one summarized line per distinct group recorded since construction (or the last
   * `flush()`) via `sink`, then clears the collector.
   *
   * `context` identifies the call site (e.g. `'GET /device'`), threaded through unchanged as
   * `meta.context`. Each group's `total` is resolved here, at the end of the whole walk, from its
   * `collectionKey`'s accumulated `trackExamined` count (or `1` if it has none) — so a flushed
   * line reads as e.g. `{ field: 'deviceClass', value: 'rmmnetworkdevice', count: 3, total: 848 }`
   * for an item widened inside an 848-element `devices` array, regardless of whether that array
   * is the top-level response, nested inside an envelope object (e.g. `{ pageDetails, devices }`),
   * or itself nested inside another array.
   *
   * Every wire-derived value here rides in `meta`, never the message string, per the R20
   * masking-boundary invariant (`src/logging/mask.ts` only scrubs `meta`): the message is always
   * static text.
   */
  flush(sink: DiagnosticsSink, context: string): void {
    for (const group of this.groups.values()) {
      const total =
        group.collectionKey !== undefined
          ? (this.examined.get(group.collectionKey) ?? 1)
          : 1;
      const meta: Record<string, unknown> = {
        context,
        field: group.field,
        count: group.count,
        total,
      };
      if (group.value !== undefined) {
        meta.value = group.value;
      }
      sink(group.message, meta);
    }
    this.groups.clear();
    this.examined.clear();
  }
}
