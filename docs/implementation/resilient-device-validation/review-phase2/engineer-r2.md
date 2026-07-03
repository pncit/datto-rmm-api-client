## engineer — round 2

In-progress review. Re-verified my two round-1 findings against current source (`src/client.ts`,
`src/validation.ts`). The reviser's logged dispositions (reviser-r1/r2) only addressed
implementation-auditor findings, but the code itself now implements both of my round-1
recommendations, so I close them against the source:

- **engineer-r1-f1** — all three `validation-error` log sites now share the exported
  `VALIDATION_ERROR_PREFIX` (`client.ts:108` envelope hard-fail, `client.ts:190` `getDeviceByUid`,
  `validation.ts:100/103` per-item), and `client.ts:13` now actually imports the prefix, so
  `validation.ts:15-16`'s comment ("client.ts … can import the same prefixes") is no longer false.
  Resolved → Closed.
- **engineer-r1-f2** — the phrase is now a single module constant `MALFORMED_ENVELOPE_TITLE`
  (`client.ts:27`), referenced in the log line, `title`, and `detail`. Resolved → Closed.

One new finding this round, on the `getDeviceByUid` wiring introduced by Phase 2.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | Medium | Closed | Logging | `src/client.ts:108,190`; `src/validation.ts:15-16` | Ratified against source: the two Phase-2 log sites now carry the shared `VALIDATION_ERROR_PREFIX`, and `client.ts` imports it, so the greppable-shape goal holds and the `validation.ts` comment is now accurate. | No further action; carried forward only to record the disposition. |
| engineer-r1-f2 | Low | Closed | MagicValues | `src/client.ts:27,114,116,108` | Ratified against source: `MALFORMED_ENVELOPE_TITLE` is now the single source of truth for the log line, `ProblemError.title`, and `detail`. | No further action. |
| engineer-r2-f1 | Medium | Open | DeadCode / Documentation | `src/client.ts:188`; contra `src/validation.ts:115-117,119-127,142` | `getDeviceByUid` calls `toProblemError("Device", e, res.value, 0)` — passing a hardcoded, meaningless `0` for the array `index` and **not** passing the purpose-built `identityOverride`, even though `deviceUid` (the exact identity the call knows) is in scope. As a result: (a) `identityOverride` is dead across the whole codebase — no caller ever supplies it (verified: only occurrences are its own declaration/JSDoc in `validation.ts`); (b) `toProblemError`'s JSDoc (`validation.ts:115-117`) explicitly cites "a single-value caller (e.g. getDeviceByUid)" as *the* consumer of `identityOverride`, so that documentation is now false — the one named consumer doesn't use it; (c) latent misleading output — when the divergent device's `id`/`uid` is itself the failing/absent field, `extractIdentity(res.value)` returns `undefined` and the detail falls back to `index 0`, a nonsensical identity for a single-device fetch whose caller knows the real `deviceUid`. | Pass the known identity through: `toProblemError("Device", e, res.value, 0, \`uid=${deviceUid}\`)`, so the error deterministically names the requested device and the parameter's documented purpose is realized (update the strict-mode `getDeviceByUid` test, which currently asserts `detail` contains `id=1`, to assert on the `uid=` identity instead). If the current `extractIdentity(res.value)` behavior is instead deliberate, remove the now-unused `identityOverride` parameter and delete the `validation.ts:115-117,142` JSDoc that cites getDeviceByUid — leaving a dead parameter and a doc that names a non-existent consumer is the drift to avoid. Either way, also drop the bare `0`: it is a magic positional index with no meaning for a single value. |
