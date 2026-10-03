export function isDefaultTitle(title: string) {
  return /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(title)
}

export function isLearningSession(session: { parentID?: string; metadata?: Record<string, unknown> } | undefined) {
  return (
    !!session?.parentID &&
    session.metadata?.["learning.source"] === session.parentID &&
    ["chat", "topics"].includes(String(session.metadata?.["learning.role"]))
  )
}
