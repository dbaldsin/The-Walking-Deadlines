/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { createEffect, createSignal, onCleanup, onMount, untrack } from "solid-js"
import { TuiConfigProvider } from "../../../src/config"
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider } from "../../../src/context/theme"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../../src/keymap"
import { DialogProvider, useDialog, type DialogContext } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

async function mountDialog(root: string) {
  await Bun.write(`${root}/kv.json`, "{}")
  const [size, setSize] = createSignal<"medium" | "large" | "xlarge" | "fullscreen" | "split">()
  let dialog: DialogContext | undefined
  let main: TextareaRenderable | undefined
  let content: TextareaRenderable | undefined

  function Control() {
    dialog = useDialog()
    onMount(() => main!.focus())
    createEffect(() => {
      const next = size()
      if (!next) return
      untrack(() => {
        dialog!.replace(<textarea ref={(value) => (content = value)} height={3} />)
        dialog!.setSize(next)
      })
    })
    return <textarea ref={(value) => (main = value)} height={3} initialValue="unsent coding draft" />
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig()
    onCleanup(registerOpencodeKeymap(keymap, renderer, config))
    return (
      <TestTuiContexts directory={root} paths={{ state: root, worktree: root }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <KVProvider>
              <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
                <ToastProvider>
                  <DialogProvider>
                    <Control />
                  </DialogProvider>
                </ToastProvider>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 140, height: 40, kittyKeyboard: true })
  const deadline = Date.now() + 2000
  while (!main?.focused) {
    if (Date.now() > deadline) {
      app.renderer.destroy()
      throw new Error("timed out mounting dialog harness")
    }
    await Bun.sleep(10)
    await app.renderOnce()
  }
  return {
    app,
    main: () => main!,
    content: () => content!,
    dialog: () => dialog!,
    async open(value: NonNullable<ReturnType<typeof size>>) {
      setSize(value)
      await app.flush()
      await app.renderOnce()
      content!.focus()
      return content!.parent!
    },
  }
}

test("fullscreen dialogs keep a one-cell margin after resize and restore prompt focus on escape", async () => {
  await using tmp = await tmpdir()
  const view = await mountDialog(tmp.path)
  try {
    const panel = await view.open("fullscreen")
    expect({ x: panel.x, y: panel.y, width: panel.width, height: panel.height }).toEqual({
      x: 1,
      y: 1,
      width: 138,
      height: 38,
    })
    expect(view.content().y).toBe(panel.y)
    view.app.renderer.resize(80, 24)
    await view.app.flush()
    await view.app.renderOnce()
    expect({ x: panel.x, y: panel.y, width: panel.width, height: panel.height }).toEqual({
      x: 1,
      y: 1,
      width: 78,
      height: 22,
    })
    await view.app.mockInput.typeText("learning question")
    expect(view.content().plainText).toBe("learning question")
    expect(view.main().plainText).toBe("unsent coding draft")
    view.app.mockInput.pressEscape()
    await view.app.flush()
    await Bun.sleep(10)
    expect(view.dialog().stack).toHaveLength(0)
    expect(view.app.renderer.currentFocusedRenderable).toBe(view.main())
    expect(view.main().plainText).toBe("unsent coding draft")
  } finally {
    view.app.renderer.destroy()
  }
})

test("existing dialog sizes preserve their width and quarter-height placement", async () => {
  await using tmp = await tmpdir()
  const view = await mountDialog(tmp.path)
  try {
    for (const [size, width] of [
      ["medium", 60],
      ["large", 88],
      ["xlarge", 116],
    ] as const) {
      const panel = await view.open(size)
      expect(panel.width).toBe(width)
      expect(panel.y).toBe(10)
      expect(panel.height).toBe(4)
    }
    view.app.renderer.resize(80, 24)
    await view.app.flush()
    await view.app.renderOnce()
    expect(view.content().parent!.width).toBe(78)
    expect(view.content().parent!.y).toBe(6)
  } finally {
    view.app.renderer.destroy()
  }
})

test("split dialogs reserve the right pane and fall back safely on narrow terminals", async () => {
  await using tmp = await tmpdir()
  const view = await mountDialog(tmp.path)
  try {
    const panel = await view.open("split")
    expect({ x: panel.x, y: panel.y, width: panel.width, height: panel.height }).toEqual({
      x: 76,
      y: 1,
      width: 63,
      height: 38,
    })
    expect(view.dialog().splitWidth).toBe(64)
    expect(view.content().x).toBe(77)
    view.app.renderer.resize(80, 24)
    await view.app.flush()
    await view.app.renderOnce()
    expect({ x: panel.x, y: panel.y, width: panel.width, height: panel.height }).toEqual({
      x: 1,
      y: 1,
      width: 78,
      height: 22,
    })
    expect(view.dialog().splitWidth).toBe(0)
    view.app.renderer.resize(200, 36)
    await view.app.flush()
    await view.app.renderOnce()
    expect(panel.x).toBe(113)
    expect(panel.width).toBe(86)
    expect(view.dialog().splitWidth).toBe(87)
    view.dialog().clear()
    await view.app.flush()
    expect(view.dialog().splitWidth).toBe(0)
    expect(view.main().plainText).toBe("unsent coding draft")
  } finally {
    view.app.renderer.destroy()
  }
})
