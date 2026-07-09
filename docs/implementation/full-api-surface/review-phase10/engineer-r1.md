## engineer — round 1

Scope: `git diff main...HEAD` for Phase 10 is `README.md` (rewritten), `package.json` (version
`1.0.0` + additive `exports` map), and the new `tests/unit/readme.test.ts`. `src/**` untouched. The
other `package.json` script/devDep churn shown in the diff (jest→vitest, tsc→tsup, generate/repro
scripts) predates this phase (Phases 1–9 commits) and is out of Phase-10 scope; I did not re-review
it.

I cross-checked the README's substantive claims against source rather than restating the
implementation-auditor's pass:

- **Endpoint map is complete and correct.** Row-counted every namespace table against
  `src/client/operation-map.ts`: account 8, sites 14, devices 7, alerts 10, jobs 5, audit 5,
  filters 2, users 2, activityLogs 1, system 3 = 57. Every documented method name and HTTP verb
  matches the map (spot-checked the write verbs: `createVariable` PUT, `updateVariable` POST,
  `deleteVariable` DELETE, `sites.create` PUT / `sites.update` POST — all correct).
- **Rate-limit prose is accurate** against `src/rate-limit/rate-limits.ts`: read 600, aggregate
  write 600, window 60 s, `device-udf-set` 600 vs the common 100 per-operation ceiling.
- **`DattoLogger` signature and the `console`-backed default** match `src/logging/logger.ts`
  (`consoleLogger = console`), and the masking narrative matches the decorator description.
- **`package.json`**: `type:"module"`, `engines.node >=20.0.0` (matches the README "Node.js >= 20"),
  `files:["dist","README.md","LICENSE"]`, and the `exports` map's `types`/`import` targets are both
  produced by `tsup` (`clean:true`, so dropping `clean` from `prepublishOnly` strands nothing).

The prior implementation-auditor findings (`implementation-auditor-r1-f1`, `-r1-f2`) are ratified
Closed by that reviewer's round 2 and are not mine to carry.

One engineer-scope issue remains: the phase's own named drift-guard test does not actually guard the
artifact the notes claim it does.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | Medium | Open | Documentation | tests/unit/readme.test.ts l.28-43 | The phase notes (§1 In-Scope, §4) state `readme.test.ts` "guards the namespace→endpoint map … against drift," but the test never checks the map's actual content. It verifies only (a) each namespace *heading* exists and (b) *at least one* of that namespace's method names appears *somewhere* in the whole README — it never asserts the documented HTTP **verb** or **path** for any operation, and the method check is not scoped to the namespace's own table. The README's core value is the 57-row endpoint tables (method + verb + `/api`+path), and those are the most drift-prone content: a future spec refresh that changes a verb/path updates `operation-map.ts` (forced by `coverage-map.test.ts`) but this test would still pass on a stale README row. The method check is also weak per-namespace: because `readme.includes(\`\`${method}(\`)` is document-wide and names collide across namespaces (`get`, `list`, `variables`, `createVariable`, `updateVariable`, `deleteVariable` appear in both `account` and `sites`), renaming a method in a multi-method namespace still passes as long as one sibling — or an identically-named method in another namespace — matches. So the "guard against stale/renamed method names" the notes assert is largely absent. | Derive the assertions per `OPERATION_MAP` entry and scope them to the namespace's section. For each entry: locate the `### \`client.${ns}\`` section slice of the README (up to the next `### `/`## ` heading) and assert that slice contains a row with the entry's `method(`, its HTTP verb (`entry.specMethod.toUpperCase()`), and the concrete request path `/api${entry.specPath}`. That makes the guard match the notes' claim (every row's method/verb/path is drift-checked, per-namespace), still derives entirely from the same authoritative table (no hand-list), and turns the README's central content from unguarded prose into a mechanically-verified surface. |
