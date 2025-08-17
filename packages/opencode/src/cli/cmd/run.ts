import type { Argv } from "yargs"
import { Bus } from "../../bus"
import { Provider } from "../../provider/provider"
import { Session } from "../../session"
import { UI } from "../ui"
import path from "path"
import { cmd } from "./cmd"
import { Flag } from "../../flag/flag"
import { Config } from "../../config/config"
import { bootstrap } from "../bootstrap"
import { MessageV2 } from "../../session/message-v2"
import { Identifier } from "../../id/id"
import { Agent } from "../../agent/agent"
import { defer } from "../../util/defer"
import { clone } from "remeda"
import { Filesystem } from "../../util/filesystem"

const TOOL: Record<string, [string, string]> = {
  todowrite: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  todoread: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  bash: ["Bash", UI.Style.TEXT_DANGER_BOLD],
  edit: ["Edit", UI.Style.TEXT_SUCCESS_BOLD],
  glob: ["Glob", UI.Style.TEXT_INFO_BOLD],
  grep: ["Grep", UI.Style.TEXT_INFO_BOLD],
  list: ["List", UI.Style.TEXT_INFO_BOLD],
  read: ["Read", UI.Style.TEXT_HIGHLIGHT_BOLD],
  write: ["Write", UI.Style.TEXT_SUCCESS_BOLD],
  websearch: ["Search", UI.Style.TEXT_DIM_BOLD],
}

export const RunCommand = cmd({
  command: "run [message..]",
  describe: "run opencode with a message",
  builder: (yargs: Argv) => {
    return yargs
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        describe: "session id to continue",
        type: "string",
      })
      .option("share", {
        type: "boolean",
        describe: "share the session",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
  },
  handler: async (args) => {
    let message = args.message.join(" ")

    if (!process.stdin.isTTY) message += "\n" + (await Bun.stdin.text())

    await bootstrap({ cwd: process.cwd() }, async () => {
      const session = await (async () => {
        if (args.continue) {
          const list = Session.list()
          const first = await list.next()
          await list.return()
          if (first.done) return
          return first.value
        }

        if (args.session) return Session.get(args.session)

        return Session.create()
      })()

      if (!session) {
        UI.error("Session not found")
        return
      }

      const cfg = await Config.get()
      if (cfg.share === "auto" || Flag.OPENCODE_AUTO_SHARE || args.share) {
        try {
          await Session.share(session.id)
          UI.println(UI.Style.TEXT_INFO_BOLD + "~  https://opencode.ai/s/" + session.id.slice(-8))
        } catch (error) {
          if (error instanceof Error && error.message.includes("disabled")) {
            UI.println(UI.Style.TEXT_DANGER_BOLD + "!  " + error.message)
          } else {
            throw error
          }
        }
      }

      const agent = await (async () => {
        if (args.agent) return Agent.get(args.agent)
        const build = Agent.get("build")
        if (build) return build
        return Agent.list().then((x) => x[0])
      })()

      const { providerID, modelID } = await (async () => {
        if (args.model) return Provider.parseModel(args.model)
        if (agent.model) return agent.model
        return await Provider.defaultModel()
      })()

      Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
        if (evt.properties.part.sessionID !== session.id) return
        if (evt.properties.part.messageID === messageID) return
        render(clone(evt.properties.part))
      })

      let current: MessageV2.Part | undefined

      const queue = [] as MessageV2.Part[]
      const buffer = [] as string[]
      const stderr = Bun.stderr.writer()
      let done = false
      const loop = setInterval(async () => {
        const item = buffer.shift()
        if (!item) {
          if (done) clearInterval(loop)
          return
        }
        stderr.write(item)
      }, 4)

      const cwd = process.cwd()
      async function render(part: MessageV2.Part) {
        if (current && current.id !== part.id) {
          queue.push(part)
          return
        }

        if (part.type === "text") {
          if (!current) {
            buffer.push("\n", UI.Ansi.fg.white)
          }
          const index = current?.type === "text" ? current.text.length : 0
          const substr = part.text.slice(index)
          buffer.push(...substr)
          current = part
          if (part.time?.end) {
            buffer.push(UI.Ansi.reset, "\n\n")
            current = undefined
          }
        }

        if (part.type === "tool") {
          current = part
          if (part.state.status === "pending" && ["glob", "read", "list"].includes(part.tool)) {
            buffer.push(UI.Ansi.fg.black, UI.Ansi.bg.blue)
            buffer.push(" ", ...part.tool, " ")
            buffer.push(UI.Ansi.reset)
          }
          if (part.state.status === "pending" && part.tool === "bash") {
            buffer.push("\n", "$")
          }
          if (part.state.status === "running" && part.state.input) {
            if (part.tool === "read") {
              buffer.push(" ", UI.Ansi.style.dim)
              const filepath = path.relative(cwd, part.state.input!.filePath)
              buffer.push(filepath)
            }
            if (part.tool === "list") {
              buffer.push(" ", UI.Ansi.style.dim)
              const filepath = path.relative(cwd, part.state.input!.path) || "."
              buffer.push(filepath)
            }

            if (part.tool === "bash") {
              buffer.push(UI.Ansi.fg.white, " ", part.state.input.command.trim())
            }
            buffer.push(UI.Ansi.reset)
          }
          if (part.state.status === "completed") {
            buffer.push("\n")

            if (part.tool === "bash") {
              buffer.push(part.state.output)
            }

            current = undefined
          }
        }

        if (queue.length) {
          if (!current) {
            const next = queue.shift()!
            return render(next)
          }
        }
      }

      let errorMsg: string | undefined
      Bus.subscribe(Session.Event.Error, async (evt) => {
        const { sessionID, error } = evt.properties
        if (sessionID !== session.id || !error) return
        let err = String(error.name)

        if ("data" in error && error.data && "message" in error.data) {
          err = error.data.message
        }
        errorMsg = errorMsg ? errorMsg + "\n" + err : err

        UI.error(err)
      })

      const messageID = Identifier.ascending("message")
      const result = await Session.chat({
        sessionID: session.id,
        messageID,
        ...(agent.model
          ? agent.model
          : {
              providerID,
              modelID,
            }),
        agent: agent.name,
        parts: [
          {
            id: Identifier.ascending("part"),
            type: "text",
            text: message,
          },
        ],
      })
      done = true

      const isPiped = !process.stdout.isTTY
      if (isPiped) {
        const match = result.parts.findLast((x) => x.type === "text")
        if (match) process.stdout.write(UI.markdown(match.text))
        if (errorMsg) process.stdout.write(errorMsg)
      }
      UI.empty()
    })
  },
})
