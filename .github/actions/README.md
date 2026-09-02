# Local composite actions

These are **local mirrors** (vendored copies) of composite actions from the
private [`pncit/shared-actions`](https://github.com/pncit/shared-actions) repo,
currently at `v2` (`59e838b`).

## Why they're copied here

`datto-rmm-api-client` is a **public** repository. GitHub does not allow a public
repo to reference actions that live in a **private** repo, so it cannot `uses:`
`pncit/shared-actions/...` directly (the workflow fails with
`Unable to resolve action pncit/shared-actions, not found`). Copying the
actions into this repo under `.github/actions/` sidesteps that — a repo-local
action (`uses: ./.github/actions/<name>`) has no visibility restriction.

This is the org standard for public repos; the sibling public repos
[`pncit/timezest`](https://github.com/pncit/timezest) and
[`pncit/node-quickbooks`](https://github.com/pncit/node-quickbooks)
carry the same copies — keep them in step.

## Keeping them in sync (manual)

When an action changes in `pncit/shared-actions`, re-copy it here verbatim and
update the tag/sha above. The copies are intentionally byte-for-byte identical
to upstream (apart from the header comment) so a sync is a trivial file diff —
do **not** locally "optimize" inputs or steps; consistency with upstream is the
point.

**One deliberate deviation:** `validate-codebase` upstream contains a nested
`uses: pncit/shared-actions/.github/actions/verify-node-toolchain@main`. Actions
resolves every nested `uses:` when the step is prepared, even when its `if:` is
false, so the private ref fails here with `Unable to resolve action`. The
vendored copy points that line at `./.github/actions/verify-node-toolchain`
instead. Keep that redirect when re-copying.

| local action | upstream |
|---|---|
| `validate-codebase/action.yml` | `pncit/shared-actions/.github/actions/validate-codebase` |
| `verify-node-toolchain/action.yml` | `pncit/shared-actions/.github/actions/verify-node-toolchain` |
| `verify-version-bump/action.yml` | `pncit/shared-actions/.github/actions/verify-version-bump` |
