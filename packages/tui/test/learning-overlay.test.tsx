/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { TextareaRenderable, type Renderable, ScrollBoxRenderable } from "@opentui/core"
import { testRender, useRenderer } from "@opentui/solid"
import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { CompanionOverlay } from "../src/feature-plugins/learning"
import type { createCompanion } from "../src/feature-plugins/learning/controller"
import { KVProvider } from "../src/context/kv"
import { ThemeProvider } from "../src/context/theme"
import { TuiConfigProvider } from "../src/config"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../src/keymap"
import { TestTuiContexts } from "./fixture/tui-environment"
import { createTuiPluginApi } from "./fixture/tui-plugin"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"
import { tmpdir } from "./fixture/fixture"

function find<T extends Renderable>(root: Renderable, ctor: new (...args: never[]) => T): T | undefined {
  if (root instanceof ctor) return root
  for (const child of root.getChildren()) {
    const found = find(child, ctor)
    if (found) return found
  }
}

for (const width of [80, 140])
  test(`learning overlay isolates typing and scrolling at ${width}×24`, async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const asked: string[] = []
    const added: { kind: string; text: string }[] = []
    const saves: ReturnType<typeof Promise.withResolvers<void>>[] = []
    const toasts: { variant: string; message: string }[] = []
    let main: TextareaRenderable | undefined
    let close = 0
    const [records] = createStore({
      source: {
        turns: [
          {
            question: "Explain tests",
            reply: {
              explanation: Array.from({ length: 40 }, (_, i) => `Line ${i}: observed test result.`).join("\n\n"),
              evidence: [],
              notes: [],
            },
            evidence: [],
            notes: [],
            version: "v",
          },
        ],
        entries: [],
        busy: false,
        paused: false,
        version: "v",
      },
    })
    const companion = {
      records,
      load: async () => {},
      ask: async (_id: string, question: string) => {
        asked.push(question)
      },
      cancel: async () => {},
      pause() {},
      dismiss() {},
      save: async () => {},
      add: (_id: string, kind: string, text: string) => {
        added.push({ kind, text })
        const save = Promise.withResolvers<void>()
        saves.push(save)
        return save.promise
      },
      remove: async () => {},
      send: async () => {},
      checkDelivery: async () => {},
    } as unknown as ReturnType<typeof createCompanion>

    function Harness() {
      const renderer = useRenderer()
      const keymap = createDefaultOpenTuiKeymap(renderer)
      const config = createTuiResolvedConfig()
      onCleanup(registerOpencodeKeymap(keymap, renderer, config))
      const base = createTuiPluginApi({ keymap })
      const api = {
        ...base,
        route: { current: { name: "session", params: { sessionID: "source" } } },
        ui: {
          ...base.ui,
          toast(value: { variant: string; message: string }) {
            toasts.push(value)
          },
          dialog: {
            ...base.ui.dialog,
            blocking: true,
            clear() {
              close++
            },
          },
        },
      } as unknown as TuiPluginApi
      return (
        <TestTuiContexts directory={tmp.path} paths={{ state: tmp.path, worktree: tmp.path }}>
          <OpencodeKeymapProvider keymap={keymap}>
            <TuiConfigProvider config={config}>
              <KVProvider>
                <ThemeProvider mode="dark">
                  <box height={24}>
                    <textarea
                      ref={(value) => {
                        main = value
                      }}
                      height={3}
                      initialValue="unsent coding draft"
                    />
                    <box position="absolute" left={1} top={1} width={width - 2} height={22}>
                      <CompanionOverlay api={api} companion={companion} sourceID="source" />
                    </box>
                  </box>
                </ThemeProvider>
              </KVProvider>
            </TuiConfigProvider>
          </OpencodeKeymapProvider>
        </TestTuiContexts>
      )
    }
    const app = await testRender(() => <Harness />, { width, height: 24, kittyKeyboard: true })
    try {
      for (
        let attempt = 0;
        attempt < 200 &&
        !(
          app.renderer.currentFocusedEditor instanceof TextareaRenderable && app.renderer.currentFocusedEditor !== main
        );
        attempt++
      ) {
        await Bun.sleep(10)
        await app.renderOnce()
      }
      expect(app.renderer.currentFocusedEditor).toBeInstanceOf(TextareaRenderable)
      expect(app.renderer.currentFocusedEditor).not.toBe(main)
      const input = app.renderer.currentFocusedEditor as TextareaRenderable
      await app.mockInput.typeText("why did it fail?")
      await app.flush()
      expect(main?.plainText).toBe("unsent coding draft")
      expect(input.plainText).toBe("why did it fail?")
      const scroll = find(app.renderer.root, ScrollBoxRenderable)!
      scroll.scrollTo(12)
      await app.renderOnce()
      const before = scroll.scrollTop
      app.mockInput.pressKey("\u001b[5~")
      await app.flush()
      expect(scroll.scrollTop).toBeLessThan(before)
      expect(main?.plainText).toBe("unsent coding draft")
      app.mockInput.pressEnter()
      await app.flush()
      expect(asked).toEqual(["why did it fail?"])
      expect(main?.plainText).toBe("unsent coding draft")
      expect(input.plainText).toBe("")
      const frame = app.captureCharFrame()
      expect(frame).toContain("Ask about this project")
      expect(frame).toContain("Learning companion")
      expect(close).toBe(0)

      app.mockInput.pressKey("n", { meta: true })
      await app.flush()
      await app.mockInput.typeText("  Remember schema validation.  ")
      app.mockInput.pressEnter()
      await app.flush()
      expect(added).toEqual([{ kind: "note", text: "  Remember schema validation.  " }])
      expect(input.plainText).toBe("  Remember schema validation.  ")
      app.mockInput.pressEnter()
      await app.flush()
      expect(added).toHaveLength(1)
      saves[0].resolve()
      await app.flush()
      expect(input.plainText).toBe("")
      expect(toasts).toEqual([{ variant: "success", message: "Saved to notebook" }])
      expect(app.captureCharFrame()).toContain("Project notebook")

      app.mockInput.pressKey("n", { meta: true })
      await app.flush()
      await app.mockInput.typeText("First note")
      app.mockInput.pressEnter()
      await app.flush()
      input.setText("Newer unsaved draft")
      saves[1].resolve()
      await app.flush()
      expect(added[1]).toEqual({ kind: "note", text: "First note" })
      expect(input.plainText).toBe("Newer unsaved draft")
      expect(toasts.filter((toast) => toast.variant === "success")).toHaveLength(2)

      app.mockInput.pressEnter()
      await app.flush()
      expect(added[2]).toEqual({ kind: "note", text: "Newer unsaved draft" })
      saves[2].reject(new Error("Notebook unavailable"))
      await app.flush()
      expect(input.plainText).toBe("Newer unsaved draft")
      expect(toasts.at(-1)).toEqual({ variant: "error", message: "Notebook unavailable" })
      expect(toasts.filter((toast) => toast.variant === "success")).toHaveLength(2)
      expect(main?.plainText).toBe("unsent coding draft")
    } finally {
      app.renderer.destroy()
    }
  })
