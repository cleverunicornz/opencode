import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import z from "zod"
import { MongoStorage } from "../storage/mongo"
import { Log } from "../util/log"

export namespace Auth {
    const log = Log.create({ service: "auth" })

    export const Oauth = z
        .object({
            type: z.literal("oauth"),
            refresh: z.string(),
            access: z.string(),
            expires: z.number(),
            enterpriseUrl: z.string().optional(),
        })
        .meta({ ref: "OAuth" })

    export const Api = z
        .object({
            type: z.literal("api"),
            key: z.string(),
        })
        .meta({ ref: "ApiAuth" })

    export const WellKnown = z
        .object({
            type: z.literal("wellknown"),
            key: z.string(),
            token: z.string(),
        })
        .meta({ ref: "WellKnownAuth" })

    export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown]).meta({ ref: "Auth" })
    export type Info = z.infer<typeof Info>

    const filepath = path.join(Global.Path.data, "auth.json")

    /**
     * Parse and validate auth entries from raw data
     */
    function parseAuthEntries(data: Record<string, unknown>): Record<string, Info> {
        return Object.entries(data).reduce(
            (acc, [key, value]) => {
                const parsed = Info.safeParse(value)
                if (parsed.success) {
                    acc[key] = parsed.data
                } else {
                    log.warn("Invalid auth entry, skipping", { key })
                }
                return acc
            },
            {} as Record<string, Info>,
        )
    }

    export async function get(providerID: string): Promise<Info | undefined> {
        if (MongoStorage.isEnabled()) {
            const data = await MongoStorage.authGet(providerID)
            if (!data) return undefined
            const parsed = Info.safeParse(data)
            if (!parsed.success) {
                log.warn("Invalid auth entry in MongoDB", { providerID })
            }
            return parsed.success ? parsed.data : undefined
        }
        const auth = await all()
        return auth[providerID]
    }

    export async function all(): Promise<Record<string, Info>> {
        if (MongoStorage.isEnabled()) {
            const data = await MongoStorage.authAll()
            return parseAuthEntries(data as Record<string, unknown>)
        }
        const file = Bun.file(filepath)
        const data = await file.json().catch(() => ({}) as Record<string, unknown>)
        return parseAuthEntries(data)
    }

    export async function set(key: string, info: Info): Promise<void> {
        if (MongoStorage.isEnabled()) {
            await MongoStorage.authSet(key, info)
            return
        }
        const file = Bun.file(filepath)
        const data = await all()
        const content = JSON.stringify({ ...data, [key]: info }, null, 2)
        await Bun.write(file, content)
        await fs.chmod(file.name!, 0o600)
    }

    export async function remove(key: string): Promise<void> {
        if (MongoStorage.isEnabled()) {
            await MongoStorage.authRemove(key)
            return
        }
        const file = Bun.file(filepath)
        const data = await all()
        delete data[key]
        const content = JSON.stringify(data, null, 2)
        await Bun.write(file, content)
        await fs.chmod(file.name!, 0o600)
    }
}
