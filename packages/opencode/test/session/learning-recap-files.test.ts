import { formatPatch, structuredPatch } from "diff"
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
  test("keeps the status from the task diff, sorted by path", () => {
    expect(collect(diffs)).toEqual([diffs[2], diffs[0], diffs[1]])
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
      "3 files changed: 1 added, 1 modified, 1 deleted",
      "src/new.ts (added, +10/-0)",
      "src/edited.ts (modified, +2/-2)",
      "src/old.ts (deleted, +0/-5)",
    ])
  })

  test("leaves out the status when the task diff did not provide one", () => {
    expect(format([{ file: "src/grew.ts", additions: 5, deletions: 0 }])).toEqual([
      "1 file changed: 0 added, 0 modified, 0 deleted, 1 with unknown status",
      "src/grew.ts (+5/-0)",
    ])
  })

  test("groups by status and sorts by path in any input order (R6 acceptance criteria)", () => {
    const task = [
      { file: "src/b.ts", additions: 1, deletions: 0, status: "modified" as const },
      { file: "docs/old.md", additions: 0, deletions: 3, status: "deleted" as const },
      { file: "src/a.ts", additions: 1, deletions: 0, status: "modified" as const },
      { file: "lib/new.ts", additions: 2, deletions: 0, status: "added" as const },
    ]
    const expected = [
      "4 files changed: 1 added, 2 modified, 1 deleted",
      "lib/new.ts (added, +2/-0)",
      "src/a.ts (modified, +1/-0)",
      "src/b.ts (modified, +1/-0)",
      "docs/old.md (deleted, +0/-3)",
    ]
    const orders = (items: typeof task): (typeof task)[] =>
      items.length <= 1
        ? [items]
        : items.flatMap((item, index) => orders(items.toSpliced(index, 1)).map((rest) => [item, ...rest]))
    const all = orders(task)
    expect(all).toHaveLength(24)
    for (const order of all) expect(format(collect(order))).toEqual(expected)
  })

  test("starts with a summary line whose counts match the entries (R7 acceptance criteria)", () => {
    expect(
      format(
        collect([
          { file: "a.ts", additions: 3, deletions: 0, status: "added" },
          { file: "b.ts", additions: 1, deletions: 1, status: "modified" },
          { file: "c.ts", additions: 2, deletions: 0, status: "modified" },
        ]),
      ),
    ).toEqual([
      "3 files changed: 1 added, 2 modified, 0 deleted",
      "a.ts (added, +3/-0)",
      "b.ts (modified, +1/-1)",
      "c.ts (modified, +2/-0)",
    ])
    const many = [
      ...Array.from({ length: 10 }, (_, i) => ({
        file: `added/${i}.ts`,
        additions: 1,
        deletions: 0,
        status: "added" as const,
      })),
      ...Array.from({ length: 38 }, (_, i) => ({
        file: `modified/${i}.ts`,
        additions: 1,
        deletions: 1,
        status: "modified" as const,
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        file: `deleted/${i}.ts`,
        additions: 0,
        deletions: 1,
        status: "deleted" as const,
      })),
    ]
    expect(format(collect(many))[0]).toBe("50 files changed: 10 added, 38 modified, 2 deleted")
  })

  test("shows a moved and edited file as one rename with its line counts (R8 acceptance criteria)", () => {
    const old = Array.from({ length: 10 }, (_, i) => `line ${i}\n`)
    const edited = ["new a\n", "new b\n", "new c\n", ...old.slice(1)]
    const patch = (file: string, sign: string, lines: string[]) =>
      `--- ${file}\n+++ ${file}\n@@ ${sign === "-" ? `-1,${lines.length} +0,0` : `-0,0 +1,${lines.length}`} @@\n` +
      lines.map((text) => sign + text).join("")
    const task = [
      {
        file: "src/old.ts",
        patch: patch("src/old.ts", "-", old),
        additions: 0,
        deletions: 10,
        status: "deleted" as const,
      },
      {
        file: "src/new.ts",
        patch: patch("src/new.ts", "+", edited),
        additions: 12,
        deletions: 0,
        status: "added" as const,
      },
    ]
    expect(format(collect(task))).toEqual([
      "1 file changed: 0 added, 0 modified, 0 deleted, 1 renamed",
      "src/old.ts renamed to src/new.ts (renamed, +3/-1)",
    ])
    expect(format(collect([...task, { file: "a.ts", additions: 1, deletions: 0, status: "modified" }]))).toEqual([
      "2 files changed: 0 added, 1 modified, 0 deleted, 1 renamed",
      "a.ts (modified, +1/-0)",
      "src/old.ts renamed to src/new.ts (renamed, +3/-1)",
    ])
  })

  test("keeps a deletion and an addition when their content is too different or can't be compared", () => {
    const different = [
      {
        file: "old.ts",
        patch: "--- old.ts\n+++ old.ts\n@@ -1,1 +0,0 @@\n-a\n",
        additions: 0,
        deletions: 1,
        status: "deleted" as const,
      },
      {
        file: "new.ts",
        patch: "--- new.ts\n+++ new.ts\n@@ -0,0 +1,1 @@\n+b\n",
        additions: 1,
        deletions: 0,
        status: "added" as const,
      },
    ]
    expect(format(collect(different)).slice(1)).toEqual(["new.ts (added, +1/-0)", "old.ts (deleted, +0/-1)"])
    const binary = different.map((file) => ({ ...file, patch: "", additions: 0, deletions: 0 }))
    expect(format(collect(binary)).slice(1)).toEqual(["new.ts (added, +0/-0)", "old.ts (deleted, +0/-0)"])
  })

  test("matches exact moves before edited ones when two files move in one task (review on PR #53)", () => {
    const patch = (file: string, before: string, after: string) =>
      formatPatch(structuredPatch(file, file, before, after, "", "", { context: Number.MAX_SAFE_INTEGER }))
    const a = Array.from({ length: 8 }, (_, i) => `base-line-${i}\n`).join("")
    const b = [...Array.from({ length: 6 }, (_, i) => `base-line-${i}\n`), "file-b-ln-6\n", "file-b-ln-7\n"].join("")
    const aNew = [...Array.from({ length: 5 }, (_, i) => `base-line-${i + 3}\n`), "new-1\n", "new-2\n", "new-3\n"].join(
      "",
    )
    const task = [
      { file: "a-old", patch: patch("a-old", a, ""), additions: 0, deletions: 8, status: "deleted" as const },
      { file: "b-old", patch: patch("b-old", b, ""), additions: 0, deletions: 8, status: "deleted" as const },
      { file: "a-new", patch: patch("a-new", "", aNew), additions: 8, deletions: 0, status: "added" as const },
      { file: "b-new", patch: patch("b-new", "", b), additions: 8, deletions: 0, status: "added" as const },
    ]
    expect(format(collect(task))).toEqual([
      "2 files changed: 0 added, 0 modified, 0 deleted, 2 renamed",
      "a-old renamed to a-new (renamed, +3/-3)",
      "b-old renamed to b-new (renamed, +0/-0)",
    ])
  })

  test("matches a folder of unchanged moves directly, without comparing every pair (review on PR #53)", () => {
    const patch = (file: string, before: string, after: string) =>
      formatPatch(structuredPatch(file, file, before, after, "", "", { context: Number.MAX_SAFE_INTEGER }))
    const task = Array.from({ length: 30 }, (_, f) => {
      const text = Array.from({ length: 300 }, (_, l) => `file${f}-line${l}\n`).join("")
      const name = `f${String(f).padStart(2, "0")}.ts`
      return [
        {
          file: `old/${name}`,
          patch: patch(`old/${name}`, text, ""),
          additions: 0,
          deletions: 300,
          status: "deleted" as const,
        },
        {
          file: `new/${name}`,
          patch: patch(`new/${name}`, "", text),
          additions: 300,
          deletions: 0,
          status: "added" as const,
        },
      ]
    }).flat()
    const started = performance.now()
    const lines = format(collect(task))
    const elapsed = performance.now() - started
    expect(lines[0]).toBe("30 files changed: 0 added, 0 modified, 0 deleted, 30 renamed")
    expect(lines.slice(1)).toEqual(
      Array.from({ length: 30 }, (_, f) => {
        const name = `f${String(f).padStart(2, "0")}.ts`
        return `old/${name} renamed to new/${name} (renamed, +0/-0)`
      }),
    )
    // Comparing all 900 pairs line by line took about 10 seconds; direct matching takes milliseconds.
    expect(elapsed).toBeLessThan(2000)
  })

  test("keeps an added file whose patch can't be read, such as a path with a newline (review on PR #53)", () => {
    const file = "notes\n2026.txt"
    const diff = {
      file,
      patch: formatPatch(structuredPatch(file, file, "", "hello\n", "", "", { context: Number.MAX_SAFE_INTEGER })),
      additions: 1,
      deletions: 0,
      status: "added" as const,
    }
    expect(format(collect([diff]))).toEqual([
      "1 file changed: 1 added, 0 modified, 0 deleted",
      `${file} (added, +1/-0)`,
    ])
    expect(format(collect([{ ...diff, patch: "@@ not a patch" }]))).toEqual([
      "1 file changed: 1 added, 0 modified, 0 deleted",
      `${file} (added, +1/-0)`,
    ])
  })

  test("shows a clear message when nothing changed", () => {
    expect(format([])).toEqual(["No files were changed during this task."])
    expect(format(undefined)).toEqual(["No files were changed during this task."])
  })
})
