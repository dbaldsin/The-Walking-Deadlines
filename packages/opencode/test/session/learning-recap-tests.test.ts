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
