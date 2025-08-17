import { cmd } from "../cmd"
import TS from "tree-sitter-highlight"

const COLOR = {
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  reset: "\x1b[0m",
}

const classColors: Record<string, string> = {
  "variable builtin": COLOR.red,
  "punctuation delimiter": COLOR.white,
  "function method": COLOR.blue,
  "punctuation bracket": COLOR.white,
  string: COLOR.green,
  keyword: COLOR.magenta,
  type: COLOR.cyan,
  property: COLOR.yellow,
  operator: COLOR.cyan,
  "variable parameter": COLOR.yellow,
  variable: COLOR.reset,
  function: COLOR.blue,
  comment: COLOR.black,
  number: COLOR.red,
}

export const ScrapCommand = cmd({
  command: "scrap <file>",
  builder: (yargs) =>
    yargs.positional("file", {
      describe: "file to scrap",
      type: "string",
    }),
  async handler(args) {
    const text = await Bun.file(args.file).text()
    const hast = TS.highlightHast(text, TS.Language.TS)
    console.log(JSON.stringify(hast, null, 2))

    const stdout = Bun.stdout.writer()

    async function render(node: TS.HastNode | TS.HastTextNode, parent: TS.HastNode) {
      if (node.type === "text") {
        const cast = node as TS.HastTextNode
        if (parent.properties.className === "keyword" && ["const", "let", "async"].includes(cast.value)) {
          stdout.write("\x1b[3m")
          stdout.write(COLOR.magenta)
        }
        stdout.write(cast.value)
        stdout.write(COLOR.reset)
      }

      if (node.type === "element") {
        const cast = node as TS.HastNode
        const color = classColors[cast.properties.className] || COLOR.reset
        stdout.write(color)
        //stdout.write("(" + cast.properties.className + ")")

        for (const child of cast.children) {
          render(child, cast)
        }
      }
    }

    render(hast, hast)
    stdout.flush()
  },
})
