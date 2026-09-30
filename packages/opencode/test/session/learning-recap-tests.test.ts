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
})

describe("fromShell", () => {
  test("records a successful test run", () => {
    expect(fromShell({ command: "bun test", exit: 0, output: "bun test v1.3\n\n 4 pass\n 0 fail\nRan 4 tests" })).toEqual({
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
