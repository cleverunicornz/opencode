import { $ } from "bun"
import * as core from "@actions/core"
import { Octokit } from "@octokit/rest"
import { graphql } from "@octokit/graphql"
import { lazy } from "./lazy"
import { Auth } from "./auth"
import { Context } from "./context"

export namespace GitHub {
  export const rest = lazy(async () => {
    const client = new Octokit({ auth: await Auth.token() })
    return client.rest
  })

  export const graph = lazy(async () =>
    graphql.defaults({
      headers: { authorization: `token ${await Auth.token()}` },
    }),
  )

  export async function wrap(fn: () => Promise<void>) {
    try {
      await fn()
      process.exit(0)
    } catch (e: any) {
      console.error(e)
      let msg = e
      if (e instanceof $.ShellError) msg = e.stderr.toString()
      else if (e instanceof Error) msg = e.message
      core.setFailed(msg)
      // Also output the clean error message for the action to capture
      //core.setOutput("prepare_error", e.message);
      process.exit(1)
    }
  }

  export function runUrl() {
    const runId = process.env["GITHUB_RUN_ID"]
    if (!runId) throw new Error(`Environment variable "GITHUB_RUN_ID" is not set`)

    return `/${Context.repo().owner}/${Context.repo().repo}/actions/runs/${runId}`
  }

  export const repoData = lazy(async () => {
    const rest = await GitHub.rest()
    const repo = Context.repo()
    return await rest.repos.get({ owner: repo.owner, repo: repo.repo })
  })

  export function commentSectionBuild(sectionName: string, lines: string[]) {
    return [`<!-- sec:${sectionName}:start -->`, ...lines, `<!-- sec:${sectionName}:end -->`].join("\n")
  }

  export function commentSectionParse(body: string, sectionName: string) {
    const lines = body
      .trim()
      .split("\n")
      .map((l) => l.trimEnd())
    const startIndex = lines.findIndex((l) => l.startsWith(`<!-- sec:${sectionName}:start -->`))
    const endIndex = lines.findIndex((l) => l.startsWith(`<!-- sec:${sectionName}:end -->`))
    if (startIndex === -1 || endIndex === -1) throw new Error(`Cannot find section:${sectionName} in review comment`)
    return lines.slice(startIndex + 1, endIndex)
  }

  export function commentSectionUpdate(body: string, sectionName: string, lines: string[]) {
    const oldLines = body
      .trim()
      .split("\n")
      .map((l) => l.trimEnd())
    const startIndex = oldLines.findIndex((l) => l.startsWith(`<!-- sec:${sectionName}:start -->`))
    const endIndex = oldLines.findIndex((l) => l.startsWith(`<!-- sec:${sectionName}:end -->`))
    if (startIndex === -1 || endIndex === -1) throw new Error(`Cannot find section:${sectionName} in review comment`)

    return [...oldLines.slice(0, startIndex + 1), ...lines, ...oldLines.slice(endIndex)].join("\n")
  }

  export function commentDataBuild(dataName: string, data: Record<string, any>) {
    const encoded = Buffer.from(JSON.stringify(data)).toString("base64")
    return `<!-- data:${dataName}:${encoded} -->`
  }

  export function commentDataParse<T>(body: string, dataName: string) {
    const data = body.match(new RegExp(`<!-- data:${dataName}:([^\s]+)\s*-->`, "s"))
    if (!data || !data[1]) throw new Error(`Cannot find data:${dataName} in review comment`)

    const decoded = Buffer.from(data[1], "base64").toString("utf-8")
    return JSON.parse(decoded) as T
  }
}
