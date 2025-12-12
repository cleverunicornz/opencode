import { MongoClient, Db, Collection, Document } from "mongodb"
import { Log } from "../util/log"

// ============================================
// Type definitions
// ============================================

interface StorageDocument extends Document {
    _id: string
    data: unknown
    version: number
    updatedAt: Date
}

interface AuthDocument extends Document {
    providerId: string
    data: unknown
    updatedAt: Date
}

interface McpAuthDocument extends Document {
    mcpName: string
    data: unknown
    updatedAt: Date
}

interface ConfigDocument extends Document {
    _id: string
    data: unknown
    updatedAt: Date
}

type StorageQuery = Record<string, string | number | boolean>

export namespace MongoStorage {
    const log = Log.create({ service: "mongo-storage" })

    let client: MongoClient | null = null
    let db: Db | null = null
    let initPromise: Promise<void> | null = null

    // Collection name mapping from hierarchical keys
    const COLLECTION_MAP: Record<string, string> = {
        session: "sessions",
        message: "messages",
        part: "parts",
        project: "projects",
        share: "shares",
        session_diff: "session_diffs",
    }

    // Connection options from env with defaults
    const CONNECTION_OPTIONS = {
        serverSelectionTimeoutMS: parseInt(process.env.OPENCODE_MONGO_SERVER_TIMEOUT || "5000"),
        connectTimeoutMS: parseInt(process.env.OPENCODE_MONGO_CONNECT_TIMEOUT || "10000"),
        socketTimeoutMS: parseInt(process.env.OPENCODE_MONGO_SOCKET_TIMEOUT || "30000"),
        maxPoolSize: parseInt(process.env.OPENCODE_MONGO_POOL_SIZE || "10"),
    }

    /**
     * Check if MongoDB storage is enabled via environment variable
     */
    export function isEnabled(): boolean {
        return !!process.env.OPENCODE_MONGODB_URI
    }

    /**
     * Get the MongoDB connection URI from environment
     */
    export function getConnectionUri(): string | undefined {
        return process.env.OPENCODE_MONGODB_URI
    }

    /**
     * Initialize MongoDB connection (idempotent)
     */
    export async function init(): Promise<void> {
        if (initPromise) {
            return initPromise
        }

        initPromise = doInit()
        return initPromise
    }

    async function doInit(): Promise<void> {
        const uri = getConnectionUri()
        if (!uri) {
            throw new Error("OPENCODE_MONGODB_URI environment variable is not set")
        }

        if (client && db) {
            log.debug("MongoDB already connected")
            return
        }

        log.info("Connecting to MongoDB...", { options: CONNECTION_OPTIONS })
        client = new MongoClient(uri, CONNECTION_OPTIONS)
        await client.connect()
        db = client.db()
        log.info("MongoDB connected successfully")

        await bootstrap()
    }

    /**
     * Ensure MongoDB is initialized before operations (idempotent, safe to call multiple times)
     */
    export async function ensureInit(): Promise<void> {
        if (!isEnabled()) {
            return
        }
        if (db) {
            return
        }
        await init()
    }

    /**
     * Get the database instance
     */
    export function getDb(): Db {
        if (!db) {
            throw new Error("MongoDB not initialized. Call init() or ensureInit() first.")
        }
        return db
    }

    /**
     * Get a collection by name
     */
    export function collection<T extends Document = Document>(name: string): Collection<T> {
        return getDb().collection<T>(name)
    }

    /**
     * Close the MongoDB connection
     */
    export async function close(): Promise<void> {
        if (client) {
            await client.close()
            client = null
            db = null
            initPromise = null
            log.info("MongoDB connection closed")
        }
    }

