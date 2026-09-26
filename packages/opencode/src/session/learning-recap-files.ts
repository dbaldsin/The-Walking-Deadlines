import type { FileDiff } from "@opencode-ai/schema/file-diff"

/**
 * Collects the files changed during a task into recap-ready entries.
 * Keeps the last diff seen per file, so a file touched across multiple steps
 * ends up with its final counts, and drops entries with no path.
 * The status comes from the task diff (git name-status). Line counts cannot tell
 * a new file from an existing one that only gained lines, so a missing status
 * stays missing instead of being guessed.
 */
export function collect(diffs: ReadonlyArray<FileDiff.Info>) {
  const byFile = new Map(
    diffs
      .filter((diff): diff is FileDiff.Info & { file: string } => Boolean(diff.file))
      .map((diff) => [diff.file, diff] as const),
  )
  return [...byFile.values()]
}

/** Recap-ready lines for the changed-files section, with a clear message when nothing changed. */
export function format(files: ReadonlyArray<FileDiff.Info> | undefined) {
  if (!files || files.length === 0) return ["No files were changed during this task."]
  return files.map((file) => {
    const counts = `+${file.additions}/-${file.deletions}`
    return file.status ? `${file.file} (${file.status}, ${counts})` : `${file.file} (${counts})`
  })
}

export * as LearningRecapFiles from "./learning-recap-files"
