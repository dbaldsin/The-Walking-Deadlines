/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { QuestionRequest } from "@opencode-ai/sdk/v2"
import { tmpdir } from "./fixture/fixture"
import { learningView } from "./fixture/learning-view"
import { json } from "./fixture/tui-sdk"
import { Renderable, TextRenderable } from "@opentui/core"

test("a coding question arriving after Learn opens cannot consume companion typing or send an answer", async () => {
  await using tmp = await tmpdir()
  const requests: { method: string; path: string; body: unknown }[] = []
  const reply = Promise.withResolvers<void>()
  const transport = (async (input: RequestInfo | URL) => {
    if (!(input instanceof Request)) throw new Error("Expected a real SDK request")
    const url = new URL(input.url)
    if (!url.pathname.startsWith("/question/")) throw new Error(`Unexpected request: ${url.pathname}`)
    requests.push({ method: input.method, path: url.pathname, body: await input.json() })
    reply.resolve()
    return json(true)
  }) as typeof globalThis.fetch
  await using view = await learningView(tmp.path, 140, 36, {}, "dark", "Calculator demo", { fetch: transport })
  const question: QuestionRequest = {
    id: "coding-question",
    sessionID: "source",
    questions: [
      {
        header: "Next step",
        question: "Which coding task should I perform next?",
        options: [
          { label: "Keep coding", description: "Continue the current task" },
          { label: "Review tests", description: "Check the completed test results" },
        ],
        custom: false,
      },
    ],
  }

  // Mount the actual QuestionPrompt after the companion has taken keyboard focus.
  view.setCodingQuestion(question)
  await view.flush()
  const text = "help 1 j k l h"
  await view.app.mockInput.typeText(text)
  await view.flush()
  expect(view.input().plainText).toBe(text)
  expect(requests).toEqual([])
  expect(view.main().plainText).toBe("unsent coding draft")

  await view.click("learning-close")
  expect(view.find("learning-input")).toBeUndefined()
  view.app.mockInput.pressKey("1")
  await reply.promise
  await view.flush()
  expect(requests).toEqual([
    { method: "POST", path: "/question/coding-question/reply", body: { answers: [["Keep coding"]] } },
  ])
})

test("a held coding question click keeps its layout until release and then returns to coding", async () => {
  await using tmp = await tmpdir()
  const answers: unknown[] = []
  const reply = Promise.withResolvers<void>()
  const transport = (async (input: RequestInfo | URL) => {
    if (!(input instanceof Request)) throw new Error("Expected an SDK request")
    expect(new URL(input.url).pathname).toBe("/question/coding-question/reply")
    answers.push(await input.json())
    reply.resolve()
    return json(true)
  }) as typeof globalThis.fetch
  await using view = await learningView(tmp.path, 140, 36, {}, "dark", "Calculator demo", { fetch: transport })
  view.setCodingQuestion({
    id: "coding-question",
    sessionID: "source",
    questions: [
      {
        header: "Next step",
        question: "Continue coding?",
        custom: false,
        options: [
          {
            label: "Review tests",
            description:
              "Review the completed focused tests and compare their results with the changes in the calculator before deciding whether another regression test is useful.",
          },
          { label: "Keep coding", description: "Continue the current task" },
        ],
      },
    ],
  })
  await view.flush()
  function find(node: Renderable): TextRenderable | undefined {
    if (node instanceof TextRenderable && node.plainText === "Keep coding") return node
    for (const child of node.getChildren()) {
      const found = find(child)
      if (found) return found
    }
  }
  const option = find(view.app.renderer.root)!
  const position = { x: option.x + 1, y: option.y }
  await view.app.mockMouse.pressDown(position.x, position.y)
  await view.flush()
  expect(view.find("learning-input") !== undefined).toBe(true)
  expect({ x: option.x + 1, y: option.y }).toEqual(position)
  expect(answers).toEqual([])
  await view.app.mockMouse.release(position.x, position.y)
  await view.flush()
  expect(view.find("learning-input") === undefined).toBe(true)
  await reply.promise
  expect(answers).toEqual([{ answers: [["Keep coding"]] }])
})
