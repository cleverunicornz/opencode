import path from "path"
import fs from "fs/promises"
import z from "zod"
import { Global } from "../global"
import { MongoStorage } from "../storage/mongo"
import { Log } from "../util/log"

export namespace McpAuth {
    const log = Log.create({ service: "mcp-auth" })

    export const Tokens = z.object({
        accessToken: z.string(),
        refreshToken: z.string().optional(),
        expiresAt: z.number().optional(),
        scope: z.string().optional(),
    })
    export type Tokens = z.infer<typeof Tokens>

    export const ClientInfo = z.object({
        clientId: z.string(),
        clientSecret: z.string().optional(),
        clientIdIssuedAt: z.number().optional(),
        clientSecretExpiresAt: z.number().optional(),
    })
    export type ClientInfo = z.infer<typeof ClientInfo>

    export const Entry = z.object({
        tokens: Tokens.optional(),
        clientInfo: ClientInfo.optional(),
        codeVerifier: z.string().optional(),
    })
    export type Entry = z.infer<typeof Entry>

    const filepath = path.join(Global.Path.data, "mcp-auth.json")

    /**
     * Parse and validate MCP auth entries from raw data
     */
    function parseEntries(data: Record<string, unknown>): Record<string, Entry> {
        return Object.entries(data).reduce(
            (acc, [key, value]) => {
                const parsed = Entry.safeParse(value)
                if (parsed.success) {
                    acc[key] = parsed.data
                } else {
                    log.warn("Invalid MCP auth entry, skipping", { key })
                }
                return acc
            },
            {} as Record<string, Entry>,
        )
    }

    export async function get(mcpName: string): Promise<Entry | undefined> {
        if (MongoStorage.isEnabled()) {
            const data = await MongoStorage.mcpAuthGet(mcpName)
            if (!data) return undefined
            const parsed = Entry.safeParse(data)
            if (!parsed.success) {
                log.warn("Invalid MCP auth entry in MongoDB", { mcpName })
            }
            return parsed.success ? parsed.data : undefined
        }
        const data = await all()
        return data[mcpName]
    }

    export async function all(): Promise<Record<string, Entry>> {
        if (MongoStorage.isEnabled()) {
            const data = await MongoStorage.mcpAuthAll()
            return parseEntries(data as Record<string, unknown>)
        }
        const file = Bun.file(filepath)
        const data = await file.json().catch(() => ({}))
        return parseEntries(data)
    }

    export async function set(mcpName: string, entry: Entry): Promise<void> {
        if (MongoStorage.isEnabled()) {
            await MongoStorage.mcpAuthSet(mcpName, entry)
            return
        }
        const file = Bun.file(filepath)
        const data = await all()
        const content = JSON.stringify({ ...data, [mcpName]: entry }, null, 2)
        await Bun.write(file, content)
        await fs.chmod(file.name!, 0o600)
    }

    export async function remove(mcpName: string): Promise<void> {
        if (MongoStorage.isEnabled()) {
            await MongoStorage.mcpAuthRemove(mcpName)
            return
        }
        const file = Bun.file(filepath)
        const data = await all()
        delete data[mcpName]
        const content = JSON.stringify(data, null, 2)
        await Bun.write(file, content)
        await fs.chmod(file.name!, 0o600)
    }

    export async function updateTokens(mcpName: string, tokens: Tokens): Promise<void> {
        if (MongoStorage.isEnabled()) {
            await MongoStorage.mcpAuthUpdateField(mcpName, "tokens", tokens)
            return
        }
        const entry = (await get(mcpName)) ?? {}
        entry.tokens = tokens
        await set(mcpName, entry)
    }

    export async function updateClientInfo(mcpName: string, clientInfo: ClientInfo): Promise<void> {
        if (MongoStorage.isEnabled()) {
            await MongoStorage.mcpAuthUpdateField(mcpName, "clientInfo", clientInfo)
            return
        }
        const entry = (await get(mcpName)) ?? {}
        entry.clientInfo = clientInfo
        await set(mcpName, entry)
    }

    export async function updateCodeVerifier(mcpName: string, codeVerifier: string): Promise<void> {
        if (MongoStorage.isEnabled()) {
            await MongoStorage.mcpAuthUpdateField(mcpName, "codeVerifier", codeVerifier)
            return
        }
        const entry = (await get(mcpName)) ?? {}
        entry.codeVerifier = codeVerifier
        await set(mcpName, entry)
    }

    export async function clearCodeVerifier(mcpName: string): Promise<void> {
        if (MongoStorage.isEnabled()) {
            await MongoStorage.mcpAuthUnsetField(mcpName, "codeVerifier")
            return
        }
        const entry = await get(mcpName)
        if (entry) {
            delete entry.codeVerifier
            await set(mcpName, entry)
        }
    }
}
