import type { TestResult } from "./learning-recap"

const RUNNERS = [
  /^(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?test(?:\s|:|$)/,
  /^npm\s+t(?:\s|$)/,
  /^(?:jest|vitest|mocha|pytest|tox|phpunit|rspec|ctest)(?:\s|$)/,
  /^playwright\s+test(?:\s|$)/,
  /^python3?\s+-m\s+(?:pytest|unittest)(?:\s|$)/,
  /^(?:go|cargo|dotnet|swift|deno)\s+test(?:\s|$)/,
  /^cargo\s+nextest\s+run(?:\s|$)/,
  // Maven accepts other goals and flags before the test goal: "mvn clean test". Gradle is checked by gradleRunsTests.
  /^(?:mvn|\.\/mvnw)(?:\s+\S+)*?\s+test(?:\s|$)/,
  // Only Node's own flags may come before --test; "node script.js --test" passes it to the script.
  /^node(?:\s+-\S+)*\s+--test(?:\s|=|$)/,
  /^(?:rails|bin\/rails|php\s+artisan)\s+test(?:\s|$)/,
  /^make\s+(?:test|check)(?:\s|$)/,
]

// Commands that launch another command, e.g. "npx --yes jest", "uv run pytest", "timeout 60 bun test".
const WRAPPER =
  /^(?:npx|bunx|yarn\s+dlx|yarn|pnpm\s+(?:exec|dlx)|uv\s+run|poetry\s+run|pipenv\s+run|bundle\s+exec|timeout\s+\d+[smh]?)(?:\s+--?[\w-]+)*\s+/

// docker options that take their value as a separate word, e.g. "-e CI=1", "-w /app", "-f compose.yml". Every other
// option is either a flag ("--rm", "-it", "-T") or carries its value after "=" ("--env=CI=1").
const DOCKER_VALUE_OPTIONS = new Set([
  "-e",
  "--env",
  "--env-file",
  "-v",
  "--volume",
  "-w",
  "--workdir",
  "-u",
  "--user",
  "-p",
  "--publish",
  "--project-name",
  "--name",
  "--network",
  "--entrypoint",
  "-l",
  "--label",
  "-f",
  "--file",
])

// Lines that usually carry the runner's own totals, e.g. "4 pass", "Tests: 1 failed", "2 passed, 1 failed",
// or label-first totals from JUnit/Maven and dotnet, e.g. "Tests run: 3, Failures: 1", "Failed: 1, Passed: 3".
const TOTALS = [
  /\b\d+\s+(?:tests?\s+)?(?:pass(?:ed|ing)?|fail(?:ed|ing|ures?)?|skip(?:ped)?)\b/i,
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
// Several totals lines are kept so that a separate skip line (bun prints "42 pass", "3 skip", "0 fail") is not lost.
const MAX_TOTALS = 3

/** The command itself plus each command it launches, with wrappers like "npx", "uv run" or "docker run app" removed one at a time. */
function unwrap(part: string): string[] {
  const next = dockerInner(part) ?? part.replace(WRAPPER, "")
  return next === part ? [part] : [part, ...unwrap(next)]
}

/** Skips docker options starting at index, returning the index of the first word that is not an option or its value. */
function skipDockerOptions(words: string[], index: number) {
  while (index < words.length && words[index].startsWith("-")) {
    index += DOCKER_VALUE_OPTIONS.has(words[index]) ? 2 : 1
  }
  return index
}

/**
 * The command docker runs inside a container for "docker run|exec", "docker compose run|exec" and
 * "docker-compose run|exec", e.g. "npm test" for "docker compose -f ci.yml run --rm -e CI=1 app npm test".
 * The first word after docker's options is the image, container or service, and the rest is the command.
 * Undefined for other docker commands ("docker build .", "docker compose up") or when no command is given.
 */
function dockerInner(part: string) {
  const words = part.split(/\s+/)
  const compose = words[0] === "docker-compose" ? 1 : words[0] === "docker" && words[1] === "compose" ? 2 : 0
  if (!compose && words[0] !== "docker") return
  const sub = compose ? skipDockerOptions(words, compose) : 1
  if (words[sub] !== "run" && words[sub] !== "exec") return
  const inner = words.slice(skipDockerOptions(words, sub + 1) + 1).join(" ")
  return inner || undefined
}

/** True when the test command comes after another step in an && chain, e.g. "npm run lint && npm test". */
function afterOtherSteps(command: string) {
  return command.split("&&").findIndex(isTestCommand) > 0
}

export function isTestCommand(command: string) {
  return command
    .split(/&&|\|\||;|\|/)
    .map((part) => part.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, ""))
    .flatMap(unwrap)
    .some((part) => RUNNERS.some((runner) => runner.test(part)) || gradleRunsTests(part))
}

/**
 * Gradle runs a test task when one is requested ("gradle clean test", "gradle :app:test") and not excluded.
 * "-x test" / "--exclude-task test" skip every "test" task wherever they appear, even after "test" was
 * requested; an excluded ":app:test" only skips that project's task.
 */
function gradleRunsTests(part: string) {
  const [tool, ...words] = part.split(/\s+/)
  if (tool !== "gradle" && tool !== "./gradlew") return false
  const excluded = words.flatMap((word, index) => {
    if (word.startsWith("--exclude-task=")) return [word.slice("--exclude-task=".length)]
    return word === "-x" || word === "--exclude-task" ? words.slice(index + 1, index + 2) : []
  })
  return words.some(
    (word, index) =>
      /^(?:\S*:)?test$/.test(word) &&
      words[index - 1] !== "-x" &&
      words[index - 1] !== "--exclude-task" &&
      !excluded.includes(word) &&
      !excluded.includes("test"),
  )
}

/**
 * Turns one finished shell call into a recap test result.
 * Returns undefined when the command was not a test run. A missing exit code
 * (timeout or abort) means the tests never finished, so they are "not-run".
 */
export function fromShell(input: { command: string; exit: number | null | undefined; output?: string }) {
  if (!isTestCommand(input.command)) return
  const exited = input.exit === undefined || input.exit === null ? "not-run" : input.exit === 0 ? "passed" : "failed"
  const lines = (input.output ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  const totals = lines.filter((item) => TOTALS.some((totals) => totals.test(item))).slice(-MAX_TOTALS)
  const line = totals.length > 0 ? totals.join(", ") : lines.at(-1)
  const named = exited === "failed" ? failingTests(lines) : []
  // "npm run lint && npm test" that fails with no test totals or names in its output most likely stopped before
  // the tests started, so the tests did not run. The recap only sees the chain's last exit code and combined output.
  const stoppedEarly = exited === "failed" && !totals.length && !named.length && afterOtherSteps(input.command)
  const status = stoppedEarly ? "not-run" : exited
  const failures = status === "failed" ? named : []
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

/**
 * Recap-ready lines for the tests section, with a clear message when no tests were run. With two or more runs the
 * section starts with the last run's result, then lists every run in the order they happened.
 */
export function format(tests: ReadonlyArray<TestResult> | undefined) {
  if (!tests || tests.length === 0) return ["No tests were run during this task."]
  const runs = tests.map((test) => {
    // Failing test names become a nested list under their command once render() adds the outer "- ".
    const failures = test.failures ?? []
    return [
      `${test.command}: ${test.status}${test.summary ? ` (${test.summary})` : ""}`,
      ...failures.slice(0, MAX_FAILURES).map((name) => `  - ${name}`),
      ...(failures.length > MAX_FAILURES ? [`  - …and ${failures.length - MAX_FAILURES} more`] : []),
      ...(test.status === "failed" && failures.length === 0 ? ["  - Failing tests could not be identified."] : []),
    ].join("\n")
  })
  if (tests.length < 2) return runs
  return [`Final: ${tests.at(-1)!.status} (after ${tests.length} runs)`, ...runs]
}

export * as LearningRecapTests from "./learning-recap-tests"
