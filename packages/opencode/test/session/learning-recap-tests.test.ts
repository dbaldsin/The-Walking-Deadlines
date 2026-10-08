import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { LearningRecap } from "@/session/learning-recap"
import { collect, format, fromShell, isTestCommand } from "@/session/learning-recap-tests"

describe("isTestCommand", () => {
  test("recognizes common test runners", () => {
    for (const command of [
      "bun test",
      "bun test test/session/learning-recap.test.ts",
      "npm test",
      "npm run test:unit",
      "pnpm test",
      "npx jest --watch=false",
      "pytest -q",
      "python -m pytest tests/",
      "go test ./...",
      "cargo test",
      "make test",
    ]) {
      expect(isTestCommand(command)).toBe(true)
    }
  })

  test("finds a test run inside a compound command", () => {
    expect(isTestCommand("cd packages/opencode && bun test")).toBe(true)
    expect(isTestCommand("CI=1 npm test")).toBe(true)
  })

  test("ignores commands that only mention tests", () => {
    for (const command of ["ls test", "cat test.txt", 'git commit -m "bun test"', "bun install", "echo npm test"]) {
      expect(isTestCommand(command)).toBe(false)
    }
  })

  test("recognizes runners for other languages and frameworks", () => {
    for (const command of [
      "npm t",
      "vitest run",
      "playwright test",
      "deno test",
      "node --test",
      "node --experimental-test-coverage --test test/",
      "cargo nextest run",
      "dotnet test",
      "ctest --output-on-failure",
      "rails test",
      "bin/rails test test/models",
      "php artisan test",
    ]) {
      expect(isTestCommand(command)).toBe(true)
    }
  })

  test("recognizes build tools that run other tasks before the tests", () => {
    for (const command of [
      "mvn test",
      "mvn clean test",
      "mvn -q -Dtest=UserTest test",
      "./mvnw verify test",
      "gradle test",
      "gradle :app:test",
      "./gradlew clean test --info",
    ]) {
      expect(isTestCommand(command)).toBe(true)
    }
  })

  test("ignores Gradle commands that exclude the test task", () => {
    for (const command of [
      "gradle build -x test",
      "gradle build --exclude-task test",
      "gradle build --exclude-task=test",
      "gradle test -x test",
      "./gradlew -x test clean test",
      "./gradlew :app:test --exclude-task :app:test",
      "gradle :app:test -x test",
      "timeout 600 ./gradlew test --exclude-task test",
    ]) {
      expect(isTestCommand(command)).toBe(false)
    }
  })

  test("still recognizes Gradle test runs when a different task is excluded", () => {
    for (const command of [
      "gradle test -x lint",
      "./gradlew build --exclude-task javadoc test",
      "gradle test -x :app:test",
      "./gradlew test --tests UserTest",
    ]) {
      expect(isTestCommand(command)).toBe(true)
    }
  })

  test("recognizes runners launched through a wrapper", () => {
    for (const command of [
      "npx --yes jest",
      "bunx --bun vitest",
      "pnpm exec vitest run",
      "pnpm dlx jest",
      "yarn jest",
      "yarn dlx vitest",
      "uv run pytest -q",
      "poetry run pytest",
      "pipenv run python -m pytest",
      "bundle exec rspec spec/models",
      "timeout 60 bun test",
      "CI=1 npx jest",
    ]) {
      expect(isTestCommand(command)).toBe(true)
    }
  })

  test("ignores other tasks of the same tools", () => {
    for (const command of [
      "cargo build",
      "cargo nextest list",
      "dotnet build",
      "mvn clean package",
      "gradle build -x test",
      "./gradlew assemble",
      "node script.js --test",
      "node --version",
      "deno run main.ts",
      "rails server",
      "php artisan migrate",
      "npx prettier --check .",
      "uv run python main.py",
      "yarn install",
      'git commit -m "jest"',
      "echo pytest",
    ]) {
      expect(isTestCommand(command)).toBe(false)
    }
  })
})