    /**
     * Bootstrap migration - ensures required collections and indexes exist
     */
    async function bootstrap(): Promise<void> {
        if (!db) return

        log.info("Running bootstrap migration...")

        // Create indexes for efficient querying
        await db.collection("sessions").createIndex({ projectId: 1 })
        await db.collection("messages").createIndex({ sessionId: 1 })
        await db.collection("parts").createIndex({ messageId: 1 })
        await db.collection("auth").createIndex({ providerId: 1 }, { unique: true })
        await db.collection("mcp_auth").createIndex({ mcpName: 1 }, { unique: true })

        // Ensure default config exists with proper data structure
        const configColl = db.collection<ConfigDocument>("config")
        const configExists = await configColl.findOne({ _id: "default" })
        if (!configExists) {
            const defaultConfig: ConfigDocument = {
                _id: "default",
                data: { $schema: "https://opencode.ai/config.json" },
                updatedAt: new Date(),
            }
            await configColl.insertOne(defaultConfig)
            log.info("Created default config document")
        }

        log.info("Bootstrap migration completed")
    }

    /**
     * Import existing filesystem data into MongoDB (one-time migration)
     */
    export async function importFromFilesystem(dataDir: string): Promise<void> {
        const fs = await import("fs/promises")
        const path = await import("path")

        log.info("Starting filesystem import...", { dataDir })

        // Check if already imported
        const metaColl = collection("_meta")
        const imported = await metaColl.findOne({ _id: "filesystem_imported" })
        if (imported) {
            log.info("Filesystem already imported, skipping")
            return
        }

        // Import storage data
        const storageDir = path.join(dataDir, "storage")
        for (const [type, collName] of Object.entries(COLLECTION_MAP)) {
            const typeDir = path.join(storageDir, type)
            try {
                await importDirectory(typeDir, type, collName)
            } catch (e) {
                log.debug(`No ${type} directory to import`)
            }
        }

        // Import auth.json
        try {
            const authPath = path.join(dataDir, "auth.json")
            const authData = JSON.parse(await fs.readFile(authPath, "utf-8"))
            for (const [providerId, data] of Object.entries(authData)) {
                await authSet(providerId, data)
            }
            log.info("Imported auth data")
        } catch (e) {
            log.debug("No auth.json to import")
        }

        // Import mcp-auth.json
        try {
            const mcpAuthPath = path.join(dataDir, "mcp-auth.json")
            const mcpAuthData = JSON.parse(await fs.readFile(mcpAuthPath, "utf-8"))
            for (const [mcpName, data] of Object.entries(mcpAuthData)) {
                await mcpAuthSet(mcpName, data)
            }
            log.info("Imported mcp-auth data")
        } catch (e) {
            log.debug("No mcp-auth.json to import")
        }

        // Import config
        try {
            const configPaths = [
                path.join(dataDir, "..", "config", "config.json"),
                path.join(dataDir, "..", "config", "opencode.json"),
            ]
            for (const configPath of configPaths) {
                try {
                    const configData = JSON.parse(await fs.readFile(configPath, "utf-8"))
                    await configSet(configData)
                    log.info("Imported config from", { path: configPath })
                    break
                } catch {
                    continue
                }
            }
        } catch (e) {
            log.debug("No config to import")
        }

        // Mark as imported
        await metaColl.updateOne(
            { _id: "filesystem_imported" },
            { $set: { _id: "filesystem_imported", importedAt: new Date() } },
            { upsert: true },
        )

        log.info("Filesystem import completed")
    }

    async function importDirectory(dir: string, type: string, collName: string): Promise<void> {
        const fs = await import("fs/promises")
        const path = await import("path")

        const glob = new Bun.Glob("**/*.json")
        for await (const file of glob.scan({ cwd: dir, absolute: true })) {
            try {
                const content = JSON.parse(await fs.readFile(file, "utf-8"))
                const relativePath = path.relative(dir, file)
                const keyParts = relativePath.replace(/\.json$/, "").split(path.sep)
                const key = [type, ...keyParts]
                await write(key, content)
            } catch (e) {
                log.warn("Failed to import file", { file, error: e })
            }
        }
        log.info(`Imported ${type} data`)
    }

