## architect — round 2

Code Review Mode, exhaustive. In-progress review: reconciled my round-1 turn against `reviser-r2.md`.

### Reconciliation of prior `architect` findings

- **architect-r1-f1** (reviser: Fixed) — **re-verified against source, ratified → Closed.**
  `package.json` (l.7–13) now carries an `exports` map with both `"."` (`types` + `import`
  conditions) **and** the companion `"./package.json": "./package.json"` entry. That is the exact
  standard mitigation I called for: introducing an `exports` field otherwise flips subpath
  resolution to allow-list-only and makes `require.resolve('datto-rmm-api-client/package.json')`
  throw `ERR_PACKAGE_PATH_NOT_EXPORTED`; the added self-map keeps manifest deep-resolution working
  without re-opening the whole tarball. Confirmed present and well-formed; closing.

I did not reconcile the other reviser-r2 dispositions (`engineer-r1-f1`, `project-lead-r1-*`,
`typescript-cop-r1-f1`) — they belong to sibling reviewers, not to my `architect` turn.

### New-finding verification performed this round (no findings raised)

Round-2 convergence posture — I re-ran the boundary/public-API axes against the current tree and
found nothing new actionable:

- **Public API surface (README ↔ source).** Every type the "Exported types" section (README
  l.457–470) claims the package exports resolves against a real export: `DattoRmmClient` /
  `createDattoRmmClient` (`src/index.ts` l.11), `DattoRmmClientConfig` (l.12), `DattoLogger` (l.13);
  the seven write-input shapes (`DeviceUdfInput`, `DeviceWarrantyInput`,
  `SiteVariableCreateInput`/`SiteVariableUpdateInput`, `AccountVariableCreateInput`/
  `AccountVariableUpdateInput`, `SiteProxyInput`) all re-export from `src/schema-overrides` via
  `src/public-types.ts` l.32–42; and every response/param type name-checked in l.466–467
  (`Account`, `Site`, `Job`, `Filter`, `Variable`, `AuthUser`, `RateStatusResponse`,
  `GetSitesParams`) is a real named re-export in `public-types.ts`. No phantom public API in the doc.
- **`exports` map completeness / publish shape.** ESM-only, single entry, no `require`/`module`
  fields — consistent with `tsup.config.ts`'s single ESM entry and the browser/CJS Non-Goal; the
  omission of a `require` condition is a conscious, documented decision (notes §6/§8), not a gap.
  `main`/`types` retained alongside `exports` for older tooling. No boundary regression.
- **`readme.test.ts` drift-guard mechanism.** The per-operation `it.each(OPERATION_MAP)` cases key
  on `ns`/`method`/`specMethod`/`specPath` — the exact public fields of `OperationMapEntry`
  (`operation-map.ts` l.41–50) — and scope every assertion through `namespaceSection`, so a
  same-named method in a sibling namespace can't mask a deletion. Method-row lookup is
  paren-anchored (`| \`method(`), which correctly disambiguates prefix collisions
  (`create` vs `createVariable`, `get` vs `getById`); `pathPattern`'s `(?![\w{])` guard correctly
  keeps bare `/v2/site` (create) from matching `/v2/site/{siteUid}`. The guard is sound.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation / update |
|----|----------|--------|----------|----------|---------|-------------------------|
| architect-r1-f1 | Medium | Closed | PublicAPI | package.json l.7–13 | Ratified: the `exports` map now includes the companion `"./package.json": "./package.json"` entry alongside `"."`, so introducing `exports` no longer silently breaks tools that deep-resolve the manifest by subpath (`ERR_PACKAGE_PATH_NOT_EXPORTED`). Verified present and correct in the current tree. | No further action — fix confirmed. |
