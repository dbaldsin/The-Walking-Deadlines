import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { collect, format, fromShell } from "@/session/learning-recap-tests"
import type { TestResult } from "@/session/learning-recap"

// Properties for P4B. Each test names the requirement it checks (see traceability/sangyoon.md) and its kind.
// Generators stay close to what a coding agent actually runs, so most cases hit real parsing rules instead of
// random strings that would never look like a test command or runner output.

const options = { numRuns: 200 }

// Runners the recap recognizes, from several ecosystems, so no property depends on one runner's syntax.
const runner = fc.constantFrom(
  "bun test",
  "npm test",
  "npm run test",
  "pnpm test",
  "npx jest",
  "vitest run",
  "pytest -q",
  "python -m pytest",
  "go test ./...",
  "cargo test",
  "mvn clean test",
)

// Prefixes that launch the runner without changing what it reports (wrappers and env assignments).
const launcher = fc.constantFrom("", "timeout 60 ", "CI=1 ", "FORCE_COLOR=0 CI=1 ")
const testCommand = fc.tuple(launcher, runner).map(([prefix, command]) => prefix + command)

// Steps an agent chains before the tests. None of them is a test run on its own.
const setupStep = fc.constantFrom("npm run lint", "cd app", "tsc --noEmit", "make build", "bun install", "ruff check .")

// Output from a step that stopped before any test ran: lint, type-check, install and module errors. None of
// these lines contains test totals or a failing test name, which is exactly the case R2 and R4 are about.
const noTestOutput = fc
  .array(
    fc.constantFrom(
      "✖ 2 problems (2 errors, 0 warnings)",
      "src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "error: Cannot find module './x'",
      "npm ERR! code ELIFECYCLE",
      "make: *** [build] Error 1",
      "E501 line too long (120 > 88)",
      "",
    ),
    { maxLength: 5 },
  )
  .map((lines) => lines.join("\n"))

// Output that shows the tests did run: a totals line or a failing test name from a common runner.
const testEvidence = fc.constantFrom(
  "Tests: 1 failed, 4 passed, 5 total",
  "3 pass\n1 fail",
  "(fail) math > adds [0.12ms]",
  "FAILED tests/test_math.py::test_add - assert 3 == 4",
  "--- FAIL: TestAdd (0.00s)",
  "==== 2 failed, 10 passed in 0.31s ====",
)

// Nonzero exit codes, biased to the common 1 but including others runners and shells use.
const failingExit = fc.oneof({ weight: 3, arbitrary: fc.constant(1) }, fc.constantFrom(2, 101, 124, 127, 130))
const anyOutput = fc.oneof(noTestOutput, testEvidence, fc.string({ maxLength: 60 }))

describe("R1: a run that never finished is not-run, never passed", () => {
  // R1: A test run that never finished (timed out or aborted, with no exit code) is recorded as not-run,
  // never as passed, even if some tests passed before it stopped.
  // Kind: invariant.
  // Generators: the output mixes in totals such as "3 pass", the case C-6 and O-7 worried about.
  test("R1: a missing exit code gives not-run whatever the output says; exit 0 gives passed", () => {
    fc.assert(
      fc.property(testCommand, anyOutput, fc.constantFrom(null, undefined), (command, output, exit) => {
        expect(fromShell({ command, exit, output })?.status).toBe("not-run")
        expect(fromShell({ command, exit: 0, output })?.status).toBe("passed")
      }),
      options,
    )
  })
})

describe("R2: tests that a failed earlier step prevented are not-run", () => {
  // R2 (revised): When a test command follows one or more non-test steps in an && chain, the run fails, and
  // its output contains no test totals and no failing test names, the run is recorded as not-run, not failed.
  // When the output does show test totals or failing names, it is recorded as failed.
  // Kind: invariant.
  // Generators: one to three setup steps before the runner; output either from a step that stopped early
  // (lint, tsc, missing module) or containing real test evidence, the two cases in R2's acceptance criteria.
  test("R2: a failed && chain with no test evidence is not-run; with test evidence it is failed", () => {
    fc.assert(
      fc.property(
        fc.array(setupStep, { minLength: 1, maxLength: 3 }),
        testCommand,
        failingExit,
        noTestOutput,
        testEvidence,
        (steps, tests, exit, early, evidence) => {
          const command = [...steps, tests].join(" && ")
          expect(fromShell({ command, exit, output: early })?.status).toBe("not-run")
          expect(fromShell({ command, exit, output: `${early}\n${evidence}` })?.status).toBe("failed")
        },
      ),
      options,
    )
  })

  // Kind: invariant. Without a step before the runner, the runner itself failed, so R2 must not apply.
  test("R2: a runner with no step before it still fails when its output has no test evidence", () => {
    fc.assert(
      fc.property(testCommand, failingExit, noTestOutput, (command, exit, output) => {
        expect(fromShell({ command, exit, output })?.status).toBe("failed")
      }),
      options,
    )
  })
})

