// Property-based tests for the "Files changed" part of the Learning Recap (Project 4B, snaimi).
// Each property names the requirement it checks (see traceability/snaimi.md) and its kind.
//
// Two layers are tested:
// - Pure properties call `collect` and `format` directly with generated FileDiff lists. They are fast,
//   so they run many cases.
// - Repository properties build a real temporary git repository, take real opencode snapshots before,
//   during and after a generated task, and read the diff with `Snapshot.diffFull`, the same path
//   `SessionSummary` uses. They are slower, so they run fewer cases, but they check the requirement
//   against what git actually reports instead of against hand-written diffs.
import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import fc from "fast-check"
import { formatPatch, structuredPatch } from "diff"
import { Effect, Layer } from "effect"
import * as TestConsole from "effect/testing/TestConsole"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { FileDiff } from "@opencode-ai/schema/file-diff"
import { collect, format } from "@/session/learning-recap-files"
import { Snapshot } from "../../src/snapshot"
import { disposeAllInstances, TestInstance, testInstanceStoreLayer, withTmpdirInstance } from "../fixture/fixture"

const NO_CHANGES = ["No files were changed during this task."]

// ---------------------------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------------------------

// Paths: a fixed pool instead of random strings, so that generated tasks keep hitting the same files
// (repeated edits, create-then-delete, rename onto a free path). The pool mixes the cases that make
// ordering and paths tricky: nested folders, a space, non-ASCII characters, upper case and a dash,
// which sort differently from "/" and lower case. No file name is also used as a folder name, so any
// subset of the pool can exist at the same time.
const PATHS = [
  "x.ts",
  "a-b.ts",
  "README.md",
  "lib/y.ts",
  "lib/z.ts",
  "src/a.ts",
  "src/nested/deep.ts",
  "docs/with space.md",
  "src/日本語.ts",
] as const
const filePath = fc.constantFrom(...PATHS)

// Lines: short printable text, plus lines that look like diff syntax ("+", "-", "---") so that the
// rename check, which reads file content back out of patches, cannot be fooled by content that
// resembles a patch.
const line = fc.oneof(
  { weight: 4, arbitrary: fc.string({ maxLength: 12 }).map((text) => text.replaceAll("\\", "/")) },
  { weight: 1, arbitrary: fc.constantFrom("+", "-", "--- a", "+++ b", "@@ -1 +1 @@", "") },
)

// File contents: empty files, files ending with a newline and files without one. Git reports the last
// two differently ("\ No newline at end of file"), so both have to be covered.
const content = fc.oneof(
  { weight: 1, arbitrary: fc.constant("") },
  { weight: 4, arbitrary: fc.array(line, { minLength: 1, maxLength: 6 }).map((lines) => lines.join("\n") + "\n") },
  { weight: 2, arbitrary: fc.array(line, { minLength: 1, maxLength: 6 }).map((lines) => lines.join("\n")) },
)

// The same unified patch that Snapshot.diffFull stores for a text file.
function textPatch(file: string, before: string, after: string) {
  return formatPatch(structuredPatch(file, file, before, after, "", "", { context: Number.MAX_SAFE_INTEGER }))
}

function textDiff(
  file: string,
  status: "added" | "deleted" | "modified",
  before: string,
  after: string,
): FileDiff.Info {
  const lines = structuredPatch(file, file, before, after, "", "", { context: 0 }).hunks.flatMap((hunk) => hunk.lines)
  return {
    file,
    patch: textPatch(file, before, after),
    additions: lines.filter((item) => item.startsWith("+")).length,
    deletions: lines.filter((item) => item.startsWith("-")).length,
    status,
  }
}

// One diff entry as the recap can receive it: a text file with a real patch and any status, a binary
// file (Snapshot.diffFull stores an empty patch and zero counts), an entry with no status (saved before
// statuses existed) or an entry with no path.
const anyDiff: fc.Arbitrary<FileDiff.Info> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc
      .tuple(filePath, fc.constantFrom("added" as const, "deleted" as const, "modified" as const), content, content)
      .map(([file, status, before, after]) =>
        textDiff(file, status, status === "added" ? "" : before, status === "deleted" ? "" : after + "changed\n"),
      ),
  },
  {
    weight: 1,
    arbitrary: fc
      .tuple(filePath, fc.constantFrom("added" as const, "deleted" as const, "modified" as const))
      .map(([file, status]) => ({ file, patch: "", additions: 0, deletions: 0, status })),
  },
  {
    weight: 1,
    arbitrary: fc
      .tuple(filePath, fc.nat({ max: 500 }), fc.nat({ max: 500 }))
      .map(([file, additions, deletions]) => ({ file, additions, deletions })),
  },
  {
    weight: 1,
    arbitrary: fc
      .tuple(fc.constantFrom(undefined, ""), fc.nat({ max: 50 }), fc.nat({ max: 50 }))
      .map(([file, additions, deletions]) => ({ file, additions, deletions })),
  },
)

