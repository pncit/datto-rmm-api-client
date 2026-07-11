## typescript-cop — round 2

Re-verified all three round-1 findings against the current diff (`git diff 2cdd45c -- tests/integration/http-observer.test.ts`) and the reviser's disposition. All three fixes are confirmed correct and no new type-safety issue was introduced by the revision. `npx tsc --noEmit` on the current tree is clean. No new findings this round.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| typescript-cop-r1-f1 | Medium | Closed | TypeHole | `tests/integration/http-observer.test.ts` (`eventsOf`) | Ratified. `eventsOf` is now overloaded per concrete `kind` (`"request"`/`"response"`/`"error"` → the matching event array type), and every one of the five call sites (`:104`, `:122`, `:175`, `:178`, `:197`) uses the plain call with no `as …[]` cast. The reviser's documented deviation from my suggested single-generic signature (a real `tsc` limitation on indexed-access-over-conditional-types across a 3-member union) is a sound, verified-compiling alternative that achieves the same outcome — a `kind` typo now fails to compile since only the three literal overloads exist. | — |
| typescript-cop-r1-f2 | Medium | Closed | TypeHole | `tests/integration/http-observer.test.ts` (429→retry→200 test) | Ratified. The `terminal[0]!.event as DattoHttpErrorEvent` / `terminal[1]!.event as DattoHttpResponseEvent` casts are gone, replaced by `if (first.kind !== "error") throw …` / `if (second.kind !== "response") throw …` guards the compiler follows (`first.event`/`second.event` are correctly narrowed after each guard, confirmed at `:232-240`). | — |
| typescript-cop-r1-f3 | Medium | Closed | TypeHole | `tests/integration/http-observer.test.ts` (grant-body assertion) | Ratified. `grantRequest!.body as string` is replaced by an explicit `if (!grantRequest) throw …` then `if (typeof grantRequest.body !== "string") throw …` runtime guard before constructing `URLSearchParams`, with no remaining cast (`:106-112`). | — |

