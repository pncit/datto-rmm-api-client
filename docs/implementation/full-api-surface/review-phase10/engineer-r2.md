## engineer — round 2

In-progress review. I re-scoped against the **working tree** (not the pre-revision checkpoint
commit): `git status --short` shows the reviser's edits are uncommitted, confined to `README.md`,
`package.json`, `package-lock.json`, and `tests/unit/readme.test.ts`. `src/**` remains untouched,
consistent with this phase.

### Re-verifying my one prior finding

- **engineer-r1-f1 (Fixed → ratified Closed).** The rewritten `tests/unit/readme.test.ts` now does
  exactly what my finding called for. `it.each(OPERATION_MAP)` derives one assertion per operation,
  slices the README to that operation's own `### \`client.<ns>\`` section (`namespaceSection`),
  locates the operation's own table row (`findMethodRow`, anchored on `` | `method( `` so
  prefix-colliding siblings like `get`/`getById`, `devices`/`devicesWithNetworkInterface`,
  `resolve`/`resolved`, `open`/`openForSite` cannot cross-match), and asserts the row carries the
  spec verb (`specMethod.toUpperCase()`) and a `pathPattern`-matched request path. I traced the
  placeholder-generalization (`{deviceUid}` → `\{[A-Za-z]+\}` matching the doc's friendlier `{uid}`)
  and the `(?![\w{])` boundary lookahead (which keeps `/api/v2/account` from spuriously matching the
  `/api/v2/account/devices` row) across the tricky namespaces — the guard is sound and derives
  entirely from the authoritative `OPERATION_MAP`, no hand-list. The notes' claim is now true. Closed.

### New (round-2) findings

Both are `Low` and target the revised test file — the README claims I spot-checked against source in
round 1 remain accurate, and the reviser's `exports`/lockfile/callout changes are correct.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| engineer-r1-f1 | Medium | Closed | Documentation | tests/unit/readme.test.ts | Ratified: the per-operation `it.each(OPERATION_MAP)` guard now asserts each row's verb + path per-namespace, mechanically derived from the authoritative map — exactly the fix I asked for. | — (fix accepted) |
| engineer-r2-f1 | Low | Open | DeadCode | tests/unit/readme.test.ts l.100-108 (`it.each(namespaces)("documents at least one method for client.%s")`) | This test is now strictly subsumed by the new `it.each(OPERATION_MAP)` per-operation test. That test already locates **every** method's own row within its namespace section (`findMethodRow` under `namespaceSection`) and fails if any is absent; the coarser "documents at least one method" check — which only requires that *one* of a namespace's methods appear in its section — can never fail while the per-operation test passes, and gives no clearer diagnostic (a genuinely missing/renamed method surfaces as a named per-operation failure). It is redundant test code left over from before the per-operation guard existed (it was the project-lead-r1-f3 hardening target, whose concern the per-operation test now fully covers). | Delete the `it.each(namespaces)("documents at least one method for client.%s", …)` block (l.100-108). The per-operation `it.each(OPERATION_MAP)` case is the superset guard; removing the weaker duplicate keeps the suite honest about what actually protects the doc. The separate "has a namespace → endpoint map section" heading check (l.89-95) may stay as a coarse namespace-level tripwire. |
| engineer-r2-f2 | Low | Open | Documentation | tests/unit/readme.test.ts l.11-19 (the first `/** … */` block) | Two JSDoc blocks are stacked immediately before `function namespaceSection`. The first block is a file/suite overview (it cites R18, the plan phase, and explains the `OPERATION_MAP`-derived design), but by placement it reads as documentation for `namespaceSection` — which the *second* block already, correctly, documents. A JSDoc comment attaches to the following declaration, so the overview is effectively an orphaned comment masquerading as the helper's doc, which is misleading to a reader scanning top-down. | Move the overview block (l.11-19) to the top of the file (right after the imports, as a module-level comment) or into the `describe("README", …)` body, leaving only the `namespaceSection`-specific block directly above that function. |