// A rename as git reports it with renames turned off: the old path deleted and the new path added,
// with the same text (a pure move).
const renamePair = fc
  .tuple(fc.uniqueArray(filePath, { minLength: 2, maxLength: 2 }), content)
  .map(([[from, to], text]) => [textDiff(from, "deleted", text, ""), textDiff(to, "added", "", text)])

const diffList = fc
  .tuple(fc.array(anyDiff, { maxLength: 30 }), fc.array(renamePair, { maxLength: 2 }))
  .chain(([diffs, pairs]) =>
    fc.shuffledSubarray([...diffs, ...pairs.flat()], { minLength: diffs.length + pairs.length * 2 }),
  )

// ---------------------------------------------------------------------------------------------
// Reading the formatted recap back
// ---------------------------------------------------------------------------------------------

type Entry = {
  paths: string[]
  status: "added" | "modified" | "deleted" | "renamed" | undefined | "unparsed"
  additions: number
  deletions: number
  line: string
}

const SUMMARY = /^\d+ files? changed: /

// Splits format()'s output into the summary line (if any) and one parsed entry per listed line.
function parse(lines: string[]) {
  const summary = lines.length > 0 && SUMMARY.test(lines[0]) ? lines[0] : undefined
  const entries: Entry[] = (summary ? lines.slice(1) : lines).map((text) => {
    const rename = text.match(/^(.+) renamed to (.+) \(renamed, \+(\d+)\/-(\d+)\)$/)
    if (rename)
      return {
        paths: [rename[1], rename[2]],
        status: "renamed",
        additions: +rename[3],
        deletions: +rename[4],
        line: text,
      }
    const withStatus = text.match(/^(.+) \((added|deleted|modified), \+(\d+)\/-(\d+)\)$/)
    if (withStatus)
      return {
        paths: [withStatus[1]],
        status: withStatus[2] as Entry["status"],
        additions: +withStatus[3],
        deletions: +withStatus[4],
        line: text,
      }
    const noStatus = text.match(/^(.+) \(\+(\d+)\/-(\d+)\)$/)
    if (noStatus)
      return { paths: [noStatus[1]], status: undefined, additions: +noStatus[2], deletions: +noStatus[3], line: text }
    return { paths: [], status: "unparsed", additions: 0, deletions: 0, line: text }
  })
  return { summary, entries }
}

const listedPaths = (lines: string[]) => parse(lines).entries.flatMap((entry) => entry.paths)

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

// The group order from R6 (revised): added, modified, deleted, renamed, then entries with no status.
const GROUP = ["added", "modified", "deleted", "renamed", undefined] as const

// ---------------------------------------------------------------------------------------------
// Real repositories
// ---------------------------------------------------------------------------------------------

const snapshotLayer = Layer.provideMerge(
  Layer.mergeAll(LayerNode.compile(LayerNode.group([Snapshot.node])), testInstanceStoreLayer),
  TestConsole.layer,
)

type Files = Map<string, string | Uint8Array>

async function writeFile(dir: string, file: string, text: string | Uint8Array) {
  await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true })
  await fs.writeFile(path.join(dir, file), text)
}

async function removeFile(dir: string, file: string) {
  await fs.rm(path.join(dir, file), { force: true })
  // Remove folders the deletion left empty, as an editor or `git rm` would.
  let folder = path.dirname(file)
  while (folder !== ".") {
    const removed = await fs.rmdir(path.join(dir, folder)).then(
      () => true,
      () => false,
    )
    if (!removed) break
    folder = path.dirname(folder)
  }
}

