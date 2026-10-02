/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { tmpdir } from "./fixture/fixture"
import { learningTurn, learningView } from "./fixture/learning-view"

for (const [width, height] of [
  [80, 24],
  [140, 24],
  [140, 36],
])
  test(`companion controls stay visible and sources expand locally at ${width}×${height}`, async () => {
    await using tmp = await tmpdir()
    await using view = await learningView(tmp.path, width, height)
    const frame = view.app.captureCharFrame()
    expect(frame).toContain("Sources · 1")
    expect(frame).not.toContain("2 passes; 0 failures")
    for (const id of ["learning-input", "learning-simpler", "learning-send"]) {
      const item = view.find(id)!
      expect(item).toBeDefined()
      expect(item.y + item.height).toBeLessThanOrEqual(height - 1)
    }
    expect(view.input().height).toBe(3)
    await view.click("sources-turn-0")
    expect(view.app.captureCharFrame()).toContain("bun test calculator.test.ts")
    await view.click("evidence-turn-0-e")
    expect(view.app.captureCharFrame()).toContain("2 passes; 0 failures")
    expect(view.asked).toHaveLength(0)
    expect(view.main().plainText).toBe("unsent coding draft")
  })

test("follow-up actions use short presentation labels and remain unavailable while thinking", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 140, 36)
  await view.click("learning-simpler")
  expect(view.asked[0]).toMatchObject({ presentation: { kind: "simpler", label: "Simpler explanation" } })
  expect(view.asked[0].question).toContain("Previous explanation:")
  view.set("source", { busy: true, pending: { label: "Why zero?" } })
  await view.flush()
  expect(view.app.captureCharFrame()).toContain("Why zero?")
  expect(view.app.captureCharFrame()).toContain("Thinking")
  await view.click("learning-simpler")
  expect(view.asked).toHaveLength(1)
  await view.click("learning-cancel")
  expect(view.records.source.busy).toBe(false)
})

test("preview preserves companion and coding drafts, and sends only on explicit approval", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 80, 24)
  view.input().setText("my unfinished question")
  await view.click("learning-send")
  expect(view.app.captureCharFrame()).toContain("Calculator demo")
  expect(view.app.captureCharFrame()).toContain("source")
  expect(view.sent).toHaveLength(0)
  view.input().setText("Exact instruction\nwith a second line.")
  await view.click("learning-back")
  expect(view.input().plainText).toBe("my unfinished question")
  await view.click("learning-send")
  view.input().setText("Exact approved instruction\nwith a second line.")
  await view.click("learning-approve")
  expect(view.sent).toEqual(["Exact approved instruction\nwith a second line."])
  expect(view.input().plainText).toBe("my unfinished question")
  expect(view.main().plainText).toBe("unsent coding draft")
  expect(view.app.captureCharFrame()).toContain("Sent")
})

test("starter questions prefill only and keyboard can activate a focused action", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 80, 24, { turns: [] })
  await view.click("learning-starter-0")
  expect(view.input().plainText).toBe("Explain the last completed change.")
  expect(view.asked).toHaveLength(0)
  view.app.mockInput.pressTab()
  await view.flush()
  expect(view.app.renderer.currentFocusedRenderable instanceof TextareaRenderable).toBe(false)
  view.app.mockInput.pressEnter()
  await view.flush()
  expect(view.asked).toEqual([{ question: "Explain the last completed change.", presentation: undefined }])
  expect(view.main().plainText).toBe("unsent coding draft")
})

test("history mounts ten answers at a time and preserves immutable source text", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 140, 36, {
    turns: Array.from({ length: 30 }, (_, i) => learningTurn(i)),
  })
  expect(view.find("answer-turn-0")).toBeUndefined()
  expect(view.find("answer-turn-20")).toBeDefined()
  view.find("learning-body")?.focus()
  const body = view.find("learning-body") as import("@opentui/core").ScrollBoxRenderable
  body.scrollTo(0)
  await view.flush()
  await view.click("learning-history")
  expect(view.find("answer-turn-10")).toBeDefined()
  expect(view.find("answer-turn-0")).toBeUndefined()
  expect(view.records.source.turns[0].evidence[0].text).toBe("2 passes; 0 failures")
})

