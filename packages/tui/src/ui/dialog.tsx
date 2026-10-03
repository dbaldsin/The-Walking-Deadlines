import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { batch, createContext, createEffect, onCleanup, Show, useContext, type JSX, type ParentProps } from "solid-js"
import { useTheme } from "../context/theme"
import { MouseButton, Renderable, RGBA } from "@opentui/core"
import { createStore } from "solid-js/store"
import { useToast } from "./toast"
import { Flag } from "@opencode-ai/core/flag/flag"
import { useBindings, useOpencodeModeStack } from "../keymap"
import { useClipboard } from "../context/clipboard"

export function dialogSplitWidth(width: number) {
  return width >= 128 ? Math.min(86, Math.floor((width - 2) * 0.46)) : 0
}

export function Dialog(
  props: ParentProps<{
    size?: "medium" | "large" | "xlarge" | "fullscreen" | "split"
    onClose: () => void
    onFocus?: () => void
    active?: boolean
  }>,
) {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const renderer = useRenderer()

  let dismiss = false
  const split = () => props.size === "split" && dialogSplitWidth(dimensions().width) > 0
  const full = () => props.size === "fullscreen" || props.size === "split"
  const width = () => {
    if (split()) return dialogSplitWidth(dimensions().width)
    if (full()) return dimensions().width - 2
    if (props.size === "xlarge") return 116
    if (props.size === "large") return 88
    return 60
  }

  return (
    <box
      onMouseDown={() => {
        dismiss = !!renderer.getSelection()
      }}
      onMouseUp={() => {
        if (dismiss) {
          dismiss = false
          return
        }
        props.onClose?.()
      }}
      width={split() ? width() : dimensions().width}
      height={split() ? dimensions().height - 2 : dimensions().height}
      alignItems="center"
      position="absolute"
      zIndex={3000}
      paddingTop={split() ? 0 : full() ? 1 : dimensions().height / 4}
      left={split() ? dimensions().width - width() - 1 : 0}
      top={split() ? 1 : 0}
      backgroundColor={split() ? undefined : RGBA.fromInts(0, 0, 0, 150)}
    >
      <box
        onMouseDown={() => props.onFocus?.()}
        onMouseUp={(e: { stopPropagation(): void }) => {
          // A selection release must bubble up to the copy-on-select handler in
          // DialogProvider; the backdrop's dismiss flag keeps it from closing the dialog.
          if (renderer.getSelection()?.getSelectedText()) return
          dismiss = false
          e.stopPropagation()
        }}
        width={width()}
        height={full() ? dimensions().height - 2 : undefined}
        maxWidth={dimensions().width - 2}
        backgroundColor={theme.backgroundPanel}
        paddingTop={full() ? 0 : 1}
        border={split() ? ["left"] : []}
        borderColor={props.active === false ? theme.borderSubtle : theme.borderActive}
      >
        {props.children}
      </box>
    </box>
  )
}

function init() {
  const [store, setStore] = createStore({
    stack: [] as {
      element: JSX.Element
      onClose?: () => void
    }[],
    size: "medium" as "medium" | "large" | "xlarge" | "fullscreen" | "split",
    focused: true,
  })

  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const modeStack = useOpencodeModeStack()
  const splitWidth = () => {
    const width = dialogSplitWidth(dimensions().width)
    return store.stack.length && store.size === "split" && width ? width + 1 : 0
  }
  const blocking = () => !!store.stack.length && (!splitWidth() || store.focused)

  createEffect(() => {
    if (!blocking()) return
    const popMode = modeStack.push("modal")
    onCleanup(popMode)
  })

  let focus: Renderable | null
  function refocus() {
    setTimeout(() => {
      if (blocking()) return
      if (!focus) return
      if (focus.isDestroyed) return
      function find(item: Renderable) {
        for (const child of item.getChildren()) {
          if (child === focus) return true
          if (find(child)) return true
        }
        return false
      }
      const found = find(renderer.root)
      if (!found) return
      focus.focus()
    }, 1)
  }

  useBindings(() => ({
    enabled: blocking() && !renderer.getSelection()?.getSelectedText(),
    bindings: [
      {
        key: "escape",
        desc: "Close dialog",
        group: "Dialog",
        cmd: () => {
          if (renderer.getSelection()) {
            renderer.clearSelection()
          }
          const current = store.stack.at(-1)
          current?.onClose?.()
          setStore("stack", store.stack.slice(0, -1))
          refocus()
        },
      },
      {
        key: "ctrl+c",
        desc: "Close dialog",
        group: "Dialog",
        cmd: () => {
          if (renderer.getSelection()) {
            renderer.clearSelection()
          }
          const current = store.stack.at(-1)
          current?.onClose?.()
          setStore("stack", store.stack.slice(0, -1))
          refocus()
        },
      },
    ],
  }))

  return {
    clear() {
      for (const item of store.stack) {
        if (item.onClose) item.onClose()
      }
      batch(() => {
        setStore("size", "medium")
        setStore("stack", [])
        setStore("focused", true)
      })
      refocus()
    },
    replace(input: any, onClose?: () => void) {
      if (store.stack.length === 0) {
        focus = renderer.currentFocusedRenderable
        focus?.blur()
      }
      for (const item of store.stack) {
        if (item.onClose) item.onClose()
      }
      setStore("size", "medium")
      setStore("focused", true)
      setStore("stack", [
        {
          element: input,
          onClose,
        },
      ])
    },
    get stack() {
      return store.stack
    },
    get size() {
      return store.size
    },
    get splitWidth() {
      return splitWidth()
    },
    get blocking() {
      return blocking()
    },
    focus() {
      setStore("focused", true)
    },
    blur() {
      if (!splitWidth()) return
      setStore("focused", false)
      refocus()
    },
    setSize(size: "medium" | "large" | "xlarge" | "fullscreen" | "split") {
      setStore("size", size)
    },
  }
}

export type DialogContext = ReturnType<typeof init>

const ctx = createContext<DialogContext>()

export function DialogProvider(props: ParentProps) {
  const value = init()
  const renderer = useRenderer()
  const toast = useToast()
  const clipboard = useClipboard()

  function copySelection() {
    const text = renderer.getSelection()?.getSelectedText()
    if (!text || !clipboard.write) return false
    void clipboard.write(text).then(
      () => toast.show({ message: "Copied to clipboard", variant: "info" }),
      (error) => toast.error(error),
    )
    renderer.clearSelection()
    return true
  }

  return (
    <ctx.Provider value={value}>
      {props.children}
      <box
        position="absolute"
        zIndex={3000}
        onMouseDown={(evt: { button: number; preventDefault(): void; stopPropagation(): void }) => {
          if (!Flag.OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) return
          if (evt.button !== MouseButton.RIGHT) return

          if (!copySelection()) return
          evt.preventDefault()
          evt.stopPropagation()
        }}
        onMouseUp={!Flag.OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT ? copySelection : undefined}
      >
        <Show when={value.stack.length}>
          <Dialog onClose={() => value.clear()} onFocus={() => value.focus()} active={value.blocking} size={value.size}>
            {value.stack.at(-1)!.element}
          </Dialog>
        </Show>
      </box>
    </ctx.Provider>
  )
}

export function useDialog() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useDialog must be used within a DialogProvider")
  }
  return value
}