describe("fromShell", () => {
  test("records a successful test run", () => {
    expect(
      fromShell({ command: "bun test", exit: 0, output: "bun test v1.3\n\n 4 pass\n 0 fail\nRan 4 tests" }),
    ).toEqual({
      command: "bun test",
      status: "passed",
      summary: "4 pass, 0 fail",
    })
  })

  test("records a failed test run with the runner's totals line", () => {
    expect(
      fromShell({ command: "npm test", exit: 1, output: "FAIL src/a.test.ts\nTests: 1 failed, 3 passed, 4 total\n" }),
    ).toEqual({ command: "npm test", status: "failed", summary: "Tests: 1 failed, 3 passed, 4 total" })
  })

  test("reads label-first totals from Maven and dotnet", () => {
    expect(
      fromShell({
        command: "mvn test",
        exit: 1,
        output:
          "[INFO] Running UserTest\n[ERROR] Tests run: 3, Failures: 1, Errors: 0, Skipped: 0\n[INFO] BUILD FAILURE",
      }),
    ).toEqual({
      command: "mvn test",
      status: "failed",
      summary: "[ERROR] Tests run: 3, Failures: 1, Errors: 0, Skipped: 0",
    })
    expect(
      fromShell({
        command: "dotnet test",
        exit: 0,
        output: "Build succeeded.\nPassed!  - Failed:     0, Passed:     4, Skipped:     0, Total:     4",
      }),
    ).toEqual({
      command: "dotnet test",
      status: "passed",
      summary: "Passed!  - Failed:     0, Passed:     4, Skipped:     0, Total:     4",
    })
  })

  test("records results from wrapped and build-tool runners", () => {
    expect(fromShell({ command: "uv run pytest", exit: 1, output: "1 failed, 3 passed in 0.12s" })).toEqual({
      command: "uv run pytest",
      status: "failed",
      summary: "1 failed, 3 passed in 0.12s",
    })
    expect(
      fromShell({ command: "cargo nextest run", exit: 0, output: "Summary [0.2s] 5 tests run: 5 passed, 0 skipped" }),
    ).toEqual({
      command: "cargo nextest run",
      status: "passed",
      summary: "Summary [0.2s] 5 tests run: 5 passed, 0 skipped",
    })
    expect(fromShell({ command: "./gradlew clean test", exit: null })).toEqual({
      command: "./gradlew clean test",
      status: "not-run",
    })
  })

  test("falls back to the last output line when there are no totals", () => {
    expect(fromShell({ command: "make test", exit: 2, output: "building\nmake: *** [test] Error 2" })).toEqual({
      command: "make test",
      status: "failed",
      summary: "make: *** [test] Error 2",
    })
  })

  test("marks a test run that never finished as not-run", () => {
    expect(fromShell({ command: "bun test", exit: null, output: "(no output)" })).toEqual({
      command: "bun test",
      status: "not-run",
    })
  })

  test("truncates long summaries", () => {
    const result = fromShell({ command: "pytest", exit: 1, output: "x".repeat(500) })
    expect(result?.summary?.length).toBe(120)
    expect(result?.summary?.endsWith("...")).toBe(true)
  })

  test("returns nothing for non-test commands", () => {
    expect(fromShell({ command: "ls -la", exit: 0, output: "total 0" })).toBeUndefined()
  })
})

describe("collect and format", () => {
  const calls = [
    { command: "ls", exit: 0, output: "a" },
    { command: "bun test", exit: 1, output: "1 fail" },
    { command: "bun test", exit: 0, output: "5 pass" },
  ]

  test("collects only test runs, in order, and they satisfy the recap schema", () => {
    const tests = collect(calls)
    expect(tests.map((test) => test.status)).toEqual(["failed", "passed"])
    expect(() => Schema.decodeUnknownSync(LearningRecap.Info)({ tests })).not.toThrow()
  })

  test("lists each command with its status", () => {
    expect(format(collect(calls))).toEqual(["bun test: failed (1 fail)", "bun test: passed (5 pass)"])
  })

  test("shows a clear message when no tests were run", () => {
    expect(format(collect([{ command: "ls", exit: 0 }]))).toEqual(["No tests were run during this task."])
    expect(format(undefined)).toEqual(["No tests were run during this task."])
  })
})

