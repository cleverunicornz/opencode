import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { map, pipe, sortBy } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { Dialog, useDialog } from "@tui/ui/dialog"
import { useSDK } from "../context/sdk"

const PROVIDER_PRIORITY: Record<string, number> = {
  opencode: 0,
  anthropic: 1,
  "github-copilot": 2,
  openai: 3,
  google: 4,
  openrouter: 5,
  vercel: 6,
}

export function createDialogProviderOptions() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const options = createMemo(() => {
    return pipe(
      sync.data.provider_next.all,
      map((provider) => ({
        title: provider.name,
        value: provider.id,
        footer: sync.data.provider_next.connected.includes(provider.id)
          ? "Connected"
          : {
              opencode: "Recommended",
              anthropic: "Claude Max or API key",
            }[provider.id],
        async onSelect() {
          const methods = sync.data.provider_auth[provider.id]
          let method = methods[0]?.type ?? "api"
          if (methods.length > 1) {
            const index = await new Promise<number | null>((resolve) => {
              dialog.replace(
                () => (
                  <DialogSelect
                    title="Select auth method"
                    options={methods.map((x, index) => ({
                      title: x.label,
                      value: index,
                      category: "Method",
                    }))}
                    onSelect={(option) => resolve(option.value)}
                  />
                ),
                () => resolve(null),
              )
            })
            if (!index) return
            method = methods[index].type
          }
        },
      })),
      sortBy((x) => PROVIDER_PRIORITY[x.value] ?? 99),
    )
  })
  return options
}

export function DialogProvider() {
  const options = createDialogProviderOptions()

  return <DialogSelect title="Connect a provider" options={options()} />
}