    /**
     * Build MongoDB query from hierarchical key
     */
    function buildQuery(type: string, ids: string[]): StorageQuery {
        switch (type) {
            case "session":
                if (ids.length === 2) {
                    return { projectId: ids[0], sessionId: ids[1] }
                }
                return { projectId: ids[0] }
            case "message":
                if (ids.length === 2) {
                    return { sessionId: ids[0], messageId: ids[1] }
                }
                return { sessionId: ids[0] }
            case "part":
                if (ids.length === 2) {
                    return { messageId: ids[0], partId: ids[1] }
                }
                return { messageId: ids[0] }
            case "project":
                return { projectId: ids[0] }
            case "share":
                return { shareId: ids[0] }
            case "session_diff":
                return { sessionId: ids[0] }
            default:
                return { _id: ids.join("/") }
        }
    }

    /**
     * Build document ID from hierarchical key
     */
    function buildDocId(type: string, ids: string[]): string {
        return ids.join("/")
    }

    /**
     * Extract key array from a MongoDB document
     */
    function extractKey(type: string, doc: Document): string[] {
        switch (type) {
            case "session":
                return [type, doc.projectId, doc.sessionId]
            case "message":
                return [type, doc.sessionId, doc.messageId]
            case "part":
                return [type, doc.messageId, doc.partId]
            case "project":
                return [type, doc.projectId]
            case "share":
                return [type, doc.shareId]
            case "session_diff":
                return [type, doc.sessionId]
            default:
                return [type, ...(doc._id?.toString().split("/") || [])]
        }
    }

    /**
     * Read data from MongoDB
     */
    export async function read<T>(key: string[]): Promise<T> {
        await ensureInit()
        const [type, ...ids] = key
        const collectionName = COLLECTION_MAP[type] || type
        const coll = collection<StorageDocument>(collectionName)
        const docId = buildDocId(type, ids)
        const doc = await coll.findOne({ _id: docId })

        if (!doc) {
            const error = new Error(`Resource not found: ${key.join("/")}`) as NodeJS.ErrnoException
            error.code = "ENOENT"
            throw error
        }

        return doc.data as T
    }

    /**
     * Write data to MongoDB
     */
    export async function write<T>(key: string[], content: T): Promise<void> {
        await ensureInit()
        const [type, ...ids] = key
        const collectionName = COLLECTION_MAP[type] || type
        const coll = collection<StorageDocument>(collectionName)
        const query = buildQuery(type, ids)
        const docId = buildDocId(type, ids)

        await coll.updateOne(
            { _id: docId },
            {
                $set: {
                    ...query,
                    _id: docId,
                    data: content,
                    updatedAt: new Date(),
                },
                $setOnInsert: { version: 1 },
            },
            { upsert: true },
        )
    }

    /**
     * Update data in MongoDB using a transform function with optimistic locking
     */
    export async function update<T>(key: string[], fn: (draft: T) => void): Promise<T> {
        await ensureInit()
        const [type, ...ids] = key
        const collectionName = COLLECTION_MAP[type] || type
        const coll = collection<StorageDocument>(collectionName)
        const docId = buildDocId(type, ids)

        const maxRetries = 3
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const doc = await coll.findOne({ _id: docId })
            if (!doc) {
                const error = new Error(`Resource not found: ${key.join("/")}`) as NodeJS.ErrnoException
                error.code = "ENOENT"
                throw error
            }

            const content = structuredClone(doc.data) as T
            fn(content)

            const currentVersion = doc.version || 0
            const result = await coll.updateOne(
                { _id: docId, version: currentVersion },
                {
                    $set: { data: content, updatedAt: new Date() },
                    $inc: { version: 1 },
                },
            )

            if (result.matchedCount === 1) {
                return content
            }

            // Version conflict, retry
            log.debug("Update version conflict, retrying", { attempt, key })
        }

