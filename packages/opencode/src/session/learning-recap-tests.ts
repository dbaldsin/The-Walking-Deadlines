import type { TestResult } from "./learning-recap"

const RUNNERS = [
  /^(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?test(?:\s|:|$)/,
  /^npm\s+t(?:\s|$)/,
  /^(?:jest|vitest|mocha|pytest|tox|phpunit|rspec|ctest)(?:\s|$)/,
  /^playwright\s+test(?:\s|$)/,
  /^python3?\s+-m\s+(?:pytest|unittest)(?:\s|$)/,
  /^(?:go|cargo|dotnet|swift|deno)\s+test(?:\s|$)/,
  /^cargo\s+nextest\s+run(?:\s|$)/,
  // Build tools accept goals/tasks and flags before the test task: "mvn clean test", "gradle :app:test".
  // "-x test" excludes the task in Gradle, so it does not count.
  /^(?:mvn|\.\/mvnw|gradle|\.\/gradlew)(?:\s+\S+)*?(?<!\s-x)\s+(?:\S*:)?test(?:\s|$)/,
  // Only Node's own flags may come before --test; "node script.js --test" passes it to the script.
  /^node(?:\s+-\S+)*\s+--test(?:\s|=|$)/,
  /^(?:rails|bin\/rails|php\s+artisan)\s+test(?:\s|$)/,
  /^make\s+(?:test|check)(?:\s|$)/,
]

// Commands that launch another command, e.g. "npx --yes jest", "uv run pytest", "timeout 60 bun test".
const WRAPPER =
  /^(?:npx|bunx|yarn\s+dlx|yarn|pnpm\s+(?:exec|dlx)|uv\s+run|poetry\s+run|pipenv\s+run|bundle\s+exec|timeout\s+\d+[smh]?)(?:\s+--?[\w-]+)*\s+/

// Lines that usually carry the runner's own totals, e.g. "4 pass", "Tests: 1 failed", "2 passed, 1 failed",
// or label-first totals from JUnit/Maven and dotnet, e.g. "Tests run: 3, Failures: 1", "Failed: 1, Passed: 3".
const TOTALS = [
  /\b\d+\s+(?:tests?\s+)?(?:pass(?:ed|ing)?|fail(?:ed|ing|ures?)?|skipped)\b/i,
  /\b(?:tests\s+run|pass(?:ed)?|fail(?:ed|ures)?):\s*\d+/i,
]

// Lines that name one failing test, as runners print them: bun "(fail) suite > name [1.2ms]", jest "● suite › name",
// vitest "FAIL  file > suite > name", pytest "FAILED file::name - reason", go "--- FAIL: TestName (0.00s)",
// cargo "test name ... FAILED" (or "name --- FAILED" with -q). Jest also uses "●" for suite-level errors and console output, which are not tests.
const FAILURES = [
  /^\(fail\)\s+(.+?)(?:\s+\[[\d.]+\s*m?s\])?$/,
  /^●\s+(?!Test suite failed to run$|Console$)(.+)$/,
  /^FAIL\s+(\S+\s+>\s+.+)$/,
  /^FAILED\s+(\S+)/,
  /^--- FAIL:\s+(\S+)/,
  /^(?:test\s+)?(\S+)\s+(?:\.\.\.|---)\s+FAILED$/,
]

// Per-test marks from verbose reporters (jest "✕ name (5 ms)", vitest "× name 5ms"). They are only used when no line
// above names a failure, because jest prints both forms for the same test.
const FAILURE_MARK = /^[✕×✗]\s+(.+?)(?:\s+\(?\d+(?:\.\d+)?\s*m?s\)?)?$/

const MAX_SUMMARY = 120
const MAX_FAILURES = 5

/** The command itself plus each command it launches, with wrappers like "npx" or "uv run" removed one at a time. */
function unwrap(part: string): string[] {
  const next = part.replace(WRAPPER, "")
  return next === part ? [part] : [part, ...unwrap(next)]
}

export function isTestCommand(command: string) {
  return command
    .split(/&&|\|\||;|\|/)
    .map((part) => part.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, ""))
    .flatMap(unwrap)
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
  const totals = lines.filter((item) => TOTALS.some((totals) => totals.test(item))).slice(-2)
  const line = totals.length > 0 ? totals.join(", ") : lines.at(-1)
  const failures = status === "failed" ? failingTests(lines) : []
  const result: TestResult = { command: input.command, status, ...(failures.length > 0 && { failures }) }
  if (!line || line === "(no output)") return result
  return { ...result, summary: line.length > MAX_SUMMARY ? line.slice(0, MAX_SUMMARY - 3) + "..." : line }
}

/** Names of the failing tests in a run's output, each listed once, in the order the runner printed them. */
function failingTests(lines: string[]) {
  const named = lines.flatMap((line) => FAILURES.flatMap((pattern) => pattern.exec(line)?.[1] ?? []))
  return [...new Set(named.length > 0 ? named : lines.flatMap((line) => FAILURE_MARK.exec(line)?.[1] ?? []))]
}

/** Collects test results from a task's shell calls, skipping commands that were not tests. */
export function collect(calls: ReadonlyArray<Parameters<typeof fromShell>[0]>) {
  return calls.flatMap((call) => fromShell(call) ?? [])
}

/** Recap-ready lines for the tests section, with a clear message when no tests were run. */
export function format(tests: ReadonlyArray<TestResult> | undefined) {
  if (!tests || tests.length === 0) return ["No tests were run during this task."]
  return tests.map((test) => {
    // Failing test names become a nested list under their command once render() adds the outer "- ".
    const failures = test.failures ?? []
    return [
      `${test.command}: ${test.status}${test.summary ? ` (${test.summary})` : ""}`,
      ...failures.slice(0, MAX_FAILURES).map((name) => `  - ${name}`),
      ...(failures.length > MAX_FAILURES ? [`  - …and ${failures.length - MAX_FAILURES} more`] : []),
    ].join("\n")
  })
}

export * as LearningRecapTests from "./learning-recap-tests"