async function run(dir: string, cmd: string[]) {
  const proc = Bun.spawn(cmd, { cwd: dir, stdout: "ignore", stderr: "pipe" })
  if ((await proc.exited) !== 0) throw new Error(`${cmd.join(" ")} failed: ${await new Response(proc.stderr).text()}`)
}

/**
 * Runs one task in a fresh git repository, the way opencode does: `setup` prepares the project
 * (including anything the user changed before the task), a snapshot is taken when the task starts,
 * each step of the task runs and is followed by a snapshot (step-finish), and the recap diff is
 * Snapshot.diffFull from the first snapshot to the last one. Returns the diff and the formatted recap.
 */
async function runTask(input: {
  setup?: (dir: string) => Promise<void>
  steps: Array<(dir: string) => Promise<void>>
}) {
  try {
    return await Effect.gen(function* () {
      const { directory } = yield* TestInstance
      const snapshot = yield* Snapshot.Service
      if (input.setup) yield* Effect.promise(() => input.setup!(directory))
      const start = yield* snapshot.track()
      let end = start
      for (const step of input.steps) {
        yield* Effect.promise(() => step(directory))
        end = yield* snapshot.track()
      }
      if (!start || !end) throw new Error("snapshot was not taken")
      const diffs = yield* snapshot.diffFull(start, end)
      return { diffs, collected: collect(diffs), lines: format(collect(diffs)) }
    }).pipe(withTmpdirInstance({ git: true }), Effect.scoped, Effect.provide(snapshotLayer), Effect.runPromise)
  } finally {
    await disposeAllInstances()
  }
}

// Initial project contents: a few files from the pool, each with generated text.
const project = fc
  .uniqueArray(fc.tuple(filePath, content), { minLength: 1, maxLength: 6, selector: ([file]) => file })
  .map((entries) => new Map<string, string>(entries))

const writeAll = (files: Files) => async (dir: string) => {
  for (const [file, text] of files) await writeFile(dir, file, text)
}

// Line counts between two texts from a plain longest-common-subsequence table, used as an oracle that
// does not share code with the recap. Lines keep their newline, as git compares them.
function lineCounts(before: string, after: string) {
  const split = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const a = split(before)
  const b = split(after)
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
  const same = table[0][0]
  return { additions: b.length - same, deletions: a.length - same }
}

const REPO_RUNS = Number(process.env.RECAP_PROPERTY_REPO_RUNS ?? 20)
const REPO_TIMEOUT = Math.max(120_000, REPO_RUNS * 6_000)

afterEach(async () => {
  await disposeAllInstances()
})

// ---------------------------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------------------------

