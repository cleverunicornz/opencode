import { fn } from "@opencode-ai/util/fn"
import z from "zod"
import { Storage } from "./storage"

export namespace Share {
  export const Info = z.object({
    id: z.string(),
    secret: z.string(),
  })
  export type Info = z.infer<typeof Info>

  export const create = fn(Info.pick({ id: true }), async (body) => {
    const info: Info = {
      id: body.id,
      secret: crypto.randomUUID(),
    }
    await Storage.write(["share", info.id], info)
  })
}
