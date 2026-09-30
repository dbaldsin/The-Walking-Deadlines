import type { TestResult } from "./learning-recap"

const RUNNERS = [
  /^(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?test(?:\s|:|$)/,
  /^(?:bunx|npx|pnpm\s+dlx|yarn\s+dlx)\s+(?:jest|vitest|mocha|playwright\s+test)(?:\s|$)/,
  /^(?:jest|vitest|mocha|pytest|tox|phpunit|rspec)(?:\s|$)/,
  /^python3?\s+-m\s+(?:pytest|unittest)(?:\s|$)/,
  /^(?:go|cargo|dotnet|swift|mvn|gradle|\.\/gradlew)\s+test(?:\s|$)/,
  /^make\s+(?:test|check)(?:\s|$)/,
]

// Lines that usually carry the runner's own totals, e.g. "4 pass", "Tests: 1 failed", "2 passed, 1 failed".
const TOTALS = /\b\d+\s+(?:tests?\s+)?(?:pass(?:ed|ing)?|fail(?:ed|ing|ures?)?|skipped)\b/i

const MAX_SUMMARY = 120

export function isTestCommand(command: string) {
  return command
    .split(/&&|\|\||;|\|/)
    .map((part) => part.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, ""))
    .some((part) => RUNNERS.some((runner) => runner.test(part)))
}

/**
 * Turns one finished shell call into a recap test result.
 * Returns undefined when the command was not a test run. A missing exit code
 * (timeout or abort) means the tests never finished, so they are "not-run".
 */
export function fromShell(input: { command: string; exit: number | null | undefined; output?: string }) {
  if (!isTestCommand(input.command)) return
  const status = input.exit === undefined || input.exit === null ? "not-run" : input.exit === 0 ? "passed" : "failed"
  const lines = (input.output ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  const totals = lines.filter((item) => TOTALS.test(item)).slice(-2)
  const line = totals.length > 0 ? totals.join(", ") : lines.at(-1)
  const result: TestResult = { command: input.command, status }
  if (!line || line === "(no output)") return result
  return { ...result, summary: line.length > MAX_SUMMARY ? line.slice(0, MAX_SUMMARY - 3) + "..." : line }
}

/** Collects test results from a task's shell calls, skipping commands that were not tests. */
export function collect(calls: ReadonlyArray<Parameters<typeof fromShell>[0]>) {
  return calls.flatMap((call) => fromShell(call) ?? [])
}

/** Recap-ready lines for the tests section, with a clear message when no tests were run. */
export function format(tests: ReadonlyArray<TestResult> | undefined) {
  if (!tests || tests.length === 0) return ["No tests were run during this task."]
  return tests.map((test) => `${test.command}: ${test.status}${test.summary ? ` (${test.summary})` : ""}`)
}