describe("Learning Recap changed files: requirement properties", () => {
  // R1: Already implemented. Each changed file appears exactly once in the list, with one status and
  // the line counts from its final diff.
  // Kind: invariant
  //
  // Generator: lists of diff entries with repeated paths (the same file reported in several steps),
  // missing paths, missing statuses, binary files and rename pairs, in any order. The expected counts
  // for a path are the ones in the last diff given for it.
  test("R1: every changed path is listed exactly once, with one status and its final counts", () => {
    fc.assert(
      fc.property(diffList, (diffs) => {
        const lines = format(collect(diffs))
        const last = new Map(diffs.flatMap((diff) => (diff.file ? [[diff.file, diff] as const] : [])))
        if (last.size === 0) {
          expect(lines).toEqual(NO_CHANGES)
          return
        }
        const { entries } = parse(lines)
        expect(entries.flatMap((entry) => entry.paths).toSorted(byPath)).toEqual([...last.keys()].toSorted(byPath))
        for (const entry of entries) {
          expect(entry.status).not.toBe("unparsed")
          const statuses = ["added", "deleted", "modified", "renamed"].filter((status) =>
            entry.line.includes(`(${status}`),
          )
          expect(statuses.length).toBe(entry.status === undefined ? 0 : 1)
          if (entry.status === "renamed") continue
          const diff = last.get(entry.paths[0])!
          expect([entry.status, entry.additions, entry.deletions]).toEqual([
            diff.status,
            diff.additions,
            diff.deletions,
          ])
        }
      }),
      { numRuns: 500 },
    )
  })

  // R1 (repository): Already implemented. Each changed file appears exactly once in the list, with one
  // status and the line counts from its final diff.
  // Kind: invariant
  //
  // Generator: a task of several steps that each rewrite files again, often the same file (a file
  // edited five times). A snapshot is taken after every step, as opencode does at step-finish. The
  // expected counts come from an independent line-count oracle on the first and last content.
  test(
    "R1: a file edited in several steps is listed once, with the counts of its final state",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          project,
          fc.array(fc.tuple(filePath, content), { minLength: 2, maxLength: 8 }),
          async (before, edits) => {
            const { lines } = await runTask({
              setup: writeAll(before),
              steps: edits.map(
                ([file, text]) =>
                  (dir: string) =>
                    writeFile(dir, file, text + "step\n"),
              ),
            })
            const after = new Map(before)
            for (const [file, text] of edits) after.set(file, text + "step\n")
            const entries = parse(lines).entries
            const listed = entries.flatMap((entry) => entry.paths)
            expect(new Set(listed).size).toBe(listed.length)
            for (const file of new Set(edits.map(([file]) => file))) {
              const entry = entries.find((item) => item.paths.includes(file))
              if (before.get(file) === after.get(file)) {
                expect(entry).toBeUndefined()
                continue
              }
              expect(entry).toBeDefined()
              if (entry!.status === "renamed") continue
              const counts = lineCounts(before.get(file) ?? "", after.get(file)!)
              expect([entry!.additions, entry!.deletions]).toEqual([counts.additions, counts.deletions])
            }
          },
        ),
        { numRuns: REPO_RUNS },
      )
    },
    REPO_TIMEOUT,
  )

  // R2: Already implemented. The list includes every file whose contents differ between the start and
  // the end of the task, no matter how it was changed (edit tool, shell command, formatter), and never
  // includes a file the task only read.
  // Kind: model/oracle
  //
  // Generator: an initial project; a task that reads every file, then changes some files by writing
  // them directly (like the edit tool), some through a shell command, and some through a "formatter"
  // command that rewrites several files at once in place. The oracle is the plain definition: compare
  // the file contents at the start and at the end.
  test(
    "R2: every file whose content changed is listed, however it was changed, and read-only files are not",
    async () => {
      const how = fc.constantFrom("none", "edit", "shell", "formatter")
      await fc.assert(
        fc.asyncProperty(
          project,
          fc.array(how, { minLength: PATHS.length, maxLength: PATHS.length }),
          async (before, ways) => {
            const formatted = PATHS.filter((file, index) => before.has(file) && ways[index] === "formatter")
            const { lines } = await runTask({
              setup: writeAll(before),
              steps: [
                async (dir) => {
                  for (const file of before.keys()) await fs.readFile(path.join(dir, file))
                },
                async (dir) => {
                  for (const [index, file] of PATHS.entries()) {
                    if (ways[index] === "edit") await writeFile(dir, file, "edited by the edit tool\n")
                    if (ways[index] === "shell") {
                      await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true })
                      await run(dir, ["sh", "-c", 'printf "written by a shell command\\n" >> "$1"', "sh", file])
                    }
                  }
                  // A formatter run through the shell: rewrites every file it is given, in place.
                  if (formatted.length > 0)
                    await run(dir, [
                      "sh",
                      "-c",
                      'for f in "$@"; do printf "// formatted\\n" > "$f"; done',
                      "sh",
                      ...formatted,
                    ])
                },
              ],
            })
            const after = new Map<string, string>(before)
            for (const [index, file] of PATHS.entries()) {
              if (ways[index] === "edit") after.set(file, "edited by the edit tool\n")
              if (ways[index] === "shell") after.set(file, (before.get(file) ?? "") + "written by a shell command\n")
            }
            for (const file of formatted) after.set(file, "// formatted\n")
            const changed = PATHS.filter((file) => before.get(file) !== after.get(file))
            expect(listedPaths(lines).toSorted(byPath)).toEqual(changed.toSorted(byPath))
          },
        ),
        { numRuns: REPO_RUNS },
      )
    },
    REPO_TIMEOUT,
  )

  // R3: Already implemented. A file that is created and then deleted in the same task, or edited and
  // then changed back, does not appear in the list. If there are no other changes, the section shows
  // "No files were changed during this task."
  // Kind: round-trip
  //
  // Generator: an initial project; a task that edits existing files and later restores their exact
  // original bytes, and creates temporary files (some in new folders) and later deletes them. Each of
  // those happens in separate steps with a snapshot in between, so the intermediate states really are
  // recorded. Optionally the task also makes real changes to other files, which must still be listed.
  test(
    "R3: undone edits and temporary files leave the recap unchanged",
    async () => {
      const temp = fc.constantFrom("tmp/scratch.txt", "tmp.txt", "build/out/cache.json", ".tmp-edit.swp")
      await fc.assert(
        fc.asyncProperty(
          project,
          fc.uniqueArray(temp, { maxLength: 3 }),
          fc.array(fc.tuple(filePath, content), { maxLength: 3 }),
          fc.boolean(),
          async (before, temps, changes, realChanges) => {
            const edited = [...before.keys()]
            const real = new Map(realChanges ? changes.filter(([file]) => !before.has(file)) : [])
            const { lines } = await runTask({
              setup: writeAll(before),
              steps: [
                async (dir) => {
                  for (const file of edited) await writeFile(dir, file, before.get(file)! + "temporary edit\n")
                  for (const file of temps) await writeFile(dir, file, "temporary\n")
                },
                async (dir) => {
                  for (const [file, text] of real) await writeFile(dir, file, text)
                },
                async (dir) => {
                  for (const file of edited) await writeFile(dir, file, before.get(file)!)
                  for (const file of temps) await removeFile(dir, file)
                },
              ],
            })
            if (real.size === 0) {
              expect(lines).toEqual(NO_CHANGES)
              return
            }
            expect(listedPaths(lines).toSorted(byPath)).toEqual([...real.keys()].toSorted(byPath))
          },
        ),
        { numRuns: REPO_RUNS },
      )
    },
    REPO_TIMEOUT,
  )

  // R4: Already implemented. The list compares a snapshot taken when the task starts with a snapshot
  // taken when it ends, not with the last commit, so changes the user made before the task are not
  // listed.
  // Kind: invariant
  //
  // Generator: a committed project; then uncommitted user work before the task starts (edits, new
  // untracked files and deletions); then a task that changes a subset of paths, possibly including
  // files the user had already edited. Whatever the mix, the recap must list exactly the paths whose
  // content the task changed, never a path only the user changed.
  test(
    "R4: changes the user made before the task are never listed",
    async () => {
      const userOp = fc.constantFrom("none", "edit", "delete")
      await fc.assert(
        fc.asyncProperty(
          project,
          fc.array(userOp, { minLength: PATHS.length, maxLength: PATHS.length }),
          fc.uniqueArray(fc.tuple(filePath, content), { maxLength: 4, selector: ([file]) => file }),
          fc.uniqueArray(fc.tuple(filePath, content), { maxLength: 3, selector: ([file]) => file }),
          async (committed, userOps, userNew, taskEdits) => {
            const atStart = new Map(committed)
            PATHS.forEach((file, index) => {
              if (!committed.has(file)) return
              if (userOps[index] === "edit") atStart.set(file, committed.get(file)! + "user work\n")
              if (userOps[index] === "delete") atStart.delete(file)
            })
            for (const [file, text] of userNew) if (!committed.has(file)) atStart.set(file, text + "user new file\n")
            const atEnd = new Map(atStart)
            for (const [file, text] of taskEdits) atEnd.set(file, text + "task edit\n")

            const { lines } = await runTask({
              setup: async (dir) => {
                await writeAll(committed)(dir)
                await run(dir, ["git", "add", "-A"])
                await run(dir, ["git", "commit", "-q", "-m", "committed project"])
                for (const file of PATHS) {
                  if (committed.has(file) && !atStart.has(file)) await removeFile(dir, file)
                  const text = atStart.get(file)
                  if (text !== undefined && text !== committed.get(file)) await writeFile(dir, file, text)
                }
              },
              steps: [
                async (dir) => {
                  for (const [file, text] of atEnd) if (text !== atStart.get(file)) await writeFile(dir, file, text)
                },
              ],
            })
            const changedByTask = PATHS.filter((file) => atStart.get(file) !== atEnd.get(file))
            const userOnly = PATHS.filter(
              (file) => committed.get(file) !== atStart.get(file) && !changedByTask.includes(file),
            )
            const listed = listedPaths(lines)
            expect(listed.toSorted(byPath)).toEqual(changedByTask.toSorted(byPath))
            for (const file of userOnly) expect(listed).not.toContain(file)
          },
        ),
        { numRuns: REPO_RUNS },
      )
    },
    REPO_TIMEOUT,
  )

  // R5: Partly implemented. A file that existed before the task is never shown as "added", and a status
  // never contradicts the line counts: an "added" entry has 0 deletions and a "deleted" entry has 0
  // additions.
  // Kind: model/oracle
  //
  // Generator: an initial project, then one edit per pool path. Existing files get the edits that broke
  // the first version of this feature (append-only and remove-only changes, which look like "added" and
  // "deleted" by line counts), full overwrites, deletions and no-op rewrites. Missing paths may be
  // created. The oracle is the obvious definition: compare the file maps before and after the task.
  test(
    "R5: statuses match a before/after comparison and never contradict the line counts",
    async () => {
      const edit = fc.constantFrom("keep", "append", "prepend", "trim", "overwrite", "same", "delete", "create")
      await fc.assert(
        fc.asyncProperty(
          project,
          fc.array(edit, { minLength: PATHS.length, maxLength: PATHS.length }),
          fc.array(line, { minLength: 1, maxLength: 3 }),
          async (before, edits, extra) => {
            const after = new Map(before)
            PATHS.forEach((file, index) => {
              const old = before.get(file)
              const text = extra.join("\n") + "\n"
              const op = edits[index]
              if (old === undefined) {
                if (op === "create") after.set(file, text)
                return
              }
              if (op === "append") after.set(file, old + (old === "" || old.endsWith("\n") ? "" : "\n") + text)
              if (op === "prepend") after.set(file, text + old)
              if (op === "trim") after.set(file, old.split("\n").slice(1).join("\n"))
              if (op === "overwrite") after.set(file, text + "overwritten\n")
              if (op === "delete") after.delete(file)
            })
            const { collected, lines } = await runTask({
              setup: writeAll(before),
              steps: [
                async (dir) => {
                  for (const [index, file] of PATHS.entries()) {
                    const text = after.get(file)
                    if (text === undefined && before.has(file)) await removeFile(dir, file)
                    if (text !== undefined && (text !== before.get(file) || edits[index] === "same"))
                      await writeFile(dir, file, text)
                  }
                },
              ],
            })
            const expected = PATHS.flatMap((file) => {
              const old = before.get(file)
              const now = after.get(file)
              if (old === now) return []
              const status: FileDiff.Info["status"] =
                old === undefined ? "added" : now === undefined ? "deleted" : "modified"
              return [{ file, status }]
            })
            const actual = collected.map((entry) => ({ file: entry.file, status: entry.status }))
            expect(actual.toSorted((a, b) => byPath(a.file!, b.file!))).toEqual(
              expected.toSorted((a, b) => byPath(a.file, b.file)),
            )
            for (const entry of collected) {
              if (before.has(entry.file!)) expect(entry.status).not.toBe("added")
              if (entry.status === "added") expect(entry.deletions).toBe(0)
              if (entry.status === "deleted") expect(entry.additions).toBe(0)
            }
            for (const entry of parse(lines).entries) {
              if (entry.status === "added") expect(entry.deletions).toBe(0)
              if (entry.status === "deleted") expect(entry.additions).toBe(0)
            }
          },
        ),
        { numRuns: REPO_RUNS },
      )
    },
    REPO_TIMEOUT,
  )

  // R6 (revised in P4B): The list is grouped by status in the order added, modified, deleted, renamed,
  // and sorted alphabetically by path inside each group, comparing paths character by character (a
  // renamed file by its new path). Entries with no status come last. The order in which the task made
  // its changes never changes the output.
  // Kind: metamorphic
  //
  // Generator: lists of diff entries with distinct paths (so the final changes are fixed), including
  // rename pairs, binary files and entries with no status, shown to the recap in two different orders.
  // Reordering the input must not change the output, and the output must follow the group order with
  // paths sorted inside each group.
  test("R6: reordering the changes does not change the recap, which is grouped by status and sorted", () => {
    const distinct = diffList.map((diffs) => [...new Map(diffs.map((diff) => [diff.file ?? "", diff])).values()])
    fc.assert(
      fc.property(
        distinct.chain((diffs) =>
          fc.tuple(fc.constant(diffs), fc.shuffledSubarray(diffs, { minLength: diffs.length })),
        ),
        ([diffs, reordered]) => {
          expect(format(collect(reordered))).toEqual(format(collect(diffs)))
          const entries = parse(format(collect(diffs))).entries
          const keys = entries.map((entry) => [GROUP.indexOf(entry.status as never), entry.paths.at(-1) ?? ""] as const)
          const sorted = keys.toSorted((a, b) => a[0] - b[0] || byPath(a[1], b[1]))
          expect(keys).toEqual(sorted)
        },
      ),
      { numRuns: 500 },
    )
  })

  // R6 (revised in P4B, repository): The list is grouped by status in the order added, modified,
  // deleted, renamed, and sorted alphabetically by path inside each group, comparing paths character by
  // character (a renamed file by its new path). Entries with no status come last. The order in which
  // the task made its changes never changes the output.
  // Kind: metamorphic
  //
  // Generator: an initial project and one change per path (create, rewrite or delete). The same changes
  // are made in two repositories, one step per change, in two different orders. The two recaps must be
  // identical.
  test(
    "R6: the same changes made in a different order give an identical recap",
    async () => {
      const change = fc.tuple(filePath, fc.option(content, { nil: undefined }))
      const changes = fc.uniqueArray(change, { minLength: 1, maxLength: 5, selector: ([file]) => file })
      await fc.assert(
        fc.asyncProperty(
          project,
          changes.chain((list) => fc.tuple(fc.constant(list), fc.shuffledSubarray(list, { minLength: list.length }))),
          async (before, [first, second]) => {
            const steps = (list: typeof first) =>
              list.map(
                ([file, text]) =>
                  (dir: string) =>
                    text === undefined ? removeFile(dir, file) : writeFile(dir, file, text + "changed\n"),
              )
            const a = await runTask({ setup: writeAll(before), steps: steps(first) })
            const b = await runTask({ setup: writeAll(before), steps: steps(second) })
            expect(b.lines).toEqual(a.lines)
          },
        ),
        { numRuns: Math.ceil(REPO_RUNS / 2) },
      )
    },
    REPO_TIMEOUT,
  )

  // R7 (revised in P4B): The section starts with a summary line "N files changed: A added, M modified,
  // D deleted" ("1 file changed" when there is one file), followed by ", R renamed" when the task
  // renamed files and ", U with unknown status" when some entries have no status, and the numbers match
  // the entries listed under it.
  // Kind: invariant
  //
  // Generator: the same mixed diff lists as R1, including renames, binary files and entries without a
  // status, so every count in the summary line gets exercised. The counts are checked against the
  // entries that are actually listed under the summary.
  test("R7: the summary line's total and per-status counts match the listed entries", () => {
    fc.assert(
      fc.property(diffList, (diffs) => {
        const lines = format(collect(diffs))
        if (collect(diffs).length === 0) {
          expect(lines).toEqual(NO_CHANGES)
          return
        }
        const { summary, entries } = parse(lines)
        expect(summary).toBeDefined()
        const count = (status: Entry["status"]) => entries.filter((entry) => entry.status === status).length
        const total = entries.length
        const parts = [`${count("added")} added`, `${count("modified")} modified`, `${count("deleted")} deleted`]
        if (count("renamed") > 0) parts.push(`${count("renamed")} renamed`)
        if (count(undefined) > 0) parts.push(`${count(undefined)} with unknown status`)
        expect(summary).toBe(`${total} ${total === 1 ? "file" : "files"} changed: ${parts.join(", ")}`)
      }),
      { numRuns: 500 },
    )
  })

  // R8 (revised in P4B): A deleted text file and an added text file are shown as one entry, "old
  // renamed to new (renamed, +A/-D)", when at least half of the lines of the larger of the two files are
  // unchanged between them (git's default 50% rename threshold, counted in lines). The line counts are
  // always shown, and are +0/-0 for a file that was only moved. A move whose content can't be compared
  // (a binary file) is still shown as one deleted file and one added file, with both paths correct.
  // Kind: invariant
  //
  // Generator: an existing file of 2 to 10 lines is moved to a free path, in a new or existing folder,
  // and then edited: some of its lines removed and some new lines added, but never so many that less
  // than half of the larger file is unchanged. In some runs the new file is instead completely
  // different (not a rename). Other files may change in the same task. Every line carries a unique
  // marker, so no other file in the task can look like the moved one. The expected counts come from an
  // independent line-count oracle.
  test(
    "R8: a moved file, edited or not, is one renamed entry with correct counts",
    async () => {
      const scenario = project.chain((before) =>
        fc.record({
          before: fc.constant(before),
          from: fc.constantFrom(...before.keys()),
          to: fc.constantFrom(...PATHS.filter((file) => !before.has(file)), "moved/renamed.ts"),
          size: fc.integer({ min: 2, max: 10 }),
          related: fc.boolean(),
          others: fc.array(fc.tuple(filePath, content), { maxLength: 3 }),
          seed: fc.uuid(),
        }),
      )
      const edits = scenario.chain((input) =>
        fc.record({
          input: fc.constant(input),
          removed: fc.subarray([...Array(input.size).keys()], { maxLength: Math.floor(input.size / 2) }),
          added: fc.nat({ max: input.size }),
        }),
      )
      await fc.assert(
        fc.asyncProperty(edits, async ({ input, removed, added }) => {
          const { before, from, to, size, related, others, seed } = input
          const old = Array.from({ length: size }, (_, i) => `${seed} line ${i}\n`)
          const kept = old.filter((_, i) => !removed.includes(i))
          const extra = Array.from({ length: Math.min(added, kept.length) }, (_, i) => `${seed} new ${i}\n`)
          const oldText = old.join("")
          const newText = related
            ? kept.flatMap((text, i) => (i < extra.length ? [extra[i], text] : [text])).join("")
            : Array.from({ length: size }, (_, i) => `${seed} unrelated ${i}\n`).join("")
          const { lines } = await runTask({
            setup: writeAll(new Map([...before, [from, oldText]])),
            steps: [
              async (dir) => {
                await fs.mkdir(path.dirname(path.join(dir, to)), { recursive: true })
                await fs.rename(path.join(dir, from), path.join(dir, to))
                await removeFile(dir, from)
              },
              async (dir) => {
                await writeFile(dir, to, newText)
                for (const [file, text] of others)
                  if (file !== from && file !== to) await writeFile(dir, file, text + "other\n")
              },
            ],
          })
          const entries = parse(lines).entries
          const mine = entries.filter((entry) => entry.paths.includes(from) || entry.paths.includes(to))
          if (!related) {
            expect(mine.map((entry) => [entry.paths, entry.status])).toEqual([
              [[to], "added"],
              [[from], "deleted"],
            ] as never)
            return
          }
          const counts = lineCounts(oldText, newText)
          expect(mine).toHaveLength(1)
          expect(mine[0].line).toBe(`${from} renamed to ${to} (renamed, +${counts.additions}/-${counts.deletions})`)
        }),
        { numRuns: REPO_RUNS },
      )
    },
    REPO_TIMEOUT,
  )

  // R8 (revised in P4B): A deleted text file and an added text file are shown as one entry, "old
  // renamed to new (renamed, +A/-D)", when at least half of the lines of the larger of the two files are
  // unchanged between them (git's default 50% rename threshold, counted in lines). The line counts are
  // always shown, and are +0/-0 for a file that was only moved. A move whose content can't be compared
  // (a binary file) is still shown as one deleted file and one added file, with both paths correct.
  // This property checks the binary case.
  // Kind: invariant
  //
  // Generator: random bytes that always include a NUL byte, so git treats the file as binary.
  test(
    "R8: a moved binary file is listed with both paths, as deleted and added",
    async () => {
      const bytes = fc.uint8Array({ minLength: 1, maxLength: 64 }).map((data) => new Uint8Array([0, ...data]))
      await fc.assert(
        fc.asyncProperty(bytes, fc.constantFrom("img/logo.bin", "assets/data.bin"), async (data, to) => {
          const { lines } = await runTask({
            setup: (dir) => writeFile(dir, "blob.bin", data),
            steps: [
              async (dir) => {
                await fs.mkdir(path.dirname(path.join(dir, to)), { recursive: true })
                await fs.rename(path.join(dir, "blob.bin"), path.join(dir, to))
              },
            ],
          })
          expect(parse(lines).entries.map((entry) => [entry.paths, entry.status])).toEqual([
            [[to], "added"],
            [["blob.bin"], "deleted"],
          ] as never)
        }),
        { numRuns: Math.ceil(REPO_RUNS / 2) },
      )
    },
    REPO_TIMEOUT,
  )
})
