import { expect, test } from "bun:test"
import type { Session, SessionStatus } from "@opencode-ai/sdk/v2"
import { codingActivity } from "../src/feature-plugins/learning/activity"
import { createTuiPluginApi } from "./fixture/tui-plugin"

function session(id: string, parentID?: string, role?: string): Session {
  return {
    id,
    parentID,
    slug: id,
    projectID: "project",
    directory: "/project",
    title: id,
    version: "1",
    time: { created: 1, updated: 1 },
    ...(role ? { metadata: { "learning.source": parentID, "learning.role": role } } : {}),
  }
}

test("a cached coding session with no status entry is idle, while a missing session is unavailable", () => {
  const api = createTuiPluginApi({ state: { session: { get: (id) => (id === "source" ? session(id) : undefined) } } })
  expect(codingActivity(api.state, "source")).toEqual({ label: "Idle", attention: false })
  expect(codingActivity(api.state, "missing")).toEqual({ label: "Status unavailable", attention: false })
})

test("coding waits include nested coding subagents and ignore learning child sessions", () => {
  const sessions = [
    session("source"),
    session("chat", "source", "chat"),
    session("topics", "source", "topics"),
    session("task", "source"),
    session("nested", "task"),
  ]
  const status: Record<string, SessionStatus> = { source: { type: "idle" }, chat: { type: "busy" } }
  const permissions = new Set<string>()
  const questions = new Set<string>()
  const api = createTuiPluginApi({
    state: {
      session: {
        get: (id) => sessions.find((entry) => entry.id === id),
        children: (id) => sessions.filter((entry) => entry.parentID === id),
        status: (id) => status[id],
        permission: (id) =>
          permissions.has(id)
            ? [
                {
                  id: "permission",
                  sessionID: id,
                  permission: "bash",
                  patterns: ["bun test"],
                  always: [],
                  metadata: {},
                },
              ]
            : [],
        question: (id) => (questions.has(id) ? [{ id: "question", sessionID: id, questions: [] }] : []),
      },
    },
  })
  permissions.add("chat")
  questions.add("topics")
  expect(codingActivity(api.state, "source")).toEqual({ label: "Idle", attention: false })
  status.nested = { type: "busy" }
  expect(codingActivity(api.state, "source")).toEqual({ label: "Working", attention: false })
  questions.add("nested")
  expect(codingActivity(api.state, "source")).toEqual({ label: "Waiting for your answer", attention: true })
  permissions.add("task")
  expect(codingActivity(api.state, "source")).toEqual({ label: "Waiting for permission", attention: true })
})
