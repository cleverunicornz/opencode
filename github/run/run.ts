import { Auth } from "../src/auth"
import { Git } from "../src/git"
import { Opencode } from "../src/opencode"
import { GitHub } from "../src/github"

await GitHub.wrap(async () => {
  try {
    await Git.configure()
    await Opencode.start()
    await Opencode.chat(process.env.PROMPT!)
  } finally {
    Opencode.closeServer()
    await Auth.revoke()
    await Git.restore()
  }
})