// Failing test names as each runner prints them. bun and jest names may contain spaces and ">" suites; go
// names are identifiers. The generator avoids brackets and timings so a name cannot be mistaken for the
// runner's "[1.2ms]" suffix.
const spacedName = fc.stringMatching(/^[a-z][a-z0-9 >_-]{0,18}[a-z0-9]$/)
const failureStyle = fc.constantFrom(
  { line: (name: string) => `(fail) ${name} [0.1ms]`, name: spacedName, totals: (n: number) => `${n} fail` },
  { line: (name: string) => `● ${name}`, name: spacedName, totals: (n: number) => `Tests: ${n} failed, ${n} total` },
  {
    line: (name: string) => `--- FAIL: ${name} (0.00s)`,
    name: fc.stringMatching(/^Test[A-Z][A-Za-z0-9_]{0,15}$/),
    totals: (n: number) => `FAIL\t${n} failed`,
  },
)

// Counts biased to the boundaries interviewees named: exactly five shown, one over, and 20 (C-14, O-16).
const failureCount = fc.oneof(fc.constantFrom(1, 4, 5, 6, 20), fc.integer({ min: 1, max: 30 }))

const failedRun = failureStyle.chain((style) =>
  failureCount.chain((count) =>
    fc
      .uniqueArray(style.name, { minLength: count + 1, maxLength: count + 1 })
      .filter((names) => names.length === count + 1)
      // Runners like bun repeat the failure list in a final summary, so sometimes the names appear twice.
      .chain((names) =>
        fc.boolean().map((repeat) => ({ style, names: names.slice(0, count), extra: names[count], repeat })),
      ),
  ),
)

function output(
  style: { line: (name: string) => string; totals: (n: number) => string },
  names: string[],
  repeat: boolean,
) {
  const block = [...names.map(style.line), style.totals(names.length)]
  return (repeat ? [...block, ...block] : block).join("\n")
}

describe("R3: failing test names, in order, at most five", () => {
  // R3: A failed run lists the failing tests' names in the order the runner printed them, at most five,
  // followed by a line saying how many more there are.
  // Kind: model/oracle. The oracle is the generated name list itself: the first five names, then
  // "…and N more" exactly when there are more than five.
  test("R3: the recap shows the first five failing names in printed order and counts the rest", () => {
    fc.assert(
      fc.property(failedRun, runner, ({ style, names, repeat }, command) => {
        const result = fromShell({ command, exit: 1, output: output(style, names, repeat) })
        expect(result?.failures).toEqual(names)
        const lines = format([result!])[0].split("\n").slice(1)
        const expected = [
          ...names.slice(0, 5).map((name) => `  - ${name}`),
          ...(names.length > 5 ? [`  - …and ${names.length - 5} more`] : []),
        ]
        expect(lines).toEqual(expected)
      }),
      options,
    )
  })

  // Kind: metamorphic. Input change: one more test fails (its line is added after the others).
  // Expected output change: the earlier names stay, in the same order, and the new name comes after them.
  test("R3: one more failing test keeps the earlier names in order and adds the new one after them", () => {
    fc.assert(
      fc.property(failedRun, runner, ({ style, names, extra, repeat }, command) => {
        const before = fromShell({ command, exit: 1, output: output(style, names, repeat) })
        const after = fromShell({ command, exit: 1, output: output(style, [...names, extra], repeat) })
        expect(after?.failures).toEqual([...(before?.failures ?? []), extra])
      }),
      options,
    )
  })
})

describe("R4: a failed run with no identifiable failing tests says so", () => {
  const MESSAGE = "  - Failing tests could not be identified."

  // R4: When a run fails and no failing test names can be found in its output, the recap says so explicitly
  // instead of showing nothing under the command.
  // Kind: invariant.
  // Generators: crash output with no test names (missing module, compile error), and real failure output
  // from failedRun as the contrast case, so the message appears exactly when names are missing.
  test("R4: the 'could not be identified' line appears exactly when a failed run has no names", () => {
    fc.assert(
      fc.property(testCommand, failingExit, noTestOutput, failedRun, (command, exit, crash, named) => {
        const unnamed = fromShell({ command, exit, output: crash })!
        expect(unnamed.status).toBe("failed")
        expect(format([unnamed])[0].split("\n")).toEqual([expect.stringMatching(/: failed/), MESSAGE])

        const withNames = fromShell({ command, exit, output: output(named.style, named.names, named.repeat) })!
        expect(format([withNames])[0]).not.toContain(MESSAGE)
      }),
      options,
    )
  })

  // Kind: invariant. Passed and not-run runs have no failing tests to identify, so they never get the message.
  test("R4: passed and not-run runs never get the message", () => {
    fc.assert(
      fc.property(testCommand, anyOutput, fc.constantFrom(0, null), (command, out, exit) => {
        expect(format([fromShell({ command, exit, output: out })!])[0]).not.toContain(MESSAGE)
      }),
      options,
    )
  })
})

