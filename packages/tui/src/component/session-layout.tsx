import { Show, type ParentProps } from "solid-js"
import { useDialog } from "../ui/dialog"

export function SessionLayout(props: ParentProps) {
  const dialog = useDialog()
  let pressed: (typeof dialog.stack)[number] | undefined
  return (
    <box
      id="session-layout"
      flexDirection="row"
      flexGrow={1}
      minHeight={0}
      onMouseDown={() => {
        pressed = dialog.splitWidth ? dialog.stack.at(-1) : undefined
      }}
      onMouseUp={() => {
        if (pressed && dialog.splitWidth && pressed === dialog.stack.at(-1)) dialog.clear()
        pressed = undefined
      }}
    >
      {props.children}
      <Show when={dialog.splitWidth}>
        <box id="session-companion-space" width={dialog.splitWidth} flexShrink={0} />
      </Show>
    </box>
  )
}
