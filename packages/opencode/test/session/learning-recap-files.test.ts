import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { LearningRecap } from "@/session/learning-recap"
import { collect, format } from "@/session/learning-recap-files"

const diffs = [
  { file: "src/new.ts", additions: 10, deletions: 0, status: "added" as const },
  { file: "src/old.ts", additions: 0, deletions: 5, status: "deleted" as const },
  { file: "src/edited.ts", additions: 2, deletions: 2, status: "modified" as const },
]

describe("collect", () => {
  test("keeps the status from the task diff", () => {
    expect(collect(diffs)).toEqual(diffs)
  })

  test("keeps one-sided edits to existing files as modified", () => {
    const edits = [
      { file: "src/grew.ts", additions: 5, deletions: 0, status: "modified" as const },
      { file: "src/shrank.ts", additions: 0, deletions: 3, status: "modified" as const },
    ]
    expect(collect(edits).map((file) => file.status)).toEqual(["modified", "modified"])
  })

  test("does not claim added or deleted from line counts when the status is missing", () => {
    const unknown = [
      { file: "src/grew.ts", additions: 5, deletions: 0 },
      { file: "src/shrank.ts", additions: 0, deletions: 3 },
    ]
    expect(collect(unknown).map((file) => file.status)).toEqual([undefined, undefined])
  })

  test("keeps the latest diff when the same file appears more than once", () => {
    const repeated = [
      { file: "src/a.ts", additions: 1, deletions: 0, status: "added" as const },
      { file: "src/a.ts", additions: 4, deletions: 1, status: "added" as const },
    ]
    expect(collect(repeated)).toEqual([{ file: "src/a.ts", additions: 4, deletions: 1, status: "added" }])
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
      "src/new.ts (added, +10/-0)",
      "src/old.ts (deleted, +0/-5)",
      "src/edited.ts (modified, +2/-2)",
    ])
  })

  test("leaves out the status when the task diff did not provide one", () => {
    expect(format([{ file: "src/grew.ts", additions: 5, deletions: 0 }])).toEqual(["src/grew.ts (+5/-0)"])
  })

  test("shows a clear message when nothing changed", () => {
    expect(format([])).toEqual(["No files were changed during this task."])
    expect(format(undefined)).toEqual(["No files were changed during this task."])
  })
})
