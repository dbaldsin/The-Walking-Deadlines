import type { TuiState } from "@opencode-ai/plugin/tui"
import { isLearningSession } from "../../util/session"

export function codingActivity(state: TuiState, sourceID: string) {
  const ids = new Set([sourceID])
  const queue = [sourceID]
  for (const id of queue) {
    for (const child of state.session.children?.(id) ?? []) {
      if (ids.size >= 64 || ids.has(child.id) || isLearningSession(child)) continue
      ids.add(child.id)
      queue.push(child.id)
    }
  }
  if (queue.some((id) => state.session.permission(id).length))
    return { label: "Waiting for permission", attention: true }
  if (queue.some((id) => state.session.question(id).length))
    return { label: "Waiting for your answer", attention: true }
  if (queue.some((id) => state.session.status(id)?.type === "retry")) return { label: "Retrying", attention: true }
  if (queue.some((id) => state.session.status(id)?.type === "busy")) return { label: "Working", attention: false }
  return {
    label: state.session.get(sourceID) ? "Idle" : "Status unavailable",
    attention: false,
  }
}
