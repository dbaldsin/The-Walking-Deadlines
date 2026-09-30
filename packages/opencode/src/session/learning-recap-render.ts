import type { FileDiff } from "@opencode-ai/schema/file-diff"
import { ShellID } from "@/tool/shell/id"
import type { LearningRecap } from "./learning-recap"
import { LearningRecapFiles } from "./learning-recap-files"
import { LearningRecapTests } from "./learning-recap-tests"

type Part = {
  type: string
  tool?: string
  state?: { status: string; title?: string; metadata?: Record<string, unknown>; output?: string }
}

/**
 * Builds the recap for one completed task from its message parts and the task's
 * file diffs. A section stays absent, never an empty placeholder, when its data
 * source has nothing to add yet (key decisions lands in a later issue) -- see #7
 * for why the schema keeps every field optional.
 */
export function fromParts(parts: ReadonlyArray<Part>, changedFiles: ReadonlyArray<FileDiff.Info>): LearningRecap.Info {
  const shellCalls = parts.flatMap((part) => {
    if (part.type !== "tool" || part.tool !== ShellID.ToolID || part.state?.status !== "completed") return []
    const exit = part.state.metadata?.exit
    return [{ command: part.state.title ?? "", exit: typeof exit === "number" ? exit : null, output: part.state.output }]
  })
  return {
    tests: LearningRecapTests.collect(shellCalls),
    changedFiles: LearningRecapFiles.collect(changedFiles),
  }
}

const HEADING = "## Learning Recap"

/** Turns a recap into the markdown appended to the final response, or undefined when there is nothing to report. */
export function render(info: LearningRecap.Info) {
  const sections: string[] = []
  if (info.changedFiles) {
    sections.push(["### Files changed", ...LearningRecapFiles.format(info.changedFiles).map((line) => `- ${line}`)].join("\n"))
  }
  if (info.tests) {
    sections.push(["### Tests", ...LearningRecapTests.format(info.tests).map((line) => `- ${line}`)].join("\n"))
  }
  if (!sections.length) return undefined
  return [HEADING, ...sections].join("\n\n")
}

export * as LearningRecapRender from "./learning-recap-render"
