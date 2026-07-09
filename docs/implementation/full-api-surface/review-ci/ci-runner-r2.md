## ci-runner — round 2

The draft PR's CI checks completed with failures. Investigate with `gh pr checks` and `gh run view --log-failed <run-id>`.

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| ci-runner-r2-f1 | High | Open | CI | validate | PR check failed (https://github.com/pncit/datto-rmm-api-client/actions/runs/29049745562/job/86227153317) | investigate the logs and make the check pass |
