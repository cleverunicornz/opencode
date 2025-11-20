import { FileDiff, Message, Part, Session } from "@opencode-ai/sdk"
import { createAsync, query, RouteDefinition, useParams } from "@solidjs/router"
import { Share } from "~/core/share"

const getData = query(async (sessionID) => {
  const data = await Share.data(sessionID)
  const result: {
    session: Session[]
    session_diff: {
      [sessionID: string]: FileDiff[]
    }
    message: {
      [sessionID: string]: Message[]
    }
    part: {
      [messageID: string]: Part[]
    }
  } = {
    session: [],
    session_diff: {
      [sessionID]: [],
    },
    message: {},
    part: {},
  }

  for (const item of data) {
    switch (item.type) {
      case "session":
        result.session.push(item.data)
        break
      case "session_diff":
        result.session_diff[sessionID] = item.data
        break
      case "message":
        result.message[item.data.sessionID] = result.message[item.data.sessionID] ?? []
        result.message[item.data.sessionID].push(item.data)
        break
      case "part":
        result.part[item.data.messageID] = result.part[item.data.messageID] ?? []
        result.part[item.data.messageID].push(item.data)
        break
    }
  }
  return result
}, "getShareData")

export const route = {
  preload: ({ params }) => getData(params.sessionID),
} satisfies RouteDefinition

export default function () {
  const params = useParams()
  const data = createAsync(async () => {
    if (!params.sessionID) return
    return getData(params.sessionID)
  })
  return <pre>{JSON.stringify(data(), null, 2)}</pre>
}
