/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { tmpdir } from "./fixture/fixture"
import { learningView } from "./fixture/learning-view"
import { agentCycleCommands } from "../src/agent-cycle"

test("switching input between coding and Learn keeps both drafts and the split pane", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 140, 36)
  await view.app.mockInput.typeText("learning draft")
  const coding = view.main()
  const position = { x: coding.x, y: coding.y }
  await view.app.mockMouse.click(coding.x + 1, coding.y)
  await view.flush()
  expect(view.find("learning-overlay") !== undefined).toBe(true)
  expect({ x: coding.x, y: coding.y }).toEqual(position)
  coding.gotoBufferEnd()
  await view.app.mockInput.typeText(" + coding draft")
  await view.flush()
  expect(view.input().plainText).toBe("learning draft")
  expect(coding.plainText).toBe("unsent coding draft + coding draft")
  view.app.mockInput.pressKey("n", { ctrl: true })
  await view.flush()
  expect(view.find("notebook-list")).toBeUndefined()
  await view.app.mockMouse.click(view.input().x + 1, view.input().y)
  await view.flush()
  view.input().gotoBufferEnd()
  await view.app.mockInput.typeText(" + learning")
  await view.flush()
  expect(view.input().plainText).toBe("learning draft + learning")
  expect(coding.plainText).toBe("unsent coding draft + coding draft")
  await view.click("learning-close")
  expect(view.find("learning-overlay")).toBeUndefined()
})

for (const next of ["Learn", "fullscreen"])
  test(`a delayed coding focus cannot steal typing after returning to ${next}`, async () => {
    await using tmp = await tmpdir()
    await using view = await learningView(tmp.path, 140, 36)
    view.dialog().blur()
    if (next === "Learn") view.dialog().focus()
    else view.app.renderer.resize(80, 24)
    await view.flush()
    await Bun.sleep(10)
    await view.flush()
    expect(view.app.renderer.currentFocusedRenderable === view.input()).toBe(true)
    await view.app.mockInput.typeText("still learning")
    expect(view.input().plainText).toBe("still learning")
    expect(view.main().plainText).toBe("unsent coding draft")
  })

test("Shift+Tab from the Learn question returns to Build; Notebook and preview keep control navigation", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 140, 36)
  const agent = { name: "plan" }
  const off = view.keymap().registerLayer({
    commands: [
      { name: "learning.open", run: () => view.dialog().focus() },
      ...agentCycleCommands({
        agent: {
          list: () => [{ name: "build" }, { name: "plan" }],
          current: () => agent,
          move: () => {},
          set: (name) => {
            agent.name = name
          },
        },
        source: () => ({ id: "source" }),
        keymap: view.keymap(),
        dialog: view.dialog(),
      }),
    ],
  })
  try {
    await view.app.mockInput.typeText("learning draft")
    view.app.mockInput.pressTab({ shift: true })
    await Bun.sleep(10)
    await view.flush()
    expect(agent.name).toBe("build")
    expect(view.dialog().blocking).toBe(false)
    expect(view.find("learning-overlay")).toBeDefined()
    expect(view.app.renderer.currentFocusedRenderable === view.main()).toBe(true)
    expect(view.input().plainText).toBe("learning draft")
    expect(view.main().plainText).toBe("unsent coding draft")
    await view.click("learning-notebook")
    await view.click("learning-input")
    view.app.mockInput.pressTab({ shift: true })
    await view.flush()
    expect(view.dialog().blocking).toBe(true)
    expect(view.app.renderer.currentFocusedRenderable === view.main()).toBe(false)
    await view.click("learning-chat")
    await view.click("learning-send")
    await view.click("learning-input")
    view.app.mockInput.pressTab({ shift: true })
    await view.flush()
    expect(view.dialog().blocking).toBe(true)
    expect(view.sent).toEqual([])
    await view.click("learning-back")
    expect(view.input().plainText).toBe("learning draft")
  } finally {
    off()
  }
})

test("saving a note after switching panes restores the learning draft without stealing coding focus", async () => {
  await using tmp = await tmpdir()
  const stored = Promise.withResolvers<void>()
  let saves = 0
  await using view = await learningView(tmp.path, 140, 36, {}, "dark", "Calculator demo", {
    add: async () => {
      saves++
      await stored.promise
    },
  })
  await view.app.mockInput.typeText("learning draft")
  await view.click("learning-notebook")
  await view.click("learning-add-note")
  await view.app.mockInput.typeText("Remember zero as a boundary input")
  view.app.mockInput.pressEnter()
  await view.flush()
  expect(saves).toBe(1)
  await view.app.mockMouse.click(view.main().x + 1, view.main().y)
  await Bun.sleep(10)
  await view.flush()
  expect(view.dialog().blocking).toBe(false)
  expect(view.app.renderer.currentFocusedRenderable === view.main()).toBe(true)
  stored.resolve()
  await view.flush()
  expect(view.app.renderer.currentFocusedRenderable === view.main()).toBe(true)
  expect(view.input().plainText).toBe("learning draft")
  expect(view.main().plainText).toBe("unsent coding draft")
})

for (const action of ["close", "switch session"])
  test(`a pending save finishing after ${action} does not read its destroyed input or show a false error`, async () => {
    await using tmp = await tmpdir()
    const stored = Promise.withResolvers<void>()
    await using view = await learningView(tmp.path, 140, 24, {}, "dark", "Calculator demo", {
      add: () => stored.promise,
    })
    await view.click("learning-notebook")
    await view.click("learning-add-note")
    await view.app.mockInput.typeText("Keep the boundary-input example")
    view.app.mockInput.pressEnter()
    await view.flush()
    const old = view.input()
    if (action === "close") await view.click("learning-close")
    else view.setSession("other")
    await Bun.sleep(10)
    await view.flush()
    expect(old.isDestroyed).toBe(true)
    stored.resolve()
    await view.flush()
    expect(view.toasts).toEqual([{ variant: "success", message: "Saved to notebook" }])
    expect(view.find("learning-overlay")).toBeUndefined()
    expect(view.main().plainText).toBe("unsent coding draft")
    expect(view.app.renderer.currentFocusedRenderable === view.main()).toBe(true)
  })
