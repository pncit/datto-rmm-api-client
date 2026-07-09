## typescript-cop — round 1

### Scope

Phase 10 is documentation/release-metadata only: `git diff` (against the pre-phase-10 tip,
`9b00367`, including the working-tree state after the reviser's r1 fixes) touches exactly
`README.md`, `package.json`, and the new `tests/unit/readme.test.ts`. No `src/**` file changed, so
there is no new production type surface to audit directly. Review focused on (a) the one new test
file's own type hygiene, (b) `package.json`'s `exports`/`types` publish shape, and (c) the TypeScript
code samples embedded in the rewritten README — since these are the first code a consumer copies,
an unsafe pattern shipped there is a real, reachable type hole even though the surrounding file is
prose.

`tests/unit/readme.test.ts` is clean: no `any`, no unsafe casts, `it.each` typed off `OPERATION_MAP`'s
own `ResourceNamespace` union. `package.json`'s new `exports` map (`types` + `import` conditions,
matching `tsup.config.ts`'s single ESM `dist/index.js`/`dist/index.d.ts` output) is correctly shaped
and consistent with the pre-existing `main`/`types` fields.

One issue found in the README's Quick Start example, verified against the actual generated/reconciled
type.

### Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| typescript-cop-r1-f1 | Medium | Open | TypeHole | README.md l.68–74 (Quick start) | The flagship Quick Start example — the first code every consumer copies — writes `client.devices.get(devices[0]!.uid!)` and `client.devices.setUdf(one.uid!, …)`, using non-null assertions to discard two genuine possibilities the type system correctly flags: `devices[0]` is `Device \| undefined` (the array can be empty), and `Device["uid"]` is itself `string \| undefined` — confirmed by compiling `type UidType = Device["uid"]; const x: UidType = undefined;` against `src/public-types.ts` with `--strict`, which type-checks cleanly, and by the underlying schema (`src/generated/schemas/-v2-device/-v2-device.zod.ts`: `"uid": zod.string().optional()`). This isn't a hypothetical edge case the doc can wave away: the same README's own "Validation" section states response fields are lenient about presence/nullability precisely because Datto's data is known to have gaps, so `uid` being absent on a given record is a real, documented possibility the example itself immediately contradicts by force-unwrapping it twice. A reader who pastes this snippet against an account with zero devices, or a malformed/partial device record, gets an unhandled `TypeError: Cannot read properties of undefined` instead of a clear error path — exactly the failure mode the rest of the README's error-handling section otherwise teaches readers to avoid. | Replace the two `!` assertions with an explicit check, e.g.: `const first = devices[0]; if (!first?.uid) { throw new Error("account has no devices"); } const one = await client.devices.get(first.uid); await client.devices.setUdf(one.uid ?? (() => { throw new Error("device has no uid"); })(), { udf5: "asset tag 1234" });` — or simpler, guard once and reuse a narrowed local (`const uid = devices[0]?.uid; if (!uid) throw …; …`). Either keeps the example runnable against the leniency the client itself documents, instead of modeling the exact anti-pattern (`!`) the rest of the file never uses elsewhere. |
