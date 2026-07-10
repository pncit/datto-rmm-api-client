## triage — round 1 (delta re-triage, turn 2)

Re-assessment-only delta. New outcomes since triage-r1: the human ruled on the two rows I had
routed `Human` — **f2** and **f3**. triage-r1 held **no `Remediate` rows and no `Challenge`
rows**, so this delta has nothing to moot, revise, restate, or withdraw. The two human rulings
land exactly along the dossier recommendations (f2 → Option 3, narrow the gate *and* strip
"axios" from the example; f3 → Option 2, accept `index.ts`-direct and amend the design). Neither
outcome invalidates a `Remediate` row (there are none) nor settles a `Challenge` (there are none);
they only close the two open escalations. All four findings are now settled ground.

| ID | Route | Detail |
|----|-------|--------|

_No rows. A delta records no new `Ruled`/`Human` row and may carry only surviving `Remediate` or
`Challenge` rows — triage-r1 opened none, so the route table is empty this turn. The settled
dispositions of all four findings are recorded in the notes below (carried, not re-routed)._

### Re-assessment notes

- **No surviving `Challenge` rows.** triage-r1 opened none, so there is nothing to restate
  verbatim and no reviewer is left waiting on a live challenge.
- **No surviving `Remediate` rows.** triage-r1 routed none, so there is nothing to moot or revise
  against the amended ground.
- **f1, f4 — untouched.** Both carry their triage-r1 mediator rulings verbatim; the new human
  outcomes concern only f2/f3 and have no bearing on the two plan-prose edits. f1: pin
  `fireError(logger, observer, capture, rawError, mappedError: DattoApiError)` — every caller
  pre-maps; edit Phase 1 S5 prose and the Phase 2 example (line 258). f4: add `npm run build` and
  `! grep -q 'declare module' dist/index.d.ts` to the Phase 2 and Phase 3 Exit Gates; no blanket
  `grep 'axios' dist/index.d.ts`.
- **f2 — closed by the human.** Ruling: modify plan.md — (1) narrow the gate, e.g.
  `! grep -Eq "from [\"']axios[\"']" src/http/http-observer.ts` plus an optional
  `! grep -Eq '\bAxios[A-Z]' …` type check; AND (2) strip "axios" from the example doc comment.
  Recorded here, not re-routed.
- **f3 — closed by the human.** Ruling: update the design — accept `index.ts`-direct and amend the
  design so the observer types export directly from `index.ts` alongside `DattoLogger`. This flows
  as a `design` amendment (cross-stage — see chain watch). Recorded here, not re-routed.

### Clusters (remediation plan)

Root cause is not shared across findings; group by target artifact.

- **plan.md edits (f1, f2, f4):** three independent, mechanical plan-prose edits, all applicable in
  a single pass — f1 (pin `fireError` signature; Phase 1 S5 + Phase 2 example), f2 (narrow the
  `http-observer.ts` axios gate in the Phase 1/Phase 4 gate blocks + strip "axios" from the Phase 1
  example comment), f4 (add `npm run build` + `! grep -q 'declare module' dist/index.d.ts` to the
  Phase 2 and Phase 3 Exit Gates). No ordering dependency among the three.
- **design.md amendment (f3):** correct design line 267 (and the 87/95 export-location prose) to
  state the observer types export directly from `index.ts` alongside `DattoLogger`. This is the one
  cross-stage remedy — it lands on the `design` stage, not `plan.md`.

### Chain watch

- **f3 → design amendment.** The human ruling converts f3 into a `design` correction (line 267 /
  87 / 95). Watch that the design edit and Phase 1 S3's `index.ts`-direct wording end up mutually
  consistent, so a downstream re-audit does not re-raise the same divergence from the opposite side.
- No mechanism has churned across two or more consecutive rounds; this remains the plan review's
  first (and only, so far) findings round.
