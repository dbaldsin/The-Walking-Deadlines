import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, on, onMount, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../config"
import { useBindings } from "../../keymap"
import { isLearningSession } from "../../util/session"
import { createCompanion } from "./controller"

type Companion = ReturnType<typeof createCompanion>

export function CompanionOverlay(props: { api: TuiPluginApi; companion: Companion; sourceID: string }) {
  const dimensions = useTerminalDimensions()
  const { syntax } = useTheme()
  const config = useTuiConfig()
  const theme = () => props.api.theme.current
  const record = () => props.companion.records[props.sourceID]
  const [tab, setTab] = createSignal<"chat" | "notebook">("chat")
  const [selected, setSelected] = createSignal(0)
  const [editor, setEditor] = createSignal<"question" | "note" | "goal" | "steer">("question")
  const [proposal, setProposal] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [target, setTarget] = createSignal<TextareaRenderable>()
  const height = () => Math.max(8, Math.floor(dimensions().height * 0.75) - 2)
  let scroll: ScrollBoxRenderable | undefined
  const latest = () => record()?.turns.at(-1)
  const entry = () => record()?.entries[selected()]
  const status = () =>
    record()?.error
      ? "Error"
      : record()?.busy
        ? "Thinking"
        : record()?.paused
          ? "Paused"
          : record()?.topic
            ? "Topic ready"
            : "Following"
  const run = (work: Promise<unknown>) =>
    void work.catch((error: unknown) =>
      props.api.ui.toast({ variant: "error", message: error instanceof Error ? error.message : String(error) }),
    )
  const saved = (work: Promise<unknown>) =>
    run(work.then(() => props.api.ui.toast({ variant: "success", message: "Saved to notebook" })))

  function change(next: ReturnType<typeof editor>, value = "") {
    setEditor(next)
    const input = target()
    if (!input) return
    input.setText(value)
    input.focus()
  }

  function submit() {
    const input = target()
    if (!input?.plainText.trim()) return
    const text = input.plainText
    if (editor() === "steer") {
      run(props.companion.send(props.sourceID, text, proposal()))
      change("question")
      return
    }
    if (editor() === "note" || editor() === "goal") {
      if (saving()) return
      const mode = editor()
      setSaving(true)
      run(
        props.companion
          .add(props.sourceID, mode === "note" ? "note" : "goal", text)
          .then(() => {
            props.api.ui.toast({ variant: "success", message: "Saved to notebook" })
            if (editor() === mode && target()?.plainText === text) change("question")
          })
          .finally(() => setSaving(false)),
      )
      return
    }
    if (record()?.busy) return
    input.clear()
    run(props.companion.ask(props.sourceID, text))
  }

  function follow(action: string) {
    const turn = latest()
    if (!turn || record()?.busy) return
    run(
      props.companion.ask(
        props.sourceID,
        `${action}\nOriginal question: ${turn.question}\nPrevious explanation: ${turn.reply.explanation}`,
        turn,
      ),
    )
  }

  function steer() {
    const turn = latest()
    if (!turn?.reply.instruction) return
    setProposal(turn.id ?? `${props.sourceID}:${turn.version}:${turn.question}`)
    change("steer", turn.reply.instruction)
  }

  useBindings(() => ({
    target,
    enabled: !!target(),
    priority: 1000,
    bindings: [
      { key: "return", desc: "Ask / approve preview", cmd: submit },
      { key: "pageup", desc: "Scroll companion up", cmd: () => scroll?.scrollBy(-6) },
      { key: "pagedown", desc: "Scroll companion down", cmd: () => scroll?.scrollBy(6) },
      {
        key: "ctrl+n",
        desc: "Chat / Notebook",
        cmd: () => {
          setTab(tab() === "chat" ? "notebook" : "chat")
          change("question")
        },
      },
      { key: "ctrl+1", desc: "Simpler", cmd: () => follow("Explain this in simpler language.") },
      {
        key: "ctrl+2",
        desc: "Example",
        cmd: () => follow("Give one concrete project example with a short code snippet if useful."),
      },
      { key: "ctrl+3", desc: "More", cmd: () => follow("Explain more deeply; offer an optional understanding check.") },
      {
        key: "ctrl+s",
        desc: "Save answer",
        cmd: () => {
          if (latest()) saved(props.companion.save(props.sourceID, record().turns.length - 1))
        },
      },
      { key: "ctrl+k", desc: "Cancel companion answer", cmd: () => run(props.companion.cancel(props.sourceID)) },
      { key: "ctrl+p", desc: "Pause suggestions", cmd: () => props.companion.pause(props.sourceID, !record()?.paused) },
      {
        key: "ctrl+u",
        desc: "Update answer",
        cmd: () => {
          if (latest()) run(props.companion.ask(props.sourceID, latest()!.question))
        },
      },
      { key: "ctrl+g", desc: "Preview instruction", cmd: steer },
      {
        key: "alt+n",
        desc: "New note",
        cmd: () => {
          setTab("notebook")
          change("note")
        },
      },
      {
        key: "alt+g",
        desc: "New goal",
        cmd: () => {
          setTab("notebook")
          change("goal")
        },
      },
      { key: "alt+up", desc: "Previous notebook entry", cmd: () => setSelected(Math.max(0, selected() - 1)) },
      {
        key: "alt+down",
        desc: "Next notebook entry",
        cmd: () => setSelected(Math.min((record()?.entries.length ?? 1) - 1, selected() + 1)),
      },
      {
        key: "ctrl+d",
        desc: "Remove notebook entry",
        cmd: () => {
          if (tab() === "notebook" && entry()) run(props.companion.remove(props.sourceID, entry()!.id))
        },
      },
    ],
  }))

  onMount(() => {
    props.api.ui.dialog.setSize("xlarge")
    setTimeout(() => {
      const input = target()
      if (input && !input.isDestroyed) input.focus()
    }, 1)
    run(props.companion.load(props.sourceID))
  })
  createEffect(() => {
    const current = props.api.route.current
    if (current.name !== "session" || current.params?.sessionID !== props.sourceID) props.api.ui.dialog.clear()
  })

  return (
    <box height={height()} paddingLeft={1} paddingRight={1}>
      <box height={1} flexDirection="row" justifyContent="space-between">
        <text fg={theme().accent}>
          <b>● Learning companion · {status()}</b>
        </text>
        <text fg={theme().textMuted} onMouseUp={() => props.api.ui.dialog.clear()}>
          esc close
        </text>
      </box>
      <box height={1} flexDirection="row" gap={2}>
        <text
          fg={tab() === "chat" ? theme().accent : theme().textMuted}
          onMouseUp={() => {
            setTab("chat")
            change("question")
          }}
        >
          Chat
        </text>
        <text fg={tab() === "notebook" ? theme().accent : theme().textMuted} onMouseUp={() => setTab("notebook")}>
          Notebook (ctrl+n)
        </text>
        <text fg={theme().textMuted} onMouseUp={() => props.companion.pause(props.sourceID, !record()?.paused)}>
          {record()?.paused ? "Resume" : "Pause"}
        </text>
        <Show when={record()?.busy}>
          <text fg={theme().warning} onMouseUp={() => run(props.companion.cancel(props.sourceID))}>
            Cancel answer
          </text>
        </Show>
      </box>
      <scrollbox
        ref={(value) => {
          scroll = value
        }}
        height={Math.max(1, height() - 6 - (record()?.delivery ? 1 : 0) - (editor() === "steer" ? 2 : 0))}
        flexShrink={0}
        minHeight={1}
        stickyScroll={true}
        stickyStart="bottom"
      >
        <Show when={record()?.error}>
          <text fg={theme().error}>{record()?.error}</text>
        </Show>
        <Show
          when={tab() === "chat"}
          fallback={
            <box gap={1}>
              <text fg={theme().textMuted}>
                Saved answers stay unchanged. alt+n note · alt+g goal · alt+↑/↓ select · ctrl+d remove
              </text>
              <Show when={!record()?.entries.length}>
                <text fg={theme().textMuted}>Your project notebook is empty.</text>
              </Show>
              <For each={record()?.entries}>
                {(item, index) => (
                  <box onMouseDown={() => setSelected(index())}>
                    <text fg={selected() === index() ? theme().accent : theme().textMuted}>
                      {selected() === index() ? "▶ " : "  "}
                      {item.kind} · {new Date(item.created).toLocaleDateString()}
                    </text>
                    <markdown content={item.text} syntaxStyle={syntax()} streaming={false} />
                    <For each={item.evidence}>{(e) => <text fg={theme().textMuted}>{e.label}</text>}</For>
                    <text fg={theme().warning} onMouseUp={() => run(props.companion.remove(props.sourceID, item.id))}>
                      Remove
                    </text>
                  </box>
                )}
              </For>
              <box flexDirection="row" gap={2}>
                <text fg={theme().accent} onMouseUp={() => change("note")}>
                  Add note
                </text>
                <text fg={theme().accent} onMouseUp={() => change("goal")}>
                  Add goal
                </text>
              </box>
            </box>
          }
        >
          <Show when={!record()?.turns.length}>
            <text fg={theme().textMuted}>
              Ask about a change, a test result, or a project concept. Coding can continue while we talk.
            </text>
          </Show>
          <For each={record()?.turns}>
            {(turn) => (
              <box marginBottom={1}>
                <text fg={theme().accent}>You: {turn.question}</text>
                <markdown content={turn.reply.explanation} syntaxStyle={syntax()} streaming={false} />
                <For each={turn.evidence.filter((e) => turn.reply.evidence.includes(e.id))}>
                  {(e) => (
                    <text fg={theme().textMuted}>
                      [{turn.evidence.indexOf(e) + 1}] {e.kind === "current" ? `Current lookup · ${e.label}` : e.label}
                    </text>
                  )}
                </For>
                <Show when={turn.reply.notes.length}>
                  <text fg={theme().textMuted}>
                    Influenced by saved notes:{" "}
                    {turn.notes
                      .filter((n) => turn.reply.notes.includes(n.id))
                      .map((n) => n.text.slice(0, 70))
                      .join("; ")}
                  </text>
                </Show>
              </box>
            )}
          </For>
          <Show when={record()?.topic}>
            <text
              fg={theme().accent}
              onMouseUp={() => {
                const topic = record()?.topic
                props.companion.dismiss(props.sourceID)
                if (topic) run(props.companion.ask(props.sourceID, topic))
              }}
            >
              Topic: {record()?.topic} (select to ask)
            </text>
            <text fg={theme().textMuted} onMouseUp={() => props.companion.dismiss(props.sourceID)}>
              Dismiss topic
            </text>
          </Show>
          <Show when={latest() && latest()!.version !== record()?.version}>
            <text fg={theme().warning} onMouseUp={() => run(props.companion.ask(props.sourceID, latest()!.question))}>
              Newer changes available · Update (ctrl+u)
            </text>
          </Show>
          <Show when={latest()}>
            <box flexDirection="row" gap={2} flexWrap="wrap">
              <text fg={theme().accent} onMouseUp={() => follow("Explain this in simpler language.")}>
                Simpler ^1
              </text>
              <text fg={theme().accent} onMouseUp={() => follow("Give one concrete project example.")}>
                Example ^2
              </text>
              <text
                fg={theme().accent}
                onMouseUp={() => follow("Explain more deeply; offer an optional understanding check.")}
              >
                More ^3
              </text>
              <text
                fg={theme().accent}
                onMouseUp={() => saved(props.companion.save(props.sourceID, record().turns.length - 1))}
              >
                Save ^s
              </text>
              <Show when={latest()?.reply.instruction}>
                <text fg={theme().accent} onMouseUp={steer}>
                  Send to coding agent ^g
                </text>
              </Show>
            </box>
          </Show>
        </Show>
      </scrollbox>
      <Show when={record()?.delivery}>
        <box height={1} flexDirection="row" gap={1}>
          <text fg={record()?.delivery?.status === "sent" ? theme().success : theme().warning}>
            Instruction: {record()?.delivery?.status === "sent" ? "Sent" : record()?.delivery?.status}
          </text>
          <Show when={record()?.delivery?.status !== "sent"}>
            <text fg={theme().accent} onMouseUp={() => run(props.companion.checkDelivery(props.sourceID))}>
              Check delivery
            </text>
          </Show>
        </box>
      </Show>
      <Show when={editor() === "steer"}>
        <text height={2} fg={theme().warning}>
          Destination: {props.api.state.session.get(props.sourceID)?.title ?? props.sourceID} · {props.sourceID}
        </text>
      </Show>
      <textarea
        ref={setTarget}
        height={3}
        flexShrink={0}
        backgroundColor={theme().backgroundElement}
        focusedBackgroundColor={theme().backgroundElement}
        placeholder={
          editor() === "question"
            ? "Ask a project question…"
            : editor() === "steer"
              ? "Edit the exact instruction. Enter approves sending."
              : `Write a ${editor()}…`
        }
        textColor={theme().text}
        focusedTextColor={theme().text}
        placeholderColor={theme().textMuted}
        cursorColor={theme().accent}
        cursorStyle={config.cursor}
      />
      <text fg={theme().textMuted}>
        {saving()
          ? "Saving…"
          : editor() === "steer"
            ? "Enter: Approve and send · select Chat to discard preview"
            : editor() === "question"
              ? "Enter ask · shift+enter newline · pg↑/↓ scroll · ^k cancel"
              : "Enter: Save to notebook"}
      </text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  const companion = createCompanion(api)
  function open(sourceID: string) {
    if (isLearningSession(api.state.session.get(sourceID))) return
    api.ui.dialog.replace(() => <CompanionOverlay api={api} companion={companion} sourceID={sourceID} />)
  }
  api.keymap.registerLayer({
    commands: [
      {
        name: "learning.open",
        title: "Open learning companion",
        slashName: "learn",
        namespace: "palette",
        category: "Session",
        run() {
          const route = api.route.current
          if (route.name === "session" && typeof route.params?.sessionID === "string") open(route.params.sessionID)
          else api.ui.toast({ message: "Start a coding session first", variant: "info" })
        },
      },
    ],
  })

  function Card(props: { sourceID: string; compact?: boolean }) {
    const state = createMemo(() => companion.records[props.sourceID])
    createEffect(
      on(
        () => props.sourceID,
        (sourceID) => void companion.load(sourceID).catch(() => undefined),
      ),
    )
    const status = () =>
      state()?.error
        ? "Error"
        : state()?.busy
          ? "Thinking"
          : state()?.paused
            ? "Paused"
            : state()?.topic
              ? "Topic ready"
              : "Following"
    return (
      <Show when={!isLearningSession(api.state.session.get(props.sourceID))}>
        <box onMouseDown={() => open(props.sourceID)}>
          <text fg={api.theme.current.accent}>
            <b>● {props.compact ? "Learn" : "Learning companion"}</b> · {status()}
          </text>
          <Show when={!props.compact}>
            <text fg={api.theme.current.textMuted}>{state()?.topic ?? "Understand this project · /learn"}</text>
          </Show>
        </box>
      </Show>
    )
  }
  function Indicator(props: { sourceID: string }) {
    const size = useTerminalDimensions()
    return (
      <Show when={size().width <= 120}>
        <Card sourceID={props.sourceID} compact />
      </Show>
    )
  }
  api.slots.register({
    order: 150,
    slots: {
      sidebar_content(_context, props) {
        return <Card sourceID={props.session_id} />
      },
      session_prompt_right(_context, props) {
        return <Indicator sourceID={props.session_id} />
      },
    },
  })
}

export default { id: "internal:learning-companion", tui }
