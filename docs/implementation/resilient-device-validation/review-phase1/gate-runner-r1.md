## gate-runner — round 1

Exit-gate commands executed independently by the pipeline driver — **fail**.

```bash
npm run build
npm test
# R4 guard (mechanically enforced): none of the protected files may change in this phase.
# Use `HEAD` so staged/committed edits are caught too, not just unstaged working-tree changes.
git diff --name-only HEAD | grep -qE '^src/(schemas|result|index)\.ts$' && { echo 'R4 violation: a protected file (schemas.ts/result.ts/index.ts) changed'; exit 1; } || true
```

Output (tail):

```
de": "invalid_type",
              "path": [],
              "message": "Invalid input: expected null, received undefined"
            }
          ]
        ],
        "path": [
          "udf",
          "udf27"
        ],
        "message": "Invalid input"
      },
      {
        "code": "invalid_union",
        "errors": [
          [
            {
              "expected": "string",
              "code": "invalid_type",
              "path": [],
              "message": "Invalid input: expected string, received undefined"
            }
          ],
          [
            {
              "expected": "null",
              "code": "invalid_type",
              "path": [],
              "message": "Invalid input: expected null, received undefined"
            }
          ]
        ],
        "path": [
          "udf",
          "udf28"
        ],
        "message": "Invalid input"
      },
      {
        "code": "invalid_union",
        "errors": [
          [
            {
              "expected": "string",
              "code": "invalid_type",
              "path": [],
              "message": "Invalid input: expected string, received undefined"
            }
          ],
          [
            {
              "expected": "null",
              "code": "invalid_type",
              "path": [],
              "message": "Invalid input: expected null, received undefined"
            }
          ]
        ],
        "path": [
          "udf",
          "udf29"
        ],
        "message": "Invalid input"
      },
      {
        "code": "invalid_union",
        "errors": [
          [
            {
              "expected": "string",
              "code": "invalid_type",
              "path": [],
              "message": "Invalid input: expected string, received undefined"
            }
          ],
          [
            {
              "expected": "null",
              "code": "invalid_type",
              "path": [],
              "message": "Invalid input: expected null, received undefined"
            }
          ]
        ],
        "path": [
          "udf",
          "udf30"
        ],
        "message": "Invalid input"
      }
    ]

      24 |     return data as T;
      25 |   }
    > 26 |   const result = schema.safeParse(data);
         |                         ^
      27 |   if (result.success) {
      28 |     return result.data;
      29 |   }

      at new ZodError (node_modules/zod/v4/core/core.cjs:35:39)
      at Object.safeParse (node_modules/zod/v4/core/parse.cjs:68:20)
      at _.inst.safeParse (node_modules/zod/v4/classic/schemas.cjs:138:46)
      at validate (src/validation.ts:26:25)
      at Object.<anonymous> (src/__tests__/deviceSchema.test.ts:11:26)

PASS src/__tests__/client.test.ts
FAIL src/__tests__/devicesMethod.test.ts
  ● getAccountDevices returns validated data

    expect(received).toBe(expected) // Object.is equality

    Expected: true
    Received: false

      44 |
      45 |   const result = await client.getAccountDevices();
    > 46 |   expect(result.ok).toBe(true);
         |                     ^
      47 |   const devices = (result as any).value;
      48 |   expect(devices.length).toBe(1);
      49 |   expect(devices[0].hostname).toBe("server1");

      at Object.<anonymous> (src/__tests__/devicesMethod.test.ts:46:21)

  ● getAccountDevices paginates automatically

    expect(received).toBe(expected) // Object.is equality

    Expected: true
    Received: false

      70 |
      71 |   const result = await client.getAccountDevices();
    > 72 |   expect(result.ok).toBe(true);
         |                     ^
      73 |   const devices = (result as any).value;
      74 |   expect(devices.length).toBe(2);
      75 |   expect(devices[1].hostname).toBe("server2");

      at Object.<anonymous> (src/__tests__/devicesMethod.test.ts:72:21)

Test Suites: 2 failed, 2 passed, 4 total
Tests:       3 failed, 11 passed, 14 total
Snapshots:   0 total
Time:        3.572 s
Ran all test suites.
```

| ID | Severity | Status | Category | Finding | Recommendation |
|----|----------|--------|----------|---------|----------------|
| gate-runner-r1-f1 | High | Open | Gate | Phase exit gate failed when run unattended | Fix the code so every gate command passes |
