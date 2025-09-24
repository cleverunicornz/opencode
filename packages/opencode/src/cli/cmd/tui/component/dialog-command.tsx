import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import {
  createContext,
  createMemo,
  createSignal,
  onCleanup,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Keybind } from "../../../../util/keybind"
import { useKeybind } from "../context/keybind"

type Context = ReturnType<typeof init>
const ctx = createContext<Context>()

function init() {
  const [registrations, setRegistrations] = createSignal<Accessor<DialogSelectOption[]>[]>([])
  const dialog = useDialog()
  const options = createMemo(() => {
    return registrations().flatMap((x) => x())
  })
  const keybind = useKeybind()

  useKeyboard((evt) => {
    for (const option of options()) {
      if (option.keybind && keybind.match(option.keybind, evt)) {
        option.onSelect?.(dialog)
        return
      }
    }
  })

  return {
    trigger(name: string) {
      for (const option of options()) {
        if (option.value === name) {
          option.onSelect?.(dialog)
          return
        }
      }
    },
    register(cb: () => DialogSelectOption[]) {
      const results = createMemo(cb)
      setRegistrations((arr) => [results, ...arr])
      onCleanup(() => {
        setRegistrations((arr) => arr.filter((x) => x !== results))
      })
    },
    get options() {
      return options()
    },
  }
}

export function useCommandDialog() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useCommandDialog must be used within a CommandProvider")
  }
  return value
}

export function CommandProvider(props: ParentProps) {
  const value = init()
  const dialog = useDialog()
  const keybind = useKeybind()

  useKeyboard((evt) => {
    if (keybind.match("command_list", evt)) {
      dialog.replace(() => <DialogCommand options={value.options} />)
      return
    }
  })

  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

function DialogCommand(props: { options: DialogSelectOption[] }) {
  return <DialogSelect title="Commands" options={props.options} />
}