// Totals as bun, jest, vitest and pytest print them. Runners leave out zero categories, except bun's "fail".
const totalsStyle = fc.constantFrom(
  {
    skipText: (s: number) => `${s} skip`,
    print: (p: number, f: number, s: number) => [
      `${p} pass`,
      ...(s ? [`${s} skip`] : []),
      `${f} fail`,
      `Ran ${p + f + s} tests across 1 file. [12.00ms]`,
    ],
  },
  {
    skipText: (s: number) => `${s} skipped`,
    print: (p: number, f: number, s: number) => [
      `Test Suites: ${f ? "1 failed, " : ""}1 total`,
      `Tests: ${[s && `${s} skipped`, f && `${f} failed`, p && `${p} passed`].filter(Boolean).join(", ")}, ${p + f + s} total`,
    ],
  },
  {
    skipText: (s: number) => `${s} skipped`,
    print: (p: number, f: number, s: number) => [
      `Tests  ${[f && `${f} failed`, p && `${p} passed`, s && `${s} skipped`].filter(Boolean).join(" | ")} (${p + f + s})`,
    ],
  },
  {
    skipText: (s: number) => `${s} skipped`,
    print: (p: number, f: number, s: number) => [
      `==== ${[f && `${f} failed`, p && `${p} passed`, s && `${s} skipped`].filter(Boolean).join(", ")} in 0.12s ====`,
    ],
  },
)
// Pass and skip counts include 0 and small numbers next to large ones, like C-7's "42 tests, 3 skipped".
const count = fc.oneof(fc.constantFrom(0, 1, 3, 42), fc.integer({ min: 0, max: 5000 }))

describe("R5: skipped tests are reported but do not change the status", () => {
  // R5 (revised): When a run's totals report a skip count ("N skip" from bun, "N skipped" from jest, vitest or
  // pytest), the run's summary includes that count. Skipped tests do not change the run's status.
  // Kind: invariant. Whenever skips are reported, the summary contains the skip count.
  test("R5: the summary contains the skip count whenever the runner reports skips", () => {
    fc.assert(
      fc.property(totalsStyle, runner, count, count, fc.integer({ min: 1, max: 5000 }), (style, command, p, f, s) => {
        const result = fromShell({ command, exit: f ? 1 : 0, output: style.print(p, f, s).join("\n") })
        expect(result?.summary).toContain(style.skipText(s))
      }),
      options,
    )
  })

  // Kind: metamorphic. Input change: some of the passing tests are skipped instead.
  // Expected output change: the status stays the same; only the summary changes.
  test("R5: turning passing tests into skipped tests never changes the status", () => {
    fc.assert(
      fc.property(totalsStyle, runner, count, count, count, (style, command, p, f, s) => {
        const exit = f ? 1 : 0
        const without = fromShell({ command, exit, output: style.print(p + s, f, 0).join("\n") })
        const withSkips = fromShell({ command, exit, output: style.print(p, f, s).join("\n") })
        expect(withSkips?.status).toBe(without!.status)
      }),
      options,
    )
  })
})

// docker's own options before the image, container or service, in every form R6 covers: boolean flags,
// combined short flags, "--flag=value", and value flags written as two words ("-e CI=1", "-w /app").
const dockerOption = fc.constantFrom(
  "--rm",
  "-it",
  "-T",
  "-d",
  "-e CI=1",
  "--env=CI=1",
  "-v $PWD:/app",
  "--volume=/tmp:/tmp",
  "-w /app",
  "--workdir /app",
  "-u node",
  "--name runner",
  "--network host",
)
// Image and service names, including ones that look like runners ("jest", "test") to make sure the name
// is never mistaken for the command.
const target = fc.constantFrom("app", "web", "node:20", "python:3.12-slim", "jest", "test")
const dockerOptions = fc
  .array(dockerOption, { maxLength: 3 })
  .map((list) => list.map((option) => `${option} `).join(""))
