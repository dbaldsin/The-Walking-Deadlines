import type { FileDiff } from "@opencode-ai/schema/file-diff"

/** Falls back to inferring a status from the change counts when the source diff left it unset. */
export function statusOf(diff: FileDiff.Info) {
  if (diff.status) return diff.status
  if (diff.deletions === 0 && diff.additions > 0) return "added"
  if (diff.additions === 0 && diff.deletions > 0) return "deleted"
  return "modified"
}

/**
 * Collects the files changed during a task into recap-ready entries.
 * Keeps the last diff seen per file, so a file touched across multiple steps
 * ends up with its final counts, and drops entries with no path.
 */
export function collect(diffs: ReadonlyArray<FileDiff.Info>) {
  const byFile = new Map(
    diffs
      .filter((diff): diff is FileDiff.Info & { file: string } => Boolean(diff.file))
      .map((diff) => [diff.file, { ...diff, status: statusOf(diff) }] as const),
  )
  return [...byFile.values()]
}

/** Recap-ready lines for the changed-files section, with a clear message when nothing changed. */
export function format(files: ReadonlyArray<FileDiff.Info> | undefined) {
  if (!files || files.length === 0) return ["No files were changed during this task."]
  return files.map((file) => `${file.file} (${file.status}, +${file.additions}/-${file.deletions})`)
}

export * as LearningRecapFiles from "./learning-recap-files"
