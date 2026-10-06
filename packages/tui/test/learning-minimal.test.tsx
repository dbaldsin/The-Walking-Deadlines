/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { ScrollBoxRenderable } from "@opentui/core"
import { tmpdir } from "./fixture/fixture"
import { learningTurn, learningView } from "./fixture/learning-view"

for (const [width, height] of [
  [80, 24],
  [140, 24],
  [140, 36],
])
  test(`minimal controls and in-view menus fit ${width}×${height}`, async () => {
    await using tmp = await tmpdir()
    await using view = await learningView(tmp.path, width, height, { version: "new" })
    for (const id of ["learning-options", "learning-actions", "learning-simpler", "learning-example"]) {
      const node = view.find(id)!
      expect(node).toBeDefined()
      expect(node.y + node.height).toBeLessThanOrEqual(height - 1)
      expect(node.x + node.width).toBeLessThanOrEqual(width - 1)
    }
    for (const id of [
      "learning-layout",
      "learning-pause",
      "learning-return",
      "learning-more",
      "learning-save",
      "learning-update",
    ])
      expect(view.find(id)).toBeUndefined()
    expect(view.app.captureCharFrame()).not.toContain("Coding:")
    expect(view.app.captureCharFrame()).not.toContain("Shift+Enter newline")
    expect(view.input().height).toBe(3)
    await view.click("learning-actions")
    expect(view.find("learning-save")).toBeDefined()
    expect(view.find("learning-update")).toBeDefined()
    await view.click("learning-options")
    expect(view.find("learning-save")).toBeUndefined()
    expect(view.find("learning-layout")).toBeDefined()
    expect(view.find("learning-menu")!.y + view.find("learning-menu")!.height).toBeLessThanOrEqual(height - 1)
    expect(view.input().height).toBe(3)
  })

test("Escape dismisses menus before closing Learn and restores the menu trigger", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 80, 24)
  view.input().setText("unfinished question")
  await view.click("learning-options")
  view.app.mockInput.pressEscape()
  await view.flush()
  expect(view.find("learning-overlay")).toBeDefined()
  expect(view.find("learning-layout")).toBeUndefined()
  expect(view.app.renderer.currentFocusedRenderable?.id).toBe("learning-options")
  expect(view.input().plainText).toBe("unfinished question")
  view.app.mockInput.pressEscape()
  await view.flush()
  expect(view.find("learning-overlay")).toBeUndefined()
  expect(view.main().plainText).toBe("unsent coding draft")
})

test("coding focus dismisses a menu while preserving the pane and both drafts", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 140, 24)
  view.input().setText("learning draft")
  await view.click("learning-actions")
  await view.app.mockMouse.click(view.main().x + 1, view.main().y)
  await view.flush()
  await view.app.mockInput.typeText(" + coding")
  await view.flush()
  expect(view.find("learning-overlay")).toBeDefined()
  expect(view.find("learning-save")).toBeUndefined()
  expect(view.main().plainText).toContain(" + coding")
  expect(view.input().plainText).toBe("learning draft")
  await view.click("learning-input")
  expect(view.dialog().blocking).toBe(true)
})

test("busy Ask becomes explicit Cancel while Enter in the input does nothing", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 80, 24, { busy: true, pending: { label: "Why zero?" } })
  view.input().setText("next question draft")
  view.app.mockInput.pressEnter()
  await view.flush()
  expect(view.records.source.busy).toBe(true)
  expect(view.input().plainText).toBe("next question draft")
  expect(view.app.captureCharFrame()).toContain("Cancel")
  await view.click("learning-ask")
  expect(view.records.source.busy).toBe(false)
  expect(view.input().plainText).toBe("next question draft")
  expect(view.asked).toHaveLength(0)
})

