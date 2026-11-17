import { parsePatch, structuredPatch } from "diff"
import type { FileDiff } from "@opencode-ai/schema/file-diff"

/**
 * Collects the files changed during a task into recap-ready entries.
 * Keeps the last diff seen per file, so a file touched across multiple steps
 * ends up with its final counts, and drops entries with no path.
 * The status comes from the task diff (git name-status). Line counts cannot tell
 * a new file from an existing one that only gained lines, so a missing status
 * stays missing instead of being guessed.
 * Entries are sorted by path, so the result does not depend on the order the
 * changes were reported in.
 */
export function collect(diffs: ReadonlyArray<FileDiff.Info>) {
  const byFile = new Map(
    diffs
      .filter((diff): diff is FileDiff.Info & { file: string } => Boolean(diff.file))
      .map((diff) => [diff.file, diff] as const),
  )
  return [...byFile.values()].sort((a, b) => byPath(a.file, b.file))
}

/**
 * Recap-ready lines for the changed-files section: a summary line, then one line per file,
 * grouped by status (added, modified, deleted, renamed, then unknown) and sorted by path
 * inside each group, or a clear message when nothing changed.
 */
export function format(files: ReadonlyArray<FileDiff.Info> | undefined) {
  if (!files || files.length === 0) return ["No files were changed during this task."]
  const list = rows(files).sort((a, b) => GROUPS.indexOf(a.status) - GROUPS.indexOf(b.status) || byPath(a.path, b.path))
  return [summary(list), ...list.map((row) => row.text)]
}

const GROUPS = ["added", "modified", "deleted", "renamed", undefined]

type Row = { path: string; status: FileDiff.Info["status"] | "renamed"; text: string }

/** Orders paths character by character, the same way every time. */
function byPath(a: string | undefined, b: string | undefined) {
  const left = a ?? ""
  const right = b ?? ""
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * One row per file. The task diff runs git without rename detection, so a moved file arrives
 * as a deletion and an addition. Exact moves are matched first, directly by content, taking
 * ties in path order; this is cheap even when a whole folder is moved. Only the files left
 * after that are compared line by line, and are paired as renames when at least half of the
 * lines of the larger file are unchanged (git's default 50% rename threshold, counted in lines),
 * most similar pairs first. Files whose content can't be read from the diff (binary files,
 * older diffs, unreadable patches) are never paired.
 */
function rows(files: ReadonlyArray<FileDiff.Info>) {
  const readable = (status: "added" | "deleted") =>
    files
      .filter((file) => file.status === status)
      .sort((a, b) => byPath(a.file, b.file))
      .flatMap((file) => {
        const text = content(file)
        return text === undefined ? [] : [{ file, text }]
      })
  const added = readable("added")
  const deleted = readable("deleted")
  const paired = new Set<FileDiff.Info>()
  const byText = Map.groupBy(added, (to) => to.text)
  const exact = deleted.flatMap((from) => {
    const to = byText.get(from.text)?.find((candidate) => !paired.has(candidate.file))
    if (!to) return []
    paired.add(from.file)
    paired.add(to.file)
    return [{ from: from.file, to: to.file, additions: 0, deletions: 0 }]
  })
  const similar = deleted
    .filter((from) => !paired.has(from.file))
    .flatMap((from, i) =>
      added
        .filter((to) => !paired.has(to.file))
        .map((to, j) => ({ from: from.file, to: to.file, order: [i, j], ...compare(from.text, to.text) })),
    )
    .filter((pair) => pair.similarity >= 0.5)
    .sort((a, b) => b.similarity - a.similarity || a.order[0] - b.order[0] || a.order[1] - b.order[1])
    .filter((pair) => {
      if (paired.has(pair.from) || paired.has(pair.to)) return false
      paired.add(pair.from)
      paired.add(pair.to)
      return true
    })
  const renames = [...exact, ...similar].map(
    (pair): Row => ({
      path: pair.to.file ?? "",
      status: "renamed",
      text: `${pair.from.file} renamed to ${pair.to.file} (renamed, +${pair.additions}/-${pair.deletions})`,
    }),
  )
  const others = files
    .filter((file) => !paired.has(file))
    .map((file): Row => {
      const counts = `+${file.additions}/-${file.deletions}`
      return {
        path: file.file ?? "",
        status: file.status,
        text: file.status ? `${file.file} (${file.status}, ${counts})` : `${file.file} (${counts})`,
      }
    })
  return [...others, ...renames]
}

/**
 * The text an added file was created with, or a deleted file had, rebuilt from its patch.
 * Undefined when the patch can't show it: binary files and older diffs have no patch, and a
 * path with a newline in it makes the patch header unreadable. An unreadable patch only means
 * the file can't be matched as a rename; it is still listed as added or deleted.
 */
function content(diff: FileDiff.Info) {
  if (!diff.patch) return undefined
  const parsed = readPatch(diff.patch)
  if (parsed?.length !== 1) return undefined
  const sign = diff.status === "added" ? "+" : "-"
  const lines = parsed[0].hunks.flatMap((hunk) => hunk.lines)
  if (lines.some((line) => !line.startsWith(sign) && !line.startsWith("\\"))) return undefined
  const body = lines.filter((line) => !line.startsWith("\\")).map((line) => line.slice(1))
  if (body.length === 0) return ""
  return body.join("\n") + (lines.at(-1)?.startsWith("\\") ? "" : "\n")
}

/** parsePatch throws on patches it can't read; for the recap that just means "no content". */
function readPatch(patch: string) {
  try {
    return parsePatch(patch)
  } catch {
    return undefined
  }
}

/** Line counts between two texts, and the share of the larger text's lines left unchanged. */
function compare(before: string, after: string) {
  const changes = structuredPatch("", "", before, after, "", "", { context: 0 }).hunks.flatMap((hunk) => hunk.lines)
  const additions = changes.filter((line) => line.startsWith("+")).length
  const deletions = changes.filter((line) => line.startsWith("-")).length
  const size = (text: string) => (text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0))
  const larger = Math.max(size(before), size(after))
  return { additions, deletions, similarity: larger === 0 ? 1 : (size(before) - deletions) / larger }
}

/** The first line of the list: the total and the count for each status, matching the entries below it. */
function summary(list: ReadonlyArray<Row>) {
  const count = (status: Row["status"]) => list.filter((row) => row.status === status).length
  const parts = [`${count("added")} added`, `${count("modified")} modified`, `${count("deleted")} deleted`]
  if (count("renamed") > 0) parts.push(`${count("renamed")} renamed`)
  if (count(undefined) > 0) parts.push(`${count(undefined)} with unknown status`)
  return `${list.length} ${list.length === 1 ? "file" : "files"} changed: ${parts.join(", ")}`
}

export * as LearningRecapFiles from "./learning-recap-files"
