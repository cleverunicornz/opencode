import { Instance } from "@/project/instance"
import { Plugin } from "../plugin"
import { map, filter, pipe, fromEntries, mapValues } from "remeda"
import z from "zod"

export namespace ProviderAuth {
  const state = Instance.state(async () => {
    const result = pipe(
      await Plugin.list(),
      filter((x) => x.auth?.provider !== undefined),
      map((x) => [x.auth!.provider, x.auth!] as const),
      fromEntries(),
    )
    return result
  })

  export const Method = z.object({
    type: z.union([z.literal("oauth"), z.literal("api")]),
    label: z.string(),
  })
  export type Method = z.infer<typeof Method>

  export async function methods() {
    const s = await state()
    return mapValues(s, (x) =>
      x.methods.map(
        (y): Method => ({
          type: y.type,
          label: y.label,
        }),
      ),
    )
  }
}