test("Notebook browses without an editor and Add editing preserves the Chat draft", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 80, 24, {
    entries: [{ id: "note", kind: "note", text: "Remember zero", created: 1 }],
  })
  view.input().setText("original Chat draft")
  await view.click("learning-notebook")
  expect(view.find("learning-composer")!.visible).toBe(false)
  expect(view.app.captureCharFrame()).not.toContain("original Chat draft")
  expect(view.find("notebook-remove")).toBeUndefined()
  await view.click("notebook-actions")
  await view.click("notebook-remove")
  expect(view.removed).toEqual(["note"])
  await view.click("learning-add")
  await view.click("learning-add-note")
  expect(view.find("learning-composer")!.visible).toBe(true)
  view.input().setText("new private note")
  await view.click("learning-back")
  expect(view.find("learning-composer")!.visible).toBe(false)
  await view.click("learning-chat")
  expect(view.input().plainText).toBe("original Chat draft")
  expect(view.main().plainText).toBe("unsent coding draft")
})

test("Notebook Tab navigation cannot activate the hidden question editor or Ask button", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 80, 24)
  view.input().setText("preserved question")
  await view.click("learning-notebook")
  for (let i = 0; i < 20; i++) {
    view.app.mockInput.pressTab()
    await view.flush()
    expect(["learning-input", "learning-ask"]).not.toContain(view.app.renderer.currentFocusedRenderable?.id)
  }
  expect(view.input().plainText).toBe("preserved question")
  expect(view.asked).toHaveLength(0)
})

for (const width of [80, 140])
  test(`long notebook drafts keep Save visible at ${width} columns`, async () => {
    await using tmp = await tmpdir()
    await using view = await learningView(tmp.path, width, 24)
    await view.click("learning-notebook")
    await view.click("learning-add")
    await view.click("learning-add-note")
    view.input().setText("Walkthrough note: cube multiplies a number by itself three times.")
    await view.flush()
    const composer = view.find("learning-composer")!
    const save = view.find("learning-ask")!
    expect(save.x + save.width).toBeLessThanOrEqual(composer.x + composer.width)
    expect(view.input().x + view.input().width).toBeLessThanOrEqual(save.x)
    expect(view.app.captureCharFrame()).toContain("Save")
  })

test("returning focus to Notebook cannot restore the hidden Ask button", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 140, 24)
  view.input().setText("preserved question")
  view.find("learning-ask")!.focus()
  view.app.mockInput.pressKey("n", { ctrl: true })
  await view.flush()
  view.dialog().blur()
  await view.flush()
  view.dialog().focus()
  await view.flush()
  await Bun.sleep(10)
  await view.flush()
  expect(["learning-input", "learning-ask"]).not.toContain(view.app.renderer.currentFocusedRenderable?.id)
  expect(view.input().plainText).toBe("preserved question")
  expect(view.asked).toHaveLength(0)
})

test("shortcut help starts at the top and Tab skips menu controls below its viewport", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 140, 24)
  await view.click("learning-options")
  await view.click("learning-help")
  const menu = view.find("learning-menu") as ScrollBoxRenderable
  expect(menu.scrollTop).toBe(0)
  const initial = view.app.renderer.currentFocusedRenderable!
  expect(initial.y + initial.height).toBeLessThanOrEqual(menu.viewport.y + menu.viewport.height)
  for (let i = 0; i < 12; i++) {
    view.app.mockInput.pressTab()
    await view.flush()
    const focused = view.app.renderer.currentFocusedRenderable
    if (focused?.id === "learning-help-back")
      expect(focused.y + focused.height).toBeLessThanOrEqual(menu.viewport.y + menu.viewport.height)
  }
})

test("readable Markdown and collapsed evidence preserve the saved explanation", async () => {
  await using tmp = await tmpdir()
  const turn = learningTurn()
  turn.reply.explanation =
    "**The idea**\nZero catches the old bug.\n\n- **What changed:** Added a zero-input test.\n- **Why it matters:** Adding two would fail this test.\n- **Verified:** Both calculator tests passed."
  await using view = await learningView(tmp.path, 80, 36, { turns: [turn] })
  expect(view.find("answer-turn-0")!.width).toBeLessThanOrEqual(72)
  for (const label of ["The idea", "What changed", "Why it matters", "Verified"])
    expect(view.app.captureCharFrame()).toContain(label)
  const body = view.find("learning-body") as ScrollBoxRenderable
  body.scrollTo(body.scrollHeight)
  await view.flush()
  await view.click("sources-turn-0")
  expect(view.asked).toHaveLength(0)
  expect(view.records.source.turns[0].reply.explanation).toBe(turn.reply.explanation)
})
