import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { LearningRecap } from "@/session/learning-recap"
import { collect, format, statusOf } from "@/session/learning-recap-files"

const diffs = [
  { file: "src/a.ts", additions: 10, deletions: 0 },
  { file: "src/b.ts", additions: 0, deletions: 5 },
  { file: "src/c.ts", additions: 2, deletions: 2, status: "modified" as const },
]

describe("statusOf", () => {
  test("keeps an explicit status", () => {
    expect(statusOf({ file: "a.ts", additions: 3, deletions: 1, status: "modified" })).toBe("modified")
  })

  test("infers added when nothing was deleted", () => {
    expect(statusOf({ file: "a.ts", additions: 12, deletions: 0 })).toBe("added")
  })

  test("infers deleted when nothing was added", () => {
    expect(statusOf({ file: "a.ts", additions: 0, deletions: 8 })).toBe("deleted")
  })

  test("falls back to modified when both sides changed or nothing did", () => {
    expect(statusOf({ file: "a.ts", additions: 2, deletions: 2 })).toBe("modified")
    expect(statusOf({ file: "a.ts", additions: 0, deletions: 0 })).toBe("modified")
  })
})

describe("collect", () => {
  test("collects created, modified, and deleted files with correct statuses", () => {
    expect(collect(diffs)).toEqual([
      { file: "src/a.ts", additions: 10, deletions: 0, status: "added" },
      { file: "src/b.ts", additions: 0, deletions: 5, status: "deleted" },
      { file: "src/c.ts", additions: 2, deletions: 2, status: "modified" },
    ])
  })

  test("keeps the latest diff when the same file appears more than once", () => {
    const repeated = [
      { file: "src/a.ts", additions: 1, deletions: 0 },
      { file: "src/a.ts", additions: 4, deletions: 1 },
    ]
    expect(collect(repeated)).toEqual([{ file: "src/a.ts", additions: 4, deletions: 1, status: "modified" }])
  })

  test("drops entries with no file path", () => {
    expect(collect([{ additions: 1, deletions: 0 }])).toEqual([])
  })

  test("returns an empty result for a task with no file changes", () => {
    expect(collect([])).toEqual([])
  })

  test("collected files satisfy the recap schema", () => {
    const changedFiles = collect(diffs)
    expect(() => Schema.decodeUnknownSync(LearningRecap.Info)({ changedFiles })).not.toThrow()
  })
})

describe("format", () => {
  test("lists each file with its status and counts", () => {
    expect(format(collect(diffs))).toEqual([
      "src/a.ts (added, +10/-0)",
      "src/b.ts (deleted, +0/-5)",
      "src/c.ts (modified, +2/-2)",
    ])
  })

  test("shows a clear message when nothing changed", () => {
    expect(format([])).toEqual(["No files were changed during this task."])
    expect(format(undefined)).toEqual(["No files were changed during this task."])
  })
})
