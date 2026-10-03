import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import { BoxRenderable, ScrollBoxRenderable, type RGBA, type SyntaxStyle } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import type { Learning } from "./data"

export type NotebookHandle = {
  move: (direction: number) => void
  selected: () => Learning.Entry | undefined
}

export type NotebookAction = {
  id: string
  label: string
  hint?: string
  marker?: RGBA
  fullWidth?: boolean
  run: () => void
  disabled?: boolean
  active?: boolean
}

export function Notebook(props: {
  entries: Learning.Entry[]
  width: number
  theme: TuiThemeCurrent
  syntax: SyntaxStyle
  Action: (action: NotebookAction) => JSX.Element
  Evidence: (evidence: { evidence: Learning.Evidence[]; prefix: string }) => JSX.Element
  focusInput: () => void
  actions: () => void
  ref: (handle: NotebookHandle) => void
}) {
  const [filter, setFilter] = createSignal<"all" | Learning.Entry["kind"]>("all")
  const [selectedID, setSelectedID] = createSignal(props.entries[0]?.id)
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({})
  const rows = createMemo(() => props.entries.filter((entry) => filter() === "all" || entry.kind === filter()))
  const selected = createMemo(() => rows().find((entry) => entry.id === selectedID()))
  const wide = () => props.width >= 100
  const listWidth = () => (wide() ? Math.min(48, Math.floor(props.width * 0.43)) : props.width)
  const colours = () => ({ answer: props.theme.info, note: props.theme.success, goal: props.theme.warning })
  const labels = { answer: "Answer", note: "Note", goal: "Goal" }
  let root: BoxRenderable | undefined
  let pending = false
  let disposed = false

  function reveal() {
    if (pending) return
    pending = true
    queueMicrotask(() => {
      pending = false
      if (disposed || !root || root.isDestroyed || !selectedID()) return
      for (let parent = root.parent; parent; parent = parent.parent) {
        if (!(parent instanceof ScrollBoxRenderable)) continue
        parent.scrollChildIntoView(`notebook-entry-${selectedID()}`)
        return
      }
    })
  }

  function choose(id: string) {
    setSelectedID(id)
    props.focusInput()
    reveal()
  }

  props.ref({
    selected,
    move: (direction) => {
      if (!rows().length) return
      const current = rows().findIndex((entry) => entry.id === selectedID())
      choose(rows()[Math.max(0, Math.min(rows().length - 1, current + direction))].id)
    },
  })

  createEffect(() => {
    if (!rows().some((entry) => entry.id === selectedID())) setSelectedID(rows()[0]?.id)
    props.width
    reveal()
  })
  onCleanup(() => {
    disposed = true
  })

  function Detail() {
    return (
      <Show when={selected()}>
        {(entry) => (
          <box
            id="notebook-detail"
            flexGrow={1}
            minWidth={1}
            maxWidth={72}
            marginTop={wide() ? 0 : 1}
            marginBottom={wide() ? 0 : 1}
            paddingLeft={1}
            border={wide() ? ["left"] : ["top"]}
            borderColor={props.theme.border}
            title={wide() ? undefined : "Entry details"}
          >
            <text fg={colours()[entry().kind]}>
              <b>
                ●{" "}
                {entry().kind === "answer"
                  ? "Saved answer"
                  : entry().kind === "goal"
                    ? "Learning goal"
                    : "Personal note"}
              </b>
            </text>
            <text fg={props.theme.textMuted}>Saved {new Date(entry().created).toLocaleDateString()}</text>
            <markdown content={entry().text} syntaxStyle={props.syntax} streaming={false} />
            <Show when={entry().evidence?.length}>
              <box marginTop={1}>
                <props.Action
                  id="notebook-sources"
                  label={`Sources · ${entry().evidence!.length}`}
                  run={() => setExpanded((value) => ({ ...value, [entry().id]: !value[entry().id] }))}
                />
                <Show when={expanded()[entry().id]}>
                  <props.Evidence evidence={entry().evidence!} prefix={entry().id} />
                </Show>
              </box>
            </Show>
            <box marginTop={1}>
              <props.Action id="notebook-actions" label="Actions" run={props.actions} />
            </box>
          </box>
        )}
      </Show>
    )
  }

  return (
    <box id="notebook" ref={(value) => (root = value)} onSizeChange={reveal}>
      <box border={["bottom"]} borderColor={props.theme.borderSubtle} marginBottom={1}>
        <text fg={props.theme.text}>
          <b>Project notebook</b>
        </text>
        <box flexDirection="row" flexWrap="wrap" gap={1}>
          <For each={["all", "answer", "note", "goal"] as const}>
            {(kind) => (
              <props.Action
                id={`notebook-filter-${kind}`}
                label={`${kind === "all" ? "All" : `${labels[kind]}s`} · ${kind === "all" ? props.entries.length : props.entries.filter((entry) => entry.kind === kind).length}`}
                active={filter() === kind}
                run={() => {
                  setFilter(kind)
                  props.focusInput()
                  reveal()
                }}
              />
            )}
          </For>
        </box>
      </box>
      <Show
        when={rows().length}
        fallback={
          <box gap={1}>
            <text fg={props.theme.textMuted}>
              {filter() === "all"
                ? "Your notebook is empty"
                : `No ${labels[filter() as Learning.Entry["kind"]].toLowerCase()}s yet`}
            </text>
            <text fg={props.theme.textMuted} wrapMode="word">
              {filter() === "answer"
                ? "Save a useful explanation from Chat."
                : filter() === "goal"
                  ? "Add a goal below to guide what you want to learn."
                  : filter() === "note"
                    ? "Add a note below to remember what matters."
                    : "Save an answer from Chat, or add a note or goal below."}
            </text>
          </box>
        }
      >
        <box flexDirection={wide() ? "row" : "column"} gap={wide() ? 1 : 0}>
          <box id="notebook-list" width={wide() ? listWidth() : "100%"} flexShrink={0}>
            <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
              <text fg={props.theme.textMuted}>Entries</text>
              <text fg={props.theme.textMuted}>Saved</text>
            </box>
            <For each={rows()}>
              {(entry) => {
                const date = () => new Date(entry.created).toLocaleDateString()
                const title = () =>
                  (
                    entry.text
                      .split(/\r?\n/)
                      .find((line) => line.trim())
                      ?.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s*)/, "")
                      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
                      .replace(/[`*_~]/g, "")
                      .trim() || labels[entry.kind]
                  ).slice(0, Math.max(6, listWidth() - date().length - labels[entry.kind].length - 6))
                return (
                  <box id={`notebook-row-${entry.id}`}>
                    <props.Action
                      id={`notebook-entry-${entry.id}`}
                      label={`${labels[entry.kind]} ${title()}`.padEnd(Math.max(1, listWidth() - date().length - 5))}
                      hint={date()}
                      marker={colours()[entry.kind]}
                      fullWidth
                      active={selectedID() === entry.id}
                      run={() => choose(entry.id)}
                    />
                    <Show when={!wide() && selectedID() === entry.id}>
                      <Detail />
                    </Show>
                  </box>
                )
              }}
            </For>
          </box>
          <Show when={wide()}>
            <Detail />
          </Show>
        </box>
      </Show>
    </box>
  )
}
