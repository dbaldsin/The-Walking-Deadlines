import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { BoxRenderable, MouseButton, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { selectedForeground, useTheme } from "../../context/theme"
import { useTuiConfig } from "../../config"
import { useBindings } from "../../keymap"
import { isLearningSession } from "../../util/session"
import { createCompanion } from "./controller"
import { Learning } from "./data"

type Companion = ReturnType<typeof createCompanion>

export function CompanionOverlay(props: { api: TuiPluginApi; companion: Companion; sourceID: string }) {
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const localTheme = useTheme()
  const config = useTuiConfig()
  const theme = () => props.api.theme.current
  const record = () => props.companion.records[props.sourceID]
  const [tab, setTab] = createSignal<"chat" | "notebook">("chat")
  const [selected, setSelected] = createSignal(0)
  const [editor, setEditor] = createSignal<"question" | "note" | "goal" | "steer">("question")
  const [proposal, setProposal] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [visible, setVisible] = createSignal(10)
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({})
  const [focused, setFocused] = createSignal("learning-input")
  const [target, setTarget] = createSignal<TextareaRenderable>()
  const [root, setRoot] = createSignal<BoxRenderable>()
  const controls = new Map<string, { node: BoxRenderable; run: () => void; disabled: () => boolean }>()
  const width = () => Math.min(112, dimensions().width - 4)
  const wide = () => width() >= 100
  const latest = () => record()?.turns.at(-1)
  const entry = () => record()?.entries[selected()]
  const source = () => props.api.state.session.get(props.sourceID)
  const project = () => source()?.directory?.split(/[\\/]/).filter(Boolean).at(-1) ?? "Project"
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
  const tone = () =>
    record()?.error
      ? theme().error
      : record()?.busy
        ? theme().warning
        : record()?.paused
          ? theme().textMuted
          : theme().accent
  const blocked = () => !latest() || record()?.busy || editor() !== "question" || tab() !== "chat"
  let scroll: ScrollBoxRenderable | undefined
  let draft = ""
  const run = (work: Promise<unknown>) =>
    void work.catch((error: unknown) =>
      props.api.ui.toast({ variant: "error", message: error instanceof Error ? error.message : String(error) }),
    )
  const saved = (work: Promise<unknown>) =>
    run(work.then(() => props.api.ui.toast({ variant: "success", message: "Saved to notebook" })))
  const toggle = (id: string) => setExpanded((value) => ({ ...value, [id]: !value[id] }))

  function Action(action: {
    id: string
    label: string
    hint?: string
    run: () => void
    disabled?: boolean
    active?: boolean
  }) {
    let node: BoxRenderable | undefined
    let pressed = false
    onCleanup(() => {
      if (controls.get(action.id)?.node === node) controls.delete(action.id)
    })
    return (
      <box
        id={action.id}
        ref={(value) => {
          node = value
          value.focusable = true
          controls.set(action.id, {
            node: value,
            run: () => {
              if (!action.disabled) action.run()
            },
            disabled: () => !!action.disabled,
          })
        }}
        height={1}
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={focused() === action.id || action.active ? theme().primary : theme().backgroundElement}
        on:focused={() => setFocused(action.id)}
        onMouseDown={(event) => {
          pressed = event.button === MouseButton.LEFT
          node?.focus()
        }}
        onMouseUp={(event) => {
          if (!pressed || renderer.getSelection()?.getSelectedText()) return
          pressed = false
          event.stopPropagation()
          if (!action.disabled) action.run()
        }}
      >
        <text
          fg={
            action.disabled
              ? theme().textMuted
              : focused() === action.id || action.active
                ? selectedForeground(localTheme.theme)
                : theme().text
          }
        >
          <b>{action.label}</b>
          <Show when={action.hint}>
            <span
              style={{
                fg: focused() === action.id || action.active ? selectedForeground(localTheme.theme) : theme().textMuted,
              }}
            >
              {" "}
              {action.hint}
            </span>
          </Show>
        </text>
      </box>
    )
  }

  function change(next: ReturnType<typeof editor>, value = "") {
    if (editor() === "question" && next !== "question") draft = target()?.plainText ?? ""
    setEditor(next)
    target()?.setText(value)
    target()?.focus()
  }
  function back() {
    change("question", draft)
  }
  function switchTab(next: ReturnType<typeof tab>) {
    if (editor() !== "question") back()
    setTab(next)
    target()?.focus()
  }
  function submit() {
    const input = target()
    if (!input?.plainText.trim()) return
    const text = input.plainText
    if (editor() === "steer") {
      run(props.companion.send(props.sourceID, text, proposal()))
      back()
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
            if (editor() === mode && target()?.plainText === text) back()
          })
          .finally(() => setSaving(false)),
      )
      return
    }
    if (record()?.busy) return
    input.clear()
    setTab("chat")
    run(props.companion.ask(props.sourceID, text))
  }
  function follow(kind: "simpler" | "example" | "more") {
    const turn = latest()
    if (!turn || blocked()) return
    const action =
      kind === "simpler"
        ? "Explain this in simpler language."
        : kind === "example"
          ? "Give one concrete project example with a short code snippet if useful."
          : "Explain more deeply; offer an optional understanding check."
    const label =
      kind === "simpler" ? "Simpler explanation" : kind === "example" ? "Project example" : "Deeper explanation"
    run(
      props.companion.ask(
        props.sourceID,
        `${action}\nOriginal question: ${turn.question}\nPrevious explanation: ${turn.reply.explanation}`,
        turn,
        { kind, label },
      ),
    )
    target()?.focus()
  }
  function update() {
    if (blocked()) return
    run(
      props.companion.ask(props.sourceID, latest()!.question, undefined, {
        kind: "update",
        label: "Updated explanation",
      }),
    )
    target()?.focus()
  }
  function steer() {
    if (blocked() || !latest()?.reply.instruction) return
    setProposal(latest()!.id ?? `${props.sourceID}:${latest()!.version}:${latest()!.question}`)
    change("steer", latest()!.reply.instruction)
  }
  function page(direction: number) {
    if (editor() !== "steer") {
      if (scroll && !scroll.isDestroyed) scroll.scrollBy(direction * 6)
      return
    }
    const input = target()
    if (!input || input.isDestroyed) return
    input.focus()
    const viewport = input.editorView.getViewport()
    input.editorView.setViewport(
      viewport.offsetX,
      Math.max(
        0,
        Math.min(
          input.editorView.getTotalVirtualLineCount() - viewport.height,
          viewport.offsetY + direction * Math.max(1, viewport.height - 1),
        ),
      ),
      viewport.width,
      viewport.height,
      true,
    )
    input.requestRender()
  }
  function focusNext(direction: number) {
    const body = root()
    if (!body) return
    const items = [...controls.values()]
      .filter((item) => {
        if (item.node.isDestroyed || !item.node.visible || item.disabled()) return false
        const bounds = [body]
        for (let parent = item.node.parent; parent; parent = parent.parent) {
          if (scroll && parent === scroll.viewport) bounds.push(scroll.viewport)
        }
        return bounds.every(
          (bound) =>
            item.node.y >= bound.y &&
            item.node.y + item.node.height <= bound.y + bound.height &&
            item.node.x < bound.x + bound.width &&
            item.node.x + item.node.width > bound.x,
        )
      })
      .map((item) => item.node as BoxRenderable | TextareaRenderable)
    if (target()) items.push(target()!)
    items.sort((a, b) => a.y - b.y || a.x - b.x)
    const current = items.indexOf(renderer.currentFocusedRenderable as BoxRenderable | TextareaRenderable)
    items[(current + direction + items.length) % items.length]?.focus()
  }
  function enter() {
    const current = renderer.currentFocusedRenderable
    if (current === target()) {
      submit()
      return
    }
    if (current) controls.get(current.id)?.run()
  }
  const bindings = () => ({
    enabled: !!root(),
    priority: 1000,
    bindings: [
      { key: "return", desc: "Ask / activate button / approve preview", cmd: enter },
      { key: "tab", desc: "Next companion control", cmd: () => focusNext(1) },
      { key: "shift+tab", desc: "Previous companion control", cmd: () => focusNext(-1) },
      ...(focused() !== "learning-input" ? [{ key: "space", desc: "Activate companion button", cmd: enter }] : []),
      { key: "pageup", desc: "Scroll companion up", cmd: () => page(-1) },
      { key: "pagedown", desc: "Scroll companion down", cmd: () => page(1) },
      { key: "ctrl+n", desc: "Chat / Notebook", cmd: () => switchTab(tab() === "chat" ? "notebook" : "chat") },
      { key: "ctrl+1", desc: "Simpler", cmd: () => follow("simpler") },
      { key: "ctrl+2", desc: "Example", cmd: () => follow("example") },
      { key: "ctrl+3", desc: "More", cmd: () => follow("more") },
      {
        key: "ctrl+s",
        desc: "Save answer",
        cmd: () => {
          if (!blocked()) saved(props.companion.save(props.sourceID, record().turns.length - 1))
        },
      },
      { key: "ctrl+k", desc: "Cancel companion answer", cmd: () => run(props.companion.cancel(props.sourceID)) },
      { key: "ctrl+p", desc: "Pause suggestions", cmd: () => props.companion.pause(props.sourceID, !record()?.paused) },
      { key: "ctrl+u", desc: "Update answer", cmd: update },
      { key: "ctrl+g", desc: "Preview instruction", cmd: steer },
      {
        key: "alt+n",
        desc: "New note",
        cmd: () => {
          if (editor() === "steer") back()
          setTab("notebook")
          change("note")
        },
      },
      {
        key: "alt+g",
        desc: "New goal",
        cmd: () => {
          if (editor() === "steer") back()
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
  })
  useBindings(() => ({ ...bindings(), target: root }))
  onMount(() => {
    props.api.ui.dialog.setSize("fullscreen")
    setTimeout(() => {
      if (target() && !target()!.isDestroyed) target()!.focus()
    }, 1)
    run(props.companion.load(props.sourceID))
  })
  createEffect(() => {
    const current = props.api.route.current
    if (current.name !== "session" || current.params?.sessionID !== props.sourceID) props.api.ui.dialog.clear()
  })
  createEffect(() => {
    if (selected() >= (record()?.entries.length ?? 0)) setSelected(Math.max(0, (record()?.entries.length ?? 1) - 1))
  })

  function Evidence(props: { evidence: Learning.Evidence[]; prefix: string }) {
    return (
      <For each={props.evidence}>
        {(item, index) => (
          <box marginTop={1} maxWidth={84}>
            <Action
              id={`evidence-${props.prefix}-${item.id}`}
              label={`${index() + 1}. ${Learning.sourceLabel(item)}`}
              run={() => toggle(`${props.prefix}:${item.id}`)}
            />
            <Show when={expanded()[`${props.prefix}:${item.id}`]}>
              <text fg={theme().textMuted} wrapMode="char">
                Reference: {item.id}
              </text>
              <text fg={theme().text} wrapMode="char">
                {item.text}
              </text>
            </Show>
          </box>
        )}
      </For>
    )
  }
  function Answer(answer: { turn: Learning.Turn }) {
    const id = () => answer.turn.id ?? `${answer.turn.version}:${answer.turn.question}`
    const evidence = createMemo(() =>
      answer.turn.evidence.filter((item) => answer.turn.reply.evidence.includes(item.id)),
    )
    const notes = createMemo(() => answer.turn.notes.filter((item) => answer.turn.reply.notes.includes(item.id)))
    return (
      <box id={`answer-${id()}`} marginBottom={2} maxWidth={84}>
        <box paddingLeft={1} backgroundColor={theme().backgroundElement} marginBottom={1}>
          <text fg={theme().textMuted}>
            <b>You</b>
          </text>
          <text fg={theme().text} wrapMode="word">
            {Learning.question(answer.turn)}
          </text>
        </box>
        <box paddingLeft={1}>
          <text fg={theme().accent}>
            <b>● Companion</b>
          </text>
          <markdown content={answer.turn.reply.explanation} syntaxStyle={localTheme.syntax()} streaming={false} />
          <box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
            <Show when={evidence().length}>
              <Action
                id={`sources-${id()}`}
                label={`Sources · ${evidence().length}`}
                run={() => toggle(`sources:${id()}`)}
              />
            </Show>
            <Show when={notes().length}>
              <Action
                id={`notes-${id()}`}
                label={`Notes used · ${notes().length}`}
                run={() => toggle(`notes:${id()}`)}
              />
            </Show>
          </box>
          <Show when={expanded()[`sources:${id()}`]}>
            <Evidence evidence={evidence()} prefix={id()} />
          </Show>
          <Show when={expanded()[`notes:${id()}`]}>
            <box marginTop={1}>
              <For each={notes()}>
                {(item) => (
                  <text fg={theme().textMuted} wrapMode="word">
                    {item.kind}: {item.text}
                  </text>
                )}
              </For>
            </box>
          </Show>
        </box>
      </box>
    )
  }
  function NotebookDetail() {
    return (
      <box id="notebook-detail" flexGrow={1} minWidth={1} maxWidth={84}>
        <text fg={theme().accent}>
          <b>
            {entry()!.kind === "answer" ? "Saved answer" : entry()!.kind === "goal" ? "Learning goal" : "Personal note"}
          </b>
        </text>
        <markdown content={entry()!.text} syntaxStyle={localTheme.syntax()} streaming={false} />
        <Show when={entry()?.evidence?.length}>
          <box marginTop={1}>
            <Action
              id="notebook-sources"
              label={`Sources · ${entry()!.evidence!.length}`}
              run={() => toggle(`notebook:${entry()!.id}`)}
            />
            <Show when={expanded()[`notebook:${entry()!.id}`]}>
              <Evidence evidence={entry()!.evidence!} prefix={entry()!.id} />
            </Show>
          </box>
        </Show>
        <box marginTop={1}>
          <Action
            id="notebook-remove"
            label="Remove entry"
            hint="Ctrl+D"
            run={() => run(props.companion.remove(props.sourceID, entry()!.id))}
          />
        </box>
      </box>
    )
  }
  function Notebook() {
    return (
      <box flexDirection={wide() ? "row" : "column"} gap={2}>
        <box width={wide() ? 26 : "100%"} flexShrink={0} gap={1}>
          <text fg={theme().textMuted}>Your project notebook</text>
          <Show when={!record()?.entries.length}>
            <text fg={theme().textMuted}>Save an answer, note, or goal.</text>
          </Show>
          <For each={record()?.entries}>
            {(item, index) => (
              <box id={`notebook-row-${item.id}`}>
                <Action
                  id={`notebook-entry-${item.id}`}
                  label={`${item.kind === "answer" ? "Answer" : item.kind === "goal" ? "Goal" : "Note"} · ${new Date(item.created).toLocaleDateString()}`}
                  active={selected() === index()}
                  run={() => {
                    setSelected(index())
                    target()?.focus()
                  }}
                />
                <text fg={theme().textMuted} wrapMode="none">
                  {item.text.split("\n")[0].slice(0, wide() ? 24 : width() - 2)}
                </text>
                <Show when={!wide() && selected() === index()}>
                  <NotebookDetail />
                </Show>
              </box>
            )}
          </For>
        </box>
        <Show when={wide() && entry()}>
          <NotebookDetail />
        </Show>
      </box>
    )
  }

  return (
    <box
      ref={setRoot}
      id="learning-overlay"
      width={dimensions().width - 2}
      height={Math.max(8, dimensions().height - 2)}
      paddingLeft={1}
      paddingRight={1}
      alignItems="center"
    >
      <box width="100%" maxWidth={112} height="100%">
        <box flexDirection="row" height={1} flexShrink={0} justifyContent="space-between">
          <text fg={theme().accent}>
            <b>● Learning companion</b>
            <span style={{ fg: theme().textMuted }}> · {project().slice(0, width() < 100 ? 14 : 28)}</span>
          </text>
          <box flexDirection="row" gap={1}>
            <text fg={tone()}>
              <b>{status()}</b>
            </text>
            <Action id="learning-close" label="Close" hint="Esc" run={() => props.api.ui.dialog.clear()} />
          </box>
        </box>
        <box flexDirection="row" flexWrap="wrap" gap={1} marginBottom={1} flexShrink={0}>
          <Action
            id="learning-chat"
            label="Chat"
            active={tab() === "chat" && editor() !== "steer"}
            run={() => switchTab("chat")}
          />
          <Action
            id="learning-notebook"
            label="Notebook"
            hint="Ctrl+N"
            active={tab() === "notebook" && editor() !== "steer"}
            run={() => switchTab("notebook")}
          />
          <Action
            id="learning-pause"
            label={record()?.paused ? "Resume" : "Pause"}
            run={() => props.companion.pause(props.sourceID, !record()?.paused)}
          />
          <Show when={record()?.busy}>
            <Action
              id="learning-cancel"
              label="Cancel answer"
              hint="Ctrl+K"
              run={() => run(props.companion.cancel(props.sourceID))}
            />
          </Show>
        </box>
        <Show when={record()?.error}>
          <box backgroundColor={theme().backgroundElement} paddingLeft={1} flexShrink={0} maxHeight={2}>
            <text fg={theme().error} wrapMode="word">
              {record()?.error}
            </text>
          </box>
        </Show>
        <Show
          when={editor() !== "steer"}
          fallback={
            <box flexShrink={0} marginBottom={1}>
              <text fg={theme().accent}>
                <b>Send to coding agent</b>
              </text>
              <text fg={theme().text} wrapMode="char">
                Destination: {source()?.title ?? "Coding session"}
              </text>
              <text fg={theme().textMuted} wrapMode="char">
                Session: {props.sourceID}
              </text>
              <text fg={theme().textMuted}>Edit the exact instruction below. Sending requires your approval.</text>
            </box>
          }
        >
          <scrollbox
            id="learning-body"
            ref={(value) => {
              scroll = value
            }}
            flexGrow={1}
            flexShrink={1}
            minHeight={1}
            stickyScroll={true}
            stickyStart="bottom"
          >
            <Show when={tab() === "chat"} fallback={<Notebook />}>
              <Show when={!record()?.turns.length && !record()?.busy}>
                <box gap={1} maxWidth={84}>
                  <text fg={theme().accent}>
                    <b>Understand what you're building.</b>
                  </text>
                  <text fg={theme().textMuted}>
                    Ask about a completed change, test, or project concept. Coding can continue.
                  </text>
                  <For
                    each={[
                      "Explain the last completed change.",
                      "Help me understand the last test result.",
                      "Suggest one small improvement.",
                    ]}
                  >
                    {(question, index) => (
                      <Action
                        id={`learning-starter-${index()}`}
                        label={question}
                        run={() => change("question", question)}
                      />
                    )}
                  </For>
                </box>
              </Show>
              <Show when={(record()?.turns.length ?? 0) > visible()}>
                <box marginBottom={1}>
                  <Action
                    id="learning-history"
                    label={`Show earlier answers · ${(record()?.turns.length ?? 0) - visible()}`}
                    run={() => setVisible(Math.min(30, visible() + 10))}
                  />
                </box>
              </Show>
              <For each={record()?.turns.slice(-visible())}>{(turn) => <Answer turn={turn} />}</For>
              <Show when={record()?.busy}>
                <box marginBottom={1} maxWidth={84} paddingLeft={1} backgroundColor={theme().backgroundElement}>
                  <text fg={theme().textMuted}>
                    <b>You</b>
                  </text>
                  <text fg={theme().text} wrapMode="word">
                    {record()?.pending?.label ?? "Follow-up question"}
                  </text>
                  <text fg={theme().warning}>● Thinking… You can keep coding.</text>
                </box>
              </Show>
              <Show when={record()?.topic}>
                <box marginBottom={1} maxWidth={84}>
                  <text fg={theme().accent}>
                    <b>A topic to explore</b>
                  </text>
                  <text wrapMode="word" fg={theme().text}>
                    {record()?.topic}
                  </text>
                  <box flexDirection="row" gap={1}>
                    <Action
                      id="learning-topic"
                      label="Explore topic"
                      disabled={record()?.busy}
                      run={() => {
                        const topic = record()?.topic
                        if (topic) {
                          props.companion.dismiss(props.sourceID)
                          change("question", topic)
                        }
                      }}
                    />
                    <Action id="learning-dismiss" label="Dismiss" run={() => props.companion.dismiss(props.sourceID)} />
                  </box>
                </box>
              </Show>
            </Show>
          </scrollbox>
          <Show when={tab() === "chat" && latest() && latest()!.version !== record()?.version}>
            <box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
              <text fg={theme().warning}>Newer changes available</text>
              <Action id="learning-update" label="Update" hint="Ctrl+U" disabled={blocked()} run={update} />
            </box>
          </Show>
          <Show when={tab() === "chat" && latest()}>
            <box flexShrink={0}>
              <text fg={theme().textMuted}>Latest answer</text>
              <box flexDirection="row" flexWrap="wrap" gap={1}>
                <Action
                  id="learning-simpler"
                  label="Simpler"
                  hint="Ctrl+1"
                  disabled={blocked()}
                  run={() => follow("simpler")}
                />
                <Action
                  id="learning-example"
                  label="Example"
                  hint="Ctrl+2"
                  disabled={blocked()}
                  run={() => follow("example")}
                />
                <Action id="learning-more" label="More" hint="Ctrl+3" disabled={blocked()} run={() => follow("more")} />
                <Action
                  id="learning-save"
                  label="Save"
                  hint="Ctrl+S"
                  disabled={blocked()}
                  run={() => saved(props.companion.save(props.sourceID, record().turns.length - 1))}
                />
                <Show when={latest()?.reply.instruction}>
                  <Action
                    id="learning-send"
                    label="Send to coding agent"
                    hint="Ctrl+G"
                    disabled={blocked()}
                    run={steer}
                  />
                </Show>
              </box>
            </box>
          </Show>
          <Show when={tab() === "notebook"}>
            <box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
              <Action
                id="learning-add-note"
                label="Add note"
                hint="Alt+N"
                disabled={saving()}
                run={() => change("note")}
              />
              <Action
                id="learning-add-goal"
                label="Add goal"
                hint="Alt+G"
                disabled={saving()}
                run={() => change("goal")}
              />
            </box>
          </Show>
        </Show>
        <Show when={record()?.delivery}>
          <box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
            <text fg={record()?.delivery?.status === "sent" ? theme().success : theme().warning}>
              <b>
                {record()?.delivery?.status === "sent"
                  ? "Sent"
                  : record()?.delivery?.status === "failed"
                    ? "Failed"
                    : record()?.delivery?.status === "sending"
                      ? "Sending…"
                      : "Uncertain"}
              </b>
            </text>
            <Show when={record()?.delivery?.status !== "sent"}>
              <Action
                id="learning-check-delivery"
                label="Check delivery"
                run={() => run(props.companion.checkDelivery(props.sourceID))}
              />
            </Show>
          </box>
        </Show>
        <box
          flexDirection="row"
          flexShrink={editor() === "steer" ? 1 : 0}
          flexGrow={editor() === "steer" ? 1 : 0}
          minHeight={3}
          backgroundColor={theme().backgroundElement}
        >
          <textarea
            id="learning-input"
            ref={setTarget}
            on:focused={() => setFocused("learning-input")}
            height={editor() === "steer" ? "100%" : 3}
            flexGrow={1}
            minWidth={1}
            backgroundColor={theme().backgroundElement}
            focusedBackgroundColor={theme().backgroundElement}
            placeholder={
              editor() === "question"
                ? "Ask about this project…"
                : editor() === "steer"
                  ? "Edit the instruction…"
                  : `Write a ${editor()}…`
            }
            textColor={theme().text}
            focusedTextColor={theme().text}
            placeholderColor={theme().textMuted}
            cursorColor={theme().accent}
            cursorStyle={config.cursor}
          />
          <Show when={editor() !== "steer"}>
            <box alignSelf="flex-end">
              <Action
                id="learning-ask"
                label={editor() === "question" ? "Ask" : "Save"}
                disabled={editor() === "question" ? record()?.busy : saving()}
                run={submit}
              />
            </box>
          </Show>
        </box>
        <Show when={editor() === "steer"}>
          <box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
            <Action id="learning-back" label="Back" run={back} />
            <Action id="learning-approve" label="Approve and send" hint="Enter" run={submit} />
          </box>
        </Show>
        <text fg={theme().textMuted} flexShrink={0}>
          {saving()
            ? "Saving…"
            : editor() === "steer"
              ? "Enter approves · PgUp/PgDn pages · Back keeps draft · Esc closes"
              : editor() === "question"
                ? "Enter ask · Shift+Enter newline · Tab buttons · PgUp/PgDn scroll"
                : "Enter saves · Tab buttons · Ctrl+N chat / notebook"}
        </text>
      </box>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  const companion = createCompanion(api)
  function open(sourceID: string) {
    if (isLearningSession(api.state.session.get(sourceID))) return
    api.ui.dialog.replace(() => <CompanionOverlay api={api} companion={companion} sourceID={sourceID} />)
    api.ui.dialog.setSize("fullscreen")
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
        <box
          backgroundColor={props.compact ? undefined : api.theme.current.backgroundElement}
          paddingLeft={props.compact ? 0 : 1}
          paddingRight={props.compact ? 0 : 1}
          marginBottom={props.compact ? 0 : 1}
          onMouseDown={() => open(props.sourceID)}
        >
          <text fg={api.theme.current.accent}>
            <b>● {props.compact ? "Learn" : "Learning companion"}</b>
            <span style={{ fg: api.theme.current.textMuted }}> · {status()}</span>
          </text>
          <Show when={!props.compact}>
            <text fg={api.theme.current.textMuted} wrapMode="word">
              {state()?.topic ?? "Understand your project's changes."}
            </text>
            <text fg={api.theme.current.text}>
              Open chat <span style={{ fg: api.theme.current.textMuted }}>/learn</span>
            </text>
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