test("Notebook mounts one selected detail and adapts when the terminal is resized", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 140, 36, {
    entries: [
      { id: "one", kind: "note", text: "FIRST PRIVATE NOTE", created: 1 },
      { id: "two", kind: "goal", text: "SECOND PRIVATE GOAL", created: 2 },
    ],
  })
  await view.click("learning-notebook")
  expect(view.find("notebook-detail")).toBeDefined()
  expect(view.app.captureCharFrame()).toContain("FIRST PRIVATE NOTE")
  expect(view.find("notebook-detail-two")).toBeUndefined()
  await view.click("notebook-entry-two")
  expect(view.app.captureCharFrame()).toContain("SECOND PRIVATE GOAL")
  view.app.renderer.resize(80, 24)
  await view.flush()
  expect(view.find("notebook-detail")!.parent?.id).toBe("notebook-row-two")
  expect(view.find("learning-input")!.y + view.input().height).toBeLessThanOrEqual(23)
})

test("errors, paused topics and uncertain delivery stay readable in a light theme", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(
    tmp.path,
    80,
    24,
    {
      error: "Provider unavailable",
      paused: true,
      topic: "Why test zero?",
      delivery: { id: "d", proposalID: "p", status: "uncertain", text: "test" },
    },
    "light",
  )
  expect(view.app.captureCharFrame()).toContain("Provider unavailable")
  expect(view.app.captureCharFrame()).toContain("Uncertain")
  expect(view.find("learning-check-delivery")).toBeDefined()
  expect(view.input().height).toBe(3)
  view.setSession("other")
  await view.flush()
  expect(view.find("learning-input")).toBeUndefined()
})

for (const [width, height] of [
  [80, 24],
  [140, 24],
  [140, 36],
])
  test(`long content keeps fixed controls and full destination readable at ${width}×${height}`, async () => {
    await using tmp = await tmpdir()
    const turn = learningTurn()
    turn.reply.explanation = Array.from(
      { length: 60 },
      (_, i) =>
        `Paragraph ${i}: A boundary input helps us verify the calculator across changes. The answer stays stable while coding continues.`,
    ).join("\n\n")
    turn.evidence[0].text = "ORIGINAL TEST EVIDENCE\n" + "unchanged result\n".repeat(80)
    const title = "Calculator regression verification with boundary input coverage and a long destination title"
    await using view = await learningView(tmp.path, width, height, { turns: [turn] }, "dark", title)
    for (const id of [
      "learning-input",
      "learning-simpler",
      "learning-example",
      "learning-more",
      "learning-save",
      "learning-send",
    ]) {
      const item = view.find(id)!
      expect(item.y + item.height).toBeLessThanOrEqual(height - 1)
      expect(item.x + item.width).toBeLessThanOrEqual(width - 1)
    }
    expect(view.find("answer-turn-0")!.width).toBeLessThanOrEqual(84)
    await view.click("learning-send")
    expect(view.app.captureCharFrame().replace(/\s+/g, " ")).toContain(title)
    expect(view.input().height).toBeGreaterThanOrEqual(3)
    expect(view.find("learning-approve")!.y + view.find("learning-approve")!.height).toBeLessThanOrEqual(height - 1)
    view.input().setText("Exact instruction\n".repeat(40))
    view.app.mockInput.pressKey("\u001b[5~")
    await view.flush()
    expect(view.sent).toHaveLength(0)
    expect(view.main().plainText).toBe("unsent coding draft")
  })

