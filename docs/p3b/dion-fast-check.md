# Dion — P3B fast-check integration

## Tool and scope

fast-check 4.10.2 generates and shrinks test inputs. Five properties exercise the real `collect()` and `format()` functions in `packages/opencode/src/session/learning-recap-files.ts`: unique nonempty paths with last-occurrence values, replacement of duplicate counts/status, preservation of explicit and missing statuses, output paths/counts/status and input immutability, and the empty-change message.

## Installation evidence

`packages/opencode/package.json` pins fast-check as a development dependency; root `bun.lock` records the resolved package and integrity. It was previously only a transitive dependency of Effect; this PR adds direct ownership and actual property-test usage.

## Customization and development process

The new `packages/opencode/test/session/learning-recap-files.property.test.ts` uses Bun's existing test runner. Each of five properties runs 100 generated cases, with a five-second test timeout. Lists contain at most 50 entries. A four-path pool (including spaces and Unicode) encourages collisions. Counts range from 0 to 10,000. Generators cover missing/empty paths, absent status, all three explicit statuses, zero counts, and one-sided edits. Dedicated properties guarantee missing status and every explicit status are exercised on every run.

The existing `.github/workflows/test.yml` runs `bun turbo test --concurrency=4` in its `unit` job on pushes and pull requests. That discovers this file through the existing opencode test script. No duplicate workflow, installation step, VM traffic, provider call, or production-code change is needed. A failed property fails `unit`. Making that status required in main's branch rules remains a team integration task; the branch was unprotected when checked on October 28, 2026.

Run from `packages/opencode`:

```sh
bun test --timeout 30000 test/session/learning-recap-files.property.test.ts
bun test --timeout 30000 test/session/learning-recap
bun typecheck
```

On a failure, copy fast-check's seed and path into the failing `fc.assert` options alongside `numRuns: 100` to replay its counterexample. Remove temporary replay options after diagnosing the failure. Keep a fixed regression case for any real bug discovered.

## Evidence and sensitivity check

- [Focused property output](dion-properties.txt)
- [Existing recap suite plus new properties](dion-recap-tests.txt)
- [Typecheck output](dion-typecheck.txt)
- [Deliberate regression output](dion-mutation.txt)

For the deliberate regression, the input to collect's Map was temporarily reversed so the first duplicate won. The new suite failed and shrank the duplicate-path counterexample. The production file was restored before the final passing runs and is unchanged in this PR. The mutation log is expected to show failures; it is evidence of detection, not the final check's status.

## False positives, false negatives, and plan changes

No production defect or false-positive report was found by these properties. The deliberate first-duplicate-wins bug was a true positive. This does not establish an absence of false negatives: bounded generated inputs cannot prove correctness, and these properties do not test providers, the deployed UI, arbitrary diff sizes, or the rest of the recap pipeline.

The implementation follows the design's scope, 100-case limit, 50-entry lists, five-second property timeout, direct dev dependency, existing unit-job integration, and deliberate regression validation. It additionally checks input immutability and paths containing spaces/Unicode. Local runs without the package's normal timeout hit an existing preload cleanup hook's default timeout; use the configured 30-second suite timeout for focused runs too. The five-second property timeout remains unchanged. No production fix, ignored finding, narrowed target, or workflow change was needed.