const dockerPrefix = fc.oneof(
  fc.tuple(dockerOptions, target).map(([opts, name]) => `docker run ${opts}${name} `),
  fc.tuple(dockerOptions, target).map(([opts, name]) => `docker exec ${opts}${name} `),
  fc
    .tuple(
      fc.constantFrom("", "-f docker-compose.test.yml ", "--file ci.yml "),
      fc.constantFrom("run", "exec"),
      dockerOptions,
      target,
    )
    .map(([file, sub, opts, name]) => `docker compose ${file}${sub} ${opts}${name} `),
  fc.tuple(dockerOptions, target).map(([opts, name]) => `docker-compose run ${opts}${name} `),
)

// The command inside the container. Unlike testCommand it has no "CI=1" style prefix: docker would try to execute
// "CI=1" as a program, so environment variables are passed with -e/--env instead (see dockerOption).
const containerCommand = fc
  .tuple(fc.constantFrom("", "timeout 60 "), runner)
  .map(([prefix, command]) => prefix + command)

describe("R6: tests run inside docker are recorded like the inner command", () => {
  // R6 (revised): Test commands run with docker run, docker exec, docker compose run/exec or docker-compose run
  // are recognized as test runs when docker's own options are boolean flags, "--flag=value", or one of the
  // common value flags (-e, -v, -w, -u, -p, --name, --network, --env, --volume, --workdir, --user, -f/--file).
  // Their result is the same as running the inner command directly with the same exit code and output.
  // Kind: metamorphic. Input change: wrap the command in docker. Expected output change: only the
  // recorded command text changes; status, summary and failing names are identical.
  test("R6: wrapping a test command in docker changes only the recorded command", () => {
    fc.assert(
      fc.property(
        dockerPrefix,
        containerCommand,
        fc.constantFrom(0, 1, null),
        anyOutput,
        (prefix, inner, exit, out) => {
          const direct = fromShell({ command: inner, exit, output: out })
          const docker = fromShell({ command: prefix + inner, exit, output: out })
          expect(docker).toEqual({ ...direct!, command: prefix + inner })
        },
      ),
      options,
    )
  })

  // Kind: invariant. A docker command with no test command inside is never recorded, even when the image,
  // container or service is named like a runner.
  test("R6: docker commands that run no tests are not recorded", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          dockerPrefix.map((prefix) => prefix.trim()),
          dockerPrefix.map((prefix) => `${prefix}ls -la`),
          fc.constantFrom("docker compose up", "docker compose up -d test", "docker build .", "docker build -t jest ."),
        ),
        (command) => {
          expect(fromShell({ command, exit: 0, output: "" })).toBeUndefined()
        },
      ),
      options,
    )
  })
})

const status = fc.constantFrom<TestResult["status"]>("passed", "failed", "not-run")
const result = fc.record(
  { command: runner, status, summary: fc.constantFrom("3 pass", "1 fail") },
  { requiredKeys: ["command", "status"] },
)

describe("R7: a final result line before the history", () => {
  // R7: When a task has two or more test runs, the Tests section begins with a final-result line taken from
  // the last run, followed by every run in the order they happened.
  // Kind: model/oracle. The oracle for the first line is the last run's status and the run count; the
  // history must equal each run formatted on its own, in order.
  // Generators: zero to eight runs with any mix of statuses, so the last run is sometimes the only failure
  // or the only pass, the case O-6 and C-9 cared about.
  test("R7: the Tests section starts with Final: <last status> (after N runs), then every run in order", () => {
    fc.assert(
      fc.property(fc.array(result, { maxLength: 8 }), (tests) => {
        const lines = format(tests)
        const history = tests.flatMap((test) => format([test]))
        if (tests.length < 2) {
          expect(lines.some((line) => line.startsWith("Final:"))).toBe(false)
          return
        }
        expect(lines).toEqual([`Final: ${tests.at(-1)!.status} (after ${tests.length} runs)`, ...history])
      }),
      options,
    )
  })

  // Kind: model/oracle. Non-test commands between and after test runs are ignored, so the final line comes from
  // the last test run, not the last command.
  test("R7: the final line comes from the last test run even when other commands follow it", () => {
    const call = fc.oneof(
      fc.record({ command: runner, exit: fc.constantFrom(0, 1, null), output: fc.constant("1 pass") }),
      fc.record({
        command: fc.constantFrom("ls", "git status", "cat package.json"),
        exit: fc.constant(0),
        output: fc.constant(""),
      }),
    )
    fc.assert(
      fc.property(fc.array(call, { maxLength: 10 }), (calls) => {
        const runs = calls.filter((item) => fromShell(item))
        const lines = format(collect(calls))
        if (runs.length < 2) return
        const last = runs.at(-1)!
        const expected = last.exit === null ? "not-run" : last.exit === 0 ? "passed" : "failed"
        expect(lines[0]).toBe(`Final: ${expected} (after ${runs.length} runs)`)
      }),
      options,
    )
  })
})
