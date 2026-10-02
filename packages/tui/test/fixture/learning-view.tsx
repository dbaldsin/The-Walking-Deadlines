/** @jsxImportSource @opentui/solid */
import { CodeRenderable, TextareaRenderable, type Renderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { CompanionOverlay } from "../../src/feature-plugins/learning"
import type { CompanionRecord, createCompanion } from "../../src/feature-plugins/learning/controller"
import type { Learning } from "../../src/feature-plugins/learning/data"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider, useTheme } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../src/keymap"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { TestTuiContexts } from "./tui-environment"
import { createTuiPluginApi } from "./tui-plugin"
import { createTuiResolvedConfig } from "./tui-runtime"

export function learningTurn(index = 0): Learning.Turn {
  return {
    id: `turn-${index}`,
    question: `Explain change ${index}`,
    reply: {
      explanation: `Observed: calculator test ${index} passed. This checks the zero input.`,
      evidence: ["e"],
      notes: ["n"],
      instruction: "Add a negative-input test.\nRun only bun test calculator.test.ts.",
    },
    evidence: [
      {
        id: "e",
        kind: "observed",
        label: "Completed bash · bun test calculator.test.ts",
        text: "2 passes; 0 failures",
      },
    ],
    notes: [{ id: "n", kind: "goal", text: "Understand boundary inputs", created: 1 }],
    version: "v",
  }
}

export async function learningView(
  directory: string,
  width: number,
  height: number,
  initial: Partial<CompanionRecord> = {},
  mode: "dark" | "light" = "dark",
  title = "Calculator demo",
) {
  await Bun.write(`${directory}/kv.json`, "{}")
  const [records, set] = createStore<Record<string, CompanionRecord>>({
    source: { turns: [learningTurn()], entries: [], busy: false, paused: false, version: "v", ...initial },
  })
  const [session, setSession] = createSignal("source")
  const asked: { question: string; presentation?: Learning.Presentation }[] = []
  const sent: string[] = []
  const removed: string[] = []
  let main: TextareaRenderable | undefined
  const companion = {
    records,
    load: async () => {},
    ask: async (_id: string, question: string, _previous?: Learning.Turn, presentation?: Learning.Presentation) => {
      asked.push({ question, presentation })
    },
    save: async () => {},
    add: async () => {},
    remove: async (_id: string, entryID: string) => {
      removed.push(entryID)
    },
    cancel: async () => set("source", { busy: false, pending: undefined }),
    pause: (_id: string, paused: boolean) => set("source", "paused", paused),
    dismiss: () => set("source", "topic", undefined),
    send: async (_id: string, text: string) => {
      sent.push(text)
      set("source", "delivery", { id: "sent", proposalID: "p", status: "sent", text })
    },
    checkDelivery: async () => {},
  } as unknown as ReturnType<typeof createCompanion>
  function Control() {
    const dialog = useDialog()
    const theme = useTheme()
    const base = createTuiPluginApi()
    const api = {
      ...base,
      theme: {
        get current() {
          return theme.theme
        },
      },
      route: {
        get current() {
          return { name: "session", params: { sessionID: session() } }
        },
      },
      ui: { ...base.ui, dialog },
      state: {
        ...base.state,
        session: { ...base.state.session, get: () => ({ id: "source", title, directory }) },
      },
    } as unknown as TuiPluginApi
    onMount(() => {
      main!.focus()
      dialog.replace(() => <CompanionOverlay api={api} companion={companion} sourceID="source" />)
    })
    return (
      <textarea
        ref={(value) => {
          main = value
        }}
        height={3}
        initialValue="unsent coding draft"
      />
    )
  }
  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    onCleanup(registerOpencodeKeymap(keymap, renderer, createTuiResolvedConfig()))
    return (
      <TestTuiContexts directory={directory} paths={{ state: directory, worktree: directory }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={createTuiResolvedConfig()}>
            <KVProvider>
              <ThemeProvider mode={mode} source={{ discover: async () => ({}) }}>
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
  const app = await testRender(() => <Harness />, { width, height, kittyKeyboard: true })
  async function settle() {
    await app.flush()
    const highlights: Promise<void>[] = []
    function collect(node: Renderable) {
      if (node instanceof CodeRenderable) highlights.push(node.highlightingDone)
      for (const child of node.getChildren()) collect(child)
    }
    collect(app.renderer.root)
    await Promise.all(highlights)
    await app.renderOnce()
  }
  for (
    let attempt = 0;
    attempt < 200 &&
    !(
      app.renderer.currentFocusedRenderable instanceof TextareaRenderable &&
      app.renderer.currentFocusedRenderable !== main
    );
    attempt++
  ) {
    await app.flush()
    await Bun.sleep(10)
  }
  await settle()
  function find(id: string, root: Renderable = app.renderer.root): Renderable | undefined {
    if (root.id === id) return root
    for (const child of root.getChildren()) {
      const result = find(id, child)
      if (result) return result
    }
  }
  return {
    app,
    records,
    set,
    setSession,
    asked,
    sent,
    removed,
    main: () => main!,
    input: () => find("learning-input") as TextareaRenderable,
    find,
    async click(id: string) {
      await settle()
      const item = find(id)
      if (!item) throw new Error(`Missing control ${id}`)
      await app.mockMouse.click(item.x + 1, item.y)
      await settle()
    },
    flush: settle,
    async [Symbol.asyncDispose]() {
      await settle()
      app.renderer.destroy()
    },
  }
}
