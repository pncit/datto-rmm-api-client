## ci-runner — round 1

CI checks for the branch head completed with failures. Investigate with `gh pr checks` and `gh run view --log-failed <run-id>`.

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| ci-runner-r1-f1 | High | Open | CI | validate | PR check failed (https://github.com/pncit/datto-rmm-api-client/actions/runs/29133951204/job/86494531597) | investigate the logs and make the check pass |

### validate — failed-step log (tail)

```
/null 2>&1; then[0m
validate	Verify version changed	2026-07-11T01:04:48.6750032Z [36;1m  PREV=$(git show "$BASE_BRANCH:package.json" 2>/dev/null \[0m
validate	Verify version changed	2026-07-11T01:04:48.6751527Z [36;1m    | node -p "(() => { const s=require('fs').readFileSync(0,'utf8'); try { return JSON.parse(s).version || '' } catch { return '' } })()" \[0m
validate	Verify version changed	2026-07-11T01:04:48.6752620Z [36;1m    || true)[0m
validate	Verify version changed	2026-07-11T01:04:48.6753131Z [36;1melse[0m
validate	Verify version changed	2026-07-11T01:04:48.6753584Z [36;1m  PREV=""[0m
validate	Verify version changed	2026-07-11T01:04:48.6754047Z [36;1mfi[0m
validate	Verify version changed	2026-07-11T01:04:48.6754523Z [36;1m[0m
validate	Verify version changed	2026-07-11T01:04:48.6754969Z [36;1mif [ -z "$CUR" ]; then[0m
validate	Verify version changed	2026-07-11T01:04:48.6755602Z [36;1m  echo "::error::No version found in package.json"[0m
validate	Verify version changed	2026-07-11T01:04:48.6756262Z [36;1m  exit 1[0m
validate	Verify version changed	2026-07-11T01:04:48.6756718Z [36;1mfi[0m
validate	Verify version changed	2026-07-11T01:04:48.6757149Z [36;1m[0m
validate	Verify version changed	2026-07-11T01:04:48.6757655Z [36;1mif [ -n "$PREV" ] && [ "$CUR" = "$PREV" ]; then[0m
validate	Verify version changed	2026-07-11T01:04:48.6758654Z [36;1m  echo "::error::package.json version unchanged ($PREV -> $CUR). Version must be bumped for PRs."[0m
validate	Verify version changed	2026-07-11T01:04:48.6759585Z [36;1m  exit 1[0m
validate	Verify version changed	2026-07-11T01:04:48.6760031Z [36;1mfi[0m
validate	Verify version changed	2026-07-11T01:04:48.6760460Z [36;1m[0m
validate	Verify version changed	2026-07-11T01:04:48.6761093Z [36;1mif [ -z "$PREV" ]; then[0m
validate	Verify version changed	2026-07-11T01:04:48.6761873Z [36;1m  echo "Could not determine previous version, skipping version check"[0m
validate	Verify version changed	2026-07-11T01:04:48.6762664Z [36;1melse[0m
validate	Verify version changed	2026-07-11T01:04:48.6763182Z [36;1m  echo "Version changed: $PREV -> $CUR ✓"[0m
validate	Verify version changed	2026-07-11T01:04:48.6763808Z [36;1mfi[0m
validate	Verify version changed	2026-07-11T01:04:48.6979277Z shell: /usr/bin/bash --noprofile --norc -e -o pipefail {0}
validate	Verify version changed	2026-07-11T01:04:48.6980344Z ##[endgroup]
validate	Verify version changed	2026-07-11T01:04:49.0016947Z From https://github.com/pncit/datto-rmm-api-client
validate	Verify version changed	2026-07-11T01:04:49.0018124Z  * [new branch]      main       -> main
validate	Verify version changed	2026-07-11T01:04:49.0018964Z  * [new branch]      main       -> origin/main
validate	Verify version changed	2026-07-11T01:04:49.0425696Z ##[error]package.json version unchanged (1.0.2 -> 1.0.2). Version must be bumped for PRs.
validate	Verify version changed	2026-07-11T01:04:49.0440050Z ##[error]Process completed with exit code 1.
```