describe("failing test names", () => {
  test("lists failing tests from bun output", () => {
    const output = [
      "bun test v1.4.2",
      "a.test.ts:",
      "error: expect(received).toBe(expected)",
      "(fail) math > adds [0.12ms]",
      "(pass) math > ok [0.02ms]",
      "(fail) top level fails [0.28ms]",
      " 1 pass",
      " 2 fail",
    ].join("\n")
    expect(fromShell({ command: "bun test", exit: 1, output })?.failures).toEqual(["math > adds", "top level fails"])
  })

  test("lists failing tests from jest output without duplicating verbose marks", () => {
    const output = [
      "FAIL src/math.test.ts",
      "  math",
      "    ✓ subtracts (2 ms)",
      "    ✕ adds (5 ms)",
      "  ● math › adds",
      "    expect(received).toBe(expected)",
      "  ● Console",
      "Tests: 1 failed, 1 passed, 2 total",
    ].join("\n")
    expect(fromShell({ command: "npx jest", exit: 1, output })?.failures).toEqual(["math › adds"])
  })

  test("skips jest suite-level errors that are not tests", () => {
    const output = ["FAIL src/broken.test.ts", "  ● Test suite failed to run", "Tests: 0 total"].join("\n")
    expect(fromShell({ command: "npx jest", exit: 1, output })?.failures).toBeUndefined()
  })

  test("lists failing tests from vitest output", () => {
    const output = [
      " ❯ src/math.test.ts (2 tests | 1 failed) 4ms",
      "   × adds 3ms",
      "⎯⎯⎯ Failed Tests 1 ⎯⎯⎯",
      " FAIL  src/math.test.ts > math > adds",
      "AssertionError: expected 2 to be 3",
      " Tests  1 failed | 1 passed (2)",
    ].join("\n")
    expect(fromShell({ command: "vitest run", exit: 1, output })?.failures).toEqual(["src/math.test.ts > math > adds"])
  })

  test("falls back to verbose failure marks when there is no failure summary", () => {
    const output = ["✓ subtracts 1ms", "× adds 3ms", "× divides by zero 1ms", "2 failed, 1 passed"].join("\n")
    expect(fromShell({ command: "vitest run", exit: 1, output })?.failures).toEqual(["adds", "divides by zero"])
  })

  test("lists failing tests from pytest, go, and cargo output", () => {
    expect(
      fromShell({
        command: "pytest -q",
        exit: 1,
        output: [
          "FAILED tests/test_math.py::test_adds - assert 2 == 3",
          "FAILED tests/test_math.py::test_div[0] - ZeroDivisionError",
          "2 failed, 3 passed in 0.12s",
        ].join("\n"),
      })?.failures,
    ).toEqual(["tests/test_math.py::test_adds", "tests/test_math.py::test_div[0]"])
    expect(
      fromShell({
        command: "go test ./...",
        exit: 1,
        output: "--- FAIL: TestAdds (0.00s)\n    math_test.go:8: got 2\nFAIL\nFAIL\texample/math\t0.01s",
      })?.failures,
    ).toEqual(["TestAdds"])
    expect(
      fromShell({
        command: "cargo test",
        exit: 101,
        output: "test tests::ok ... ok\ntest tests::adds ... FAILED\ntest result: FAILED. 1 passed; 1 failed",
      })?.failures,
    ).toEqual(["tests::adds"])
    expect(
      fromShell({
        command: "cargo test -q",
        exit: 101,
        output: "tests::adds --- FAILED\ntest result: FAILED. 1 passed",
      })?.failures,
    ).toEqual(["tests::adds"])
  })

  test("lists each failing test once even when the runner repeats it", () => {
    const output = "(fail) adds [0.1ms]\n1 fail\n\n(fail) adds [0.1ms]\n1 fail"
    expect(fromShell({ command: "bun test", exit: 1, output })?.failures).toEqual(["adds"])
  })

  test("keeps passed and not-run results unchanged", () => {
    expect(fromShell({ command: "bun test", exit: 0, output: "(fail) flaky retried [1ms]\n3 pass" })).toEqual({
      command: "bun test",
      status: "passed",
      summary: "3 pass",
    })
    expect(fromShell({ command: "bun test", exit: null, output: "(fail) adds [1ms]" })).toEqual({
      command: "bun test",
      status: "not-run",
      summary: "(fail) adds [1ms]",
    })
  })

  test("falls back to the summary line when no failing names can be parsed", () => {
    expect(fromShell({ command: "make test", exit: 2, output: "make: *** [test] Error 2" })).toEqual({
      command: "make test",
      status: "failed",
      summary: "make: *** [test] Error 2",
    })
  })

  test("formats failing names as a nested list, at most five, and they satisfy the recap schema", () => {
    const failures = ["a", "b", "c", "d", "e", "f", "g"]
    const tests = [{ command: "bun test", status: "failed" as const, summary: "7 fail", failures }]
    expect(() => Schema.decodeUnknownSync(LearningRecap.Info)({ tests })).not.toThrow()
    expect(format(tests)).toEqual([
      ["bun test: failed (7 fail)", "  - a", "  - b", "  - c", "  - d", "  - e", "  - …and 2 more"].join("\n"),
    ])
  })

  test("does not add a remainder line for five or fewer failures", () => {
    expect(format([{ command: "bun test", status: "failed", failures: ["a", "b"] }])).toEqual([
      "bun test: failed\n  - a\n  - b",
    ])
  })
})