        throw new Error(`Update failed after ${maxRetries} retries due to concurrent modifications: ${key.join("/")}`)
    }

    /**
     * Remove data from MongoDB
     */
    export async function remove(key: string[]): Promise<void> {
        await ensureInit()
        const [type, ...ids] = key
        const collectionName = COLLECTION_MAP[type] || type
        const coll = collection(collectionName)
        const docId = buildDocId(type, ids)

        await coll.deleteOne({ _id: docId })
    }

    /**
     * List keys with given prefix from MongoDB
     */
    export async function list(prefix: string[]): Promise<string[][]> {
        await ensureInit()
        const [type, ...ids] = prefix
        const collectionName = COLLECTION_MAP[type] || type
        const coll = collection(collectionName)
        const query = ids.length > 0 ? buildQuery(type, ids) : {}

        const docs = await coll.find(query).sort({ _id: 1 }).toArray()
        const result = docs.map((doc) => extractKey(type, doc))
        result.sort()
        return result
    }

    // ============================================
    // Auth-specific operations
    // ============================================

    /**
     * Get auth entry by provider ID
     */
    export async function authGet(providerId: string): Promise<unknown | undefined> {
        await ensureInit()
        const coll = collection<AuthDocument>("auth")
        const doc = await coll.findOne({ providerId })
        return doc?.data
    }

    /**
     * Get all auth entries
     */
    export async function authAll(): Promise<Record<string, unknown>> {
        await ensureInit()
        const coll = collection<AuthDocument>("auth")
        const docs = await coll.find({}).toArray()
        return docs.reduce(
            (acc, doc) => {
                if (doc.providerId && doc.data) {
                    acc[doc.providerId] = doc.data
                }
                return acc
            },
            {} as Record<string, unknown>,
        )
    }

    /**
     * Set auth entry
     */
    export async function authSet(providerId: string, data: unknown): Promise<void> {
        await ensureInit()
        const coll = collection<AuthDocument>("auth")
        await coll.updateOne({ providerId }, { $set: { providerId, data, updatedAt: new Date() } }, { upsert: true })
    }

    /**
     * Remove auth entry
     */
    export async function authRemove(providerId: string): Promise<void> {
        await ensureInit()
        const coll = collection<AuthDocument>("auth")
        await coll.deleteOne({ providerId })
    }

    // ============================================
    // MCP Auth-specific operations
    // ============================================

    /**
     * Get MCP auth entry by name
     */
    export async function mcpAuthGet(mcpName: string): Promise<unknown | undefined> {
        await ensureInit()
        const coll = collection<McpAuthDocument>("mcp_auth")
        const doc = await coll.findOne({ mcpName })
        return doc?.data
    }

    /**
     * Get all MCP auth entries
     */
    export async function mcpAuthAll(): Promise<Record<string, unknown>> {
        await ensureInit()
        const coll = collection<McpAuthDocument>("mcp_auth")
        const docs = await coll.find({}).toArray()
        return docs.reduce(
            (acc, doc) => {
                if (doc.mcpName && doc.data) {
                    acc[doc.mcpName] = doc.data
                }
                return acc
            },
            {} as Record<string, unknown>,
        )
    }

    /**
     * Set MCP auth entry
     */
    export async function mcpAuthSet(mcpName: string, data: unknown): Promise<void> {
        await ensureInit()
        const coll = collection<McpAuthDocument>("mcp_auth")
        await coll.updateOne({ mcpName }, { $set: { mcpName, data, updatedAt: new Date() } }, { upsert: true })
    }

    /**
     * Remove MCP auth entry
     */
    export async function mcpAuthRemove(mcpName: string): Promise<void> {
        await ensureInit()
        const coll = collection<McpAuthDocument>("mcp_auth")
        await coll.deleteOne({ mcpName })
    }

    // ============================================
    // Config-specific operations
    // ============================================

    /**
     * Get config document (returns only data, not metadata)
     */
    export async function configGet(): Promise<unknown | undefined> {
        await ensureInit()
        const coll = collection<ConfigDocument>("config")
        const doc = await coll.findOne({ _id: "default" })
        return doc?.data
    }

    /**
     * Set config document (stores under data field)
     */
    export async function configSet(config: unknown): Promise<void> {
        await ensureInit()
        const coll = collection<ConfigDocument>("config")
        await coll.updateOne({ _id: "default" }, { $set: { data: config, updatedAt: new Date() } }, { upsert: true })
    }
}
