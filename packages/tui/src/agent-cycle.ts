import type { OpenTuiKeymap } from "./keymap"
import { isLearningSession } from "./util/session"

export function agentCycleCommands(input: {
  agent: {
    list: () => ReadonlyArray<{ name: string }>
    current: () => { name: string } | undefined
    move: (direction: 1 | -1) => void
    set: (name: string) => void
  }
  source: () => { id: string; parentID?: string; metadata?: Record<string, unknown> } | undefined
  keymap: Pick<OpenTuiKeymap, "getCommands" | "dispatchCommand">
  dialog: { readonly splitWidth: number; blur?: () => void; clear: () => void }
}) {
  function available() {
    const source = input.source()
    return (
      !!source &&
      !isLearningSession(source) &&
      input.keymap.getCommands().some((command) => command.name === "learning.open")
    )
  }
  return [
    {
      name: "agent.cycle.reverse",
      title: "Agent cycle reverse",
      category: "Agent",
      hidden: true,
      run: () => {
        const agents = input.agent.list()
        const current = input.agent.current()
        const index = agents.findIndex((agent) => agent.name === current?.name)
        if (index >= 0 && (index - 1 + agents.length) % agents.length === 0 && available()) {
          input.keymap.dispatchCommand("learning.open")
          return
        }
        input.agent.move(-1)
      },
    },
    {
      name: "learning.cycle-back",
      title: "Return from Learn to the first coding agent",
      category: "Agent",
      hidden: true,
      run: () => {
        const first = input.agent.list().at(0)
        if (!first || !available()) return
        input.agent.set(first.name)
        if (input.dialog.splitWidth && input.dialog.blur) {
          input.dialog.blur()
          return
        }
        input.dialog.clear()
      },
    },
  ]
}
