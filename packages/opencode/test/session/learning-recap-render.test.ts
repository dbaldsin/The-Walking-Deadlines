import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { LearningRecap } from "@/session/learning-recap"
import { LearningRecapRender } from "@/session/learning-recap-render"

describe("LearningRecapRender.fromParts", () => {
  test("collects completed bash calls as tests", () => {
    const parts = [
      { type: "tool", tool: "bash", state: { status: "completed", title: "bun test", metadata: { exit: 0 }, output: "4 pass" } },
      {
        type: "tool",
        tool: "bash",
        state: { status: "completed", title: "npm test", metadata: { exit: 1 }, output: "1 failed" },
      },
    ]
    const info = LearningRecapRender.fromParts(parts, [])
    expect(info.tests?.map((test) => test.status)).toEqual(["passed", "failed"])
    expect(() => Schema.decodeUnknownSync(LearningRecap.Info)(info)).not.toThrow()
  })

  test("ignores non-bash tools and calls that are not completed", () => {
    const parts = [
      { type: "tool", tool: "read", state: { status: "completed", title: "read package.json", metadata: {}, output: "{}" } },
      { type: "tool", tool: "bash", state: { status: "running", title: "bun test", metadata: {}, output: "" } },
      { type: "text", state: { status: "completed" } },
    ]
    expect(LearningRecapRender.fromParts(parts, [])).toEqual({})
  })

  test("reports nothing when the turn ran only non-test commands and changed no files", () => {
    // A routine tool call like `ls` shouldn't get "No files changed / No tests
    // were run" boilerplate tacked on -- there's nothing to teach here, and
    // existing output for a turn like this must stay exactly as it was.
    const parts = [{ type: "tool", tool: "bash", state: { status: "completed", title: "ls -la", metadata: { exit: 0 }, output: "" } }]
    expect(LearningRecapRender.fromParts(parts, [])).toEqual({})
  })

  test("still shows the no-tests message when files changed but no tests ran", () => {
    const changedFiles = [{ file: "src/foo.ts", additions: 4, deletions: 1, status: "modified" as const }]
    const info = LearningRecapRender.fromParts([], changedFiles)
    expect(info.tests).toEqual([])
    expect(info.changedFiles).toEqual(changedFiles)
  })

  test("treats a missing exit code as not-run", () => {
    const parts = [{ type: "tool", tool: "bash", state: { status: "completed", title: "bun test", metadata: {}, output: "" } }]
    expect(LearningRecapRender.fromParts(parts, []).tests).toEqual([{ command: "bun test", status: "not-run" }])
  })

  test("collects the task's changed files alongside the tests", () => {
    const changedFiles = [{ file: "src/foo.ts", additions: 4, deletions: 1, status: "modified" as const }]
    const info = LearningRecapRender.fromParts([], changedFiles)
    expect(info.changedFiles).toEqual(changedFiles)
    expect(() => Schema.decodeUnknownSync(LearningRecap.Info)(info)).not.toThrow()
  })
})

describe("LearningRecapRender.render", () => {
  test("renders a heading and the formatted test lines", () => {
    const text = LearningRecapRender.render({
      tests: [{ command: "bun test", status: "passed", summary: "4 pass" }],
    })
    expect(text).toBe("## Learning Recap\n\n### Tests\n- bun test: passed (4 pass)")
  })

  test("shows the clear no-tests message when the task ran no tests", () => {
    const text = LearningRecapRender.render({ tests: [] })
    expect(text).toBe("## Learning Recap\n\n### Tests\n- No tests were run during this task.")
  })

  test("renders files changed above tests, each with its own heading", () => {
    const text = LearningRecapRender.render({
      changedFiles: [{ file: "src/foo.ts", additions: 4, deletions: 1, status: "modified" }],
      tests: [{ command: "bun test", status: "passed" }],
    })
    expect(text).toBe(
      "## Learning Recap\n\n### Files changed\n- src/foo.ts (modified, +4/-1)\n\n### Tests\n- bun test: passed",
    )
  })

  test("renders nothing when the recap has no sections to show", () => {
    expect(LearningRecapRender.render({})).toBeUndefined()
  })
})