test("returning to Chat exits note and goal modes and restores the question draft", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 80, 24)
  for (const id of ["learning-add-note", "learning-add-goal"]) {
    view.input().setText("unfinished companion question")
    await view.click("learning-notebook")
    await view.click(id)
    view.input().setText("private entry draft")
    await view.click("learning-chat")
    expect(view.input().plainText).toBe("unfinished companion question")
    view.app.mockInput.pressEnter()
    await view.flush()
    expect(view.asked.at(-1)?.question).toBe("unfinished companion question")
  }
  expect(view.main().plainText).toBe("unsent coding draft")
})

test("Enter on the transcript cannot activate a previously focused button", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 80, 24)
  await view.click("sources-turn-0")
  expect(view.find("evidence-turn-0-e")).toBeDefined()
  view.find("learning-body")!.focus()
  view.app.mockInput.pressEnter()
  await view.flush()
  expect(view.find("evidence-turn-0-e")).toBeDefined()
  expect(view.asked).toHaveLength(0)
  expect(view.sent).toHaveLength(0)
})

test("Tab skips transcript buttons clipped behind the fixed footer", async () => {
  await using tmp = await tmpdir()
  const turn = learningTurn()
  turn.reply.explanation = "A long explanation about a completed change.\n\n".repeat(70)
  await using view = await learningView(tmp.path, 80, 24, { turns: [turn] })
  const body = view.find("learning-body") as import("@opentui/core").ScrollBoxRenderable
  const button = view.find("sources-turn-0")!
  body.scrollTo(body.scrollTop + button.y - (body.viewport.y + body.viewport.height + 1))
  await view.flush()
  expect(button.y).toBeGreaterThanOrEqual(body.viewport.y + body.viewport.height)
  expect(button.y).toBeLessThan(view.find("learning-overlay")!.y + view.find("learning-overlay")!.height)
  view.input().focus()
  for (let i = 0; i < 20; i++) {
    view.app.mockInput.pressTab()
    await view.flush()
    expect(view.app.renderer.currentFocusedRenderable?.id === "sources-turn-0").toBe(false)
  }
})

test("Notebook keyboard actions survive backward selection and a wide-to-narrow resize", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 80, 36, {
    entries: [
      { id: "one", kind: "note", text: "FIRST NOTE", created: 1 },
      { id: "two", kind: "note", text: "SECOND NOTE", created: 2 },
    ],
  })
  await view.click("learning-notebook")
  await view.click("notebook-entry-two")
  await view.click("notebook-entry-one")
  view.find("notebook-remove")!.focus()
  view.app.mockInput.pressEnter()
  await view.flush()
  expect(view.removed).toEqual(["one"])
  view.app.renderer.resize(140, 36)
  await view.flush()
  view.app.renderer.resize(80, 36)
  await view.flush()
  view.find("notebook-remove")!.focus()
  view.app.mockInput.pressEnter()
  await view.flush()
  expect(view.removed).toEqual(["one", "one"])
})

test("steering editor pages long instructions without sending or changing either draft", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 80, 24)
  view.input().setText("unfinished question")
  await view.click("learning-send")
  const instruction = "Exact instruction line.\n".repeat(70)
  view.input().setText(instruction)
  view.input().gotoBufferHome()
  view.app.mockInput.pressKey("\u001b[6~")
  await view.flush()
  expect(view.input().scrollY).toBeGreaterThan(0)
  view.app.mockInput.pressKey("\u001b[5~")
  await view.flush()
  expect(view.input().scrollY).toBe(0)
  expect(view.input().plainText).toBe(instruction)
  expect(view.sent).toHaveLength(0)
  await view.click("learning-back")
  expect(view.input().plainText).toBe("unfinished question")
  expect(view.main().plainText).toBe("unsent coding draft")
})

test("Shift+Enter inserts a newline without submitting a companion question", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 80, 24)
  view.input().setText("first line")
  view.input().gotoBufferEnd()
  view.app.mockInput.pressEnter({ shift: true })
  await view.flush()
  expect(view.input().plainText).toBe("first line\n")
  expect(view.asked).toHaveLength(0)
  expect(view.main().plainText).toBe("unsent coding draft")
})
