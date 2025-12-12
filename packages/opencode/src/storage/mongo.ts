import { MongoClient, Db, Collection } from "mongodb"
import { Log } from "../util/log"

export namespace MongoStorage {
  const log = Log.create({ service: "mongo-storage" })

  let client: MongoClient | null = null
  let db: Db | null = null

  // Collection name mapping from hierarchical keys
  const COLLECTION_MAP: Record<string, string> = {
    session: "sessions",
    message: "messages",
    part: "parts",
    project: "projects",
    share: "shares",
    session_diff: "session_diffs",
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
   * Initialize MongoDB connection
   */
  export async function init(): Promise<void> {
    const uri = getConnectionUri()
    if (!uri) {
      throw new Error("OPENCODE_MONGODB_URI environment variable is not set")
    }

    if (client) {
      log.debug("MongoDB already connected")
      return
    }

    log.info("Connecting to MongoDB...")
    client = new MongoClient(uri)
    await client.connect()
    db = client.db() // Uses database from connection string, or default
    log.info("MongoDB connected successfully")

    // Run bootstrap migration
    await bootstrap()
  }

  /**
   * Get the database instance
   */
  export function getDb(): Db {
    if (!db) {
      throw new Error("MongoDB not initialized. Call init() first.")
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

    // Ensure default config exists
    const configExists = await db.collection("config").findOne({ _id: "default" })
    if (!configExists) {
      await db.collection("config").insertOne({
        _id: "default" as any,
        $schema: "https://opencode.ai/config.json",
        // Everything else is optional - OpenCode uses defaults
      })
      log.info("Created default config document")
    }

    log.info("Bootstrap migration completed")
  }

  /**
   * Build MongoDB query from hierarchical key
   */
  function buildQuery(type: string, ids: string[]): Record<string, any> {
    switch (type) {
      case "session":
        // ["session", projectId, sessionId]
        if (ids.length === 2) {
          return { projectId: ids[0], sessionId: ids[1] }
        }
        return { projectId: ids[0] }
      case "message":
        // ["message", sessionId, messageId]
        if (ids.length === 2) {
          return { sessionId: ids[0], messageId: ids[1] }
        }
        return { sessionId: ids[0] }
      case "part":
        // ["part", messageId, partId]
        if (ids.length === 2) {
          return { messageId: ids[0], partId: ids[1] }
        }
        return { messageId: ids[0] }
      case "project":
        // ["project", projectId]
        return { projectId: ids[0] }
      case "share":
        // ["share", shareId]
        return { shareId: ids[0] }
      case "session_diff":
        // ["session_diff", sessionId]
        return { sessionId: ids[0] }
      default:
        // Generic fallback
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
  function extractKey(type: string, doc: Record<string, any>): string[] {
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
        return [type, ...(doc._id?.split("/") || [])]
    }
  }

  /**
   * Read data from MongoDB
   */
  export async function read<T>(key: string[]): Promise<T> {
    const [type, ...ids] = key
    const collectionName = COLLECTION_MAP[type] || type
    const coll = collection(collectionName)
    const query = buildQuery(type, ids)
    const doc = await coll.findOne(query)

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
    const [type, ...ids] = key
    const collectionName = COLLECTION_MAP[type] || type
    const coll = collection(collectionName)
    const query = buildQuery(type, ids)

    const doc = {
      ...query,
      _id: buildDocId(type, ids),
      data: content,
      updatedAt: new Date(),
    }

    await coll.updateOne(
      { _id: doc._id },
      { $set: doc },
      { upsert: true }
    )
  }

  /**
   * Update data in MongoDB using a transform function
   */
  export async function update<T>(key: string[], fn: (draft: T) => void): Promise<T> {
    const [type, ...ids] = key
    const collectionName = COLLECTION_MAP[type] || type
    const coll = collection(collectionName)
    const query = buildQuery(type, ids)
    const docId = buildDocId(type, ids)

    const doc = await coll.findOne({ _id: docId })
    if (!doc) {
      const error = new Error(`Resource not found: ${key.join("/")}`) as NodeJS.ErrnoException
      error.code = "ENOENT"
      throw error
    }

    const content = doc.data as T
    fn(content)

    await coll.updateOne(
      { _id: docId },
      { $set: { data: content, updatedAt: new Date() } }
    )

    return content
  }

  /**
   * Remove data from MongoDB
   */
  export async function remove(key: string[]): Promise<void> {
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
    const [type, ...ids] = prefix
    const collectionName = COLLECTION_MAP[type] || type
    const coll = collection(collectionName)
    const query = ids.length > 0 ? buildQuery(type, ids) : {}

    const docs = await coll.find(query).toArray()
    return docs.map((doc) => extractKey(type, doc))
  }

  // ============================================
  // Auth-specific operations
  // ============================================

  /**
   * Get auth entry by provider ID
   */
  export async function authGet(providerId: string): Promise<any | undefined> {
    const coll = collection("auth")
    const doc = await coll.findOne({ providerId })
    return doc?.data
  }

  /**
   * Get all auth entries
   */
  export async function authAll(): Promise<Record<string, any>> {
    const coll = collection("auth")
    const docs = await coll.find({}).toArray()
    return docs.reduce(
      (acc, doc) => {
        if (doc.providerId && doc.data) {
          acc[doc.providerId] = doc.data
        }
        return acc
      },
      {} as Record<string, any>
    )
  }

  /**
   * Set auth entry
   */
  export async function authSet(providerId: string, data: any): Promise<void> {
    const coll = collection("auth")
    await coll.updateOne(
      { providerId },
      { $set: { providerId, data, updatedAt: new Date() } },
      { upsert: true }
    )
  }

  /**
   * Remove auth entry
   */
  export async function authRemove(providerId: string): Promise<void> {
    const coll = collection("auth")
    await coll.deleteOne({ providerId })
  }

  // ============================================
  // MCP Auth-specific operations
  // ============================================

  /**
   * Get MCP auth entry by name
   */
  export async function mcpAuthGet(mcpName: string): Promise<any | undefined> {
    const coll = collection("mcp_auth")
    const doc = await coll.findOne({ mcpName })
    return doc?.data
  }

  /**
   * Get all MCP auth entries
   */
  export async function mcpAuthAll(): Promise<Record<string, any>> {
    const coll = collection("mcp_auth")
    const docs = await coll.find({}).toArray()
    return docs.reduce(
      (acc, doc) => {
        if (doc.mcpName && doc.data) {
          acc[doc.mcpName] = doc.data
        }
        return acc
      },
      {} as Record<string, any>
    )
  }

  /**
   * Set MCP auth entry
   */
  export async function mcpAuthSet(mcpName: string, data: any): Promise<void> {
    const coll = collection("mcp_auth")
    await coll.updateOne(
      { mcpName },
      { $set: { mcpName, data, updatedAt: new Date() } },
      { upsert: true }
    )
  }

  /**
   * Remove MCP auth entry
   */
  export async function mcpAuthRemove(mcpName: string): Promise<void> {
    const coll = collection("mcp_auth")
    await coll.deleteOne({ mcpName })
  }

  // ============================================
  // Config-specific operations
  // ============================================

  /**
   * Get config document
   */
  export async function configGet(): Promise<any | undefined> {
    const coll = collection("config")
    const doc = await coll.findOne({ _id: "default" })
    return doc?.data || doc
  }

  /**
   * Set config document
   */
  export async function configSet(config: any): Promise<void> {
    const coll = collection("config")
    await coll.updateOne(
      { _id: "default" },
      { $set: { _id: "default", ...config, updatedAt: new Date() } },
      { upsert: true }
    )
  }
}
