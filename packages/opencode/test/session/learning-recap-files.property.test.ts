import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { collect, format } from "@/session/learning-recap-files"

const path = fc.constantFrom("src/a.ts", "src/b.ts", "docs/with space.md", "src/日本語.ts")
const counts = fc.record({
  additions: fc.integer({ min: 0, max: 10000 }),
  deletions: fc.integer({ min: 0, max: 10000 }),
})
const diff = fc.record({
  file: fc.option(fc.oneof(path, fc.constant("")), { nil: undefined }),
  additions: fc.integer({ min: 0, max: 10000 }),
  deletions: fc.integer({ min: 0, max: 10000 }),
  status: fc.option(fc.constantFrom("added" as const, "deleted" as const, "modified" as const), { nil: undefined }),
})
const diffs = fc.array(diff, { maxLength: 50 })
const options = { numRuns: 100 }

describe("changed-file recap properties", () => {
  test("keeps exactly one entry per nonempty path using its last input value", () => {
    fc.assert(
      fc.property(diffs, (input) => {
        const output = collect(input)
        expect(output.length).toBe(new Set(input.filter((entry) => entry.file).map((entry) => entry.file)).size)
        expect(new Set(output.map((entry) => entry.file)).size).toBe(output.length)
        input
          .filter((entry) => entry.file)
          .forEach((entry) => {
            // The oracle searches the original input; it does not rebuild collect's Map.
            expect(input.findLast((item) => item.file === entry.file)).toEqual(
              output.find((item) => item.file === entry.file),
            )
          })
        expect(output.every((entry) => Boolean(entry.file))).toBe(true)
      }),
      options,
    )
  }, 5000)

  test("a later duplicate replaces earlier counts and status", () => {
    fc.assert(
      fc.property(path, diff, counts, (file, first, last) => {
        const replacement = { file, ...last }
        expect(collect([{ ...first, file, status: "added" }, replacement])).toEqual([replacement])
      }),
      options,
    )
  }, 5000)

  test("preserves every explicit status and leaves one-sided unknown edits unknown", () => {
    fc.assert(
      fc.property(path, counts, (file, change) => {
        for (const status of ["added", "deleted", "modified"] as const) {
          expect(collect([{ file, ...change, status }])[0]?.status).toBe(status)
        }
        for (const edit of [
          { file, additions: change.additions, deletions: 0 },
          { file, additions: 0, deletions: change.deletions },
        ]) {
          expect(collect([edit])[0]?.status).toBeUndefined()
          expect(format(collect([edit]))).toEqual([`${file} (+${edit.additions}/-${edit.deletions})`])
        }
      }),
      options,
    )
  }, 5000)

  test("formats selected paths, statuses and counts without changing the input", () => {
    fc.assert(
      fc.property(diffs, (input) => {
        const before = structuredClone(input)
        const selected = collect(input)
        const lines = format(selected)
        expect(lines).toHaveLength(selected.length || 1)
        selected.forEach((entry, index) => {
          expect(lines[index]).toBe(
            entry.status
              ? `${entry.file} (${entry.status}, +${entry.additions}/-${entry.deletions})`
              : `${entry.file} (+${entry.additions}/-${entry.deletions})`,
          )
        })
        expect(input).toEqual(before)
      }),
      options,
    )
  }, 5000)

  test("explains empty output including lists containing only missing paths", () => {
    fc.assert(
      fc.property(fc.array(counts, { maxLength: 50 }), (input) => {
        const message = ["No files were changed during this task."]
        expect(format(collect(input))).toEqual(message)
        expect(format(collect(input.map((entry) => ({ ...entry, file: "" }))))).toEqual(message)
        expect(format([])).toEqual(message)
        expect(format(undefined)).toEqual(message)
      }),
      options,
    )
  }, 5000)
})
