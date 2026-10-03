/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { onCleanup } from "solid-js"
import { agentCycleCommands } from "../src/agent-cycle"
import { OPENCODE_BASE_MODE, OpencodeKeymapProvider, registerOpencodeKeymap, type OpenTuiKeymap } from "../src/keymap"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"

async function cycleView(
  options: {
    agents?: string[]
    source?: { id: string; parentID?: string; metadata?: Record<string, unknown> } | null
    learning?: boolean
    split?: boolean
    shortcut?: string
  } = {},
) {
  const state = {
    current: options.agents?.[0] ?? "build",
    names: options.agents ?? ["build", "plan"],
    moves: [] as number[],
    opened: 0,
    blurred: 0,
    closed: 0,
    source: options.source === null ? undefined : (options.source ?? { id: "coding-session" }),
  }
  let keymap: OpenTuiKeymap
  function Harness() {
    const renderer = useRenderer()
    keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig(
      options.shortcut ? { keybinds: { agent_cycle_reverse: options.shortcut } } : {},
    )
    const offKeymap = registerOpencodeKeymap(keymap, renderer, config)
    const offCommands = keymap.registerLayer({
      commands: [
        ...agentCycleCommands({
          agent: {
            list: () => state.names.map((name) => ({ name })),
            current: () => ({ name: state.current }),
            move: (direction) => state.moves.push(direction),
            set: (name) => {
              state.current = name
            },
          },
          source: () => state.source,
          keymap,
          dialog: {
            splitWidth: options.split === false ? 0 : 64,
            blur: () => {
              state.blurred++
            },
            clear: () => {
              state.closed++
            },
          },
        }),
        ...(options.learning === false
          ? []
          : [
              {
                name: "learning.open",
                run: () => {
                  state.opened++
                },
              },
            ]),
      ],
    })
    const offBindings = keymap.registerLayer({
      mode: OPENCODE_BASE_MODE,
      bindings: config.keybinds.get("agent.cycle.reverse"),
    })
    onCleanup(() => {
      offBindings()
      offCommands()
      offKeymap()
    })
    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <textarea id="coding-input" focused />
      </OpencodeKeymapProvider>
    )
  }
  const app = await testRender(() => <Harness />, { kittyKeyboard: true })
  await app.flush()
  await app.renderOnce()
  return {
    app,
    state,
    back: () => keymap.dispatchCommand("learning.cycle-back"),
    async [Symbol.asyncDispose]() {
      app.renderer.destroy()
    },
  }
}

test("Shift+Tab inserts Learn when the coding reverse cycle returns from Plan to Build", async () => {
  await using view = await cycleView()
  view.app.mockInput.pressTab({ shift: true })
  expect(view.state.moves).toEqual([-1])
  expect(view.state.opened).toBe(0)
  view.state.current = "plan"
  view.app.mockInput.pressTab({ shift: true })
  expect(view.state.opened).toBe(1)
  expect(view.state.moves).toEqual([-1])
  expect(view.state.current).toBe("plan")
})

test("Learn cycle follows configured reverse shortcut and preserves custom agent order", async () => {
  await using view = await cycleView({ agents: ["build", "plan", "review"], shortcut: "ctrl+y" })
  for (const current of ["build", "review"]) {
    view.state.current = current
    view.app.mockInput.pressKey("y", { ctrl: true })
  }
  expect(view.state.moves).toEqual([-1, -1])
  expect(view.state.opened).toBe(0)
  view.state.current = "plan"
  view.app.mockInput.pressKey("y", { ctrl: true })
  expect(view.state.opened).toBe(1)
  expect(view.state.moves).toEqual([-1, -1])
  expect(view.state.current).toBe("plan")
})

for (const options of [
  { source: null },
  { learning: false },
  {
    source: {
      id: "learning-child",
      parentID: "coding-session",
      metadata: { "learning.source": "coding-session", "learning.role": "chat" },
    },
  },
  {
    source: {
      id: "topic-child",
      parentID: "coding-session",
      metadata: { "learning.source": "coding-session", "learning.role": "topics" },
    },
  },
])
  test(`normal agent cycle remains available without a coding companion: ${JSON.stringify(options)}`, async () => {
    await using view = await cycleView(options)
    view.state.current = "plan"
    view.app.mockInput.pressTab({ shift: true })
    expect(view.state.moves).toEqual([-1])
    expect(view.state.opened).toBe(0)
  })

for (const split of [true, false])
  test(`cycling back from Learn selects first agent and returns to coding in ${split ? "split" : "fullscreen"}`, async () => {
    await using view = await cycleView({ agents: ["build", "plan", "review"], split })
    view.state.current = "plan"
    view.back()
    expect(view.state.current).toBe("build")
    expect(view.state.blurred).toBe(split ? 1 : 0)
    expect(view.state.closed).toBe(split ? 0 : 1)
    expect(view.state.opened).toBe(0)
    expect(view.state.moves).toEqual([])
  })

test("cycle-back ignores a missing coding session", async () => {
  await using view = await cycleView({ source: null })
  view.state.current = "plan"
  view.back()
  expect(view.state.current).toBe("plan")
  expect(view.state.blurred).toBe(0)
  expect(view.state.closed).toBe(0)
})

test("a single visible coding agent can cycle to Learn without changing that agent", async () => {
  await using view = await cycleView({ agents: ["build"] })
  view.app.mockInput.pressTab({ shift: true })
  expect(view.state.opened).toBe(1)
  expect(view.state.current).toBe("build")
  expect(view.state.moves).toEqual([])
})

test("an empty agent list delegates normal cycling and cycle-back does not change focus", async () => {
  await using view = await cycleView({ agents: [] })
  view.app.mockInput.pressTab({ shift: true })
  view.back()
  expect(view.state.moves).toEqual([-1])
  expect(view.state.opened).toBe(0)
  expect(view.state.blurred).toBe(0)
  expect(view.state.closed).toBe(0)
})
