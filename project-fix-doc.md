# Mongo Storage Fix Plan

## Status: Implementation Complete

All critical fixes and code hygiene items have been implemented.

## Critical Fixes - DONE

- [x] **Initialization order**: `MongoStorage.ensureInit()` is called lazily before any storage operation. Auth/McpAuth/Config check `isEnabled()` at runtime.
- [x] **Config shape consistency**: Config persisted as `{ _id: "default", data: Config, updatedAt }` and only `data` is returned.
- [x] **Migration/import**: `importFromFilesystem()` imports existing data on first Mongo enable, creates indexes, marks as complete.
- [x] **Single source of truth**: Skip filesystem config when Mongo enabled unless `OPENCODE_MONGO_INCLUDE_FILES=true` (or deprecated `OPENCODE_MONGO_SKIP_FILES=false`).
- [x] **Atomic updates**: `MongoStorage.update` uses optimistic locking with `version` field and `$inc`. MCP auth has atomic field-level updates.
- [x] **Error handling parity**: `Storage.remove` and `list` log warnings for non-ENOENT errors instead of silently ignoring.

## Code Hygiene - DONE

- [x] Deduplicate auth parsing with shared `parseAuthEntries()` helper.
- [x] Import `Document` type; use typed interfaces for all document types.
- [x] Replace `any` return types with concrete types (queries, Auth.Info, etc.).
- [x] Add MongoClient options (timeouts/pool) with `safeParseInt()` and env defaults.
- [x] Remove duplicate autoshare→share migration block.
- [x] Await `fs.exists` in storage migration path.

## Additional Improvements (CodeRabbit feedback)

- [x] Well-known fetch: Added 10s timeout, error handling, response validation.
- [x] Runtime `isMongoEnabled()` check instead of module-level constant.
- [x] TOML migration error logging (non-ENOENT).
- [x] Auth/MCP parse warning logging for invalid entries.
- [x] Bootstrap index creation uses `Promise.allSettled` with error logging.
- [x] Import logging shows `{ imported, failed }` counts.
- [x] Removed double sort in `MongoStorage.list()`.
- [x] Plugin discovery logging.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCODE_MONGODB_URI` | - | MongoDB connection URI (enables Mongo backend) |
| `OPENCODE_MONGO_INCLUDE_FILES` | `false` | Set to `true` to merge filesystem configs with Mongo |
| `OPENCODE_MONGO_SERVER_TIMEOUT` | `5000` | Server selection timeout (ms) |
| `OPENCODE_MONGO_CONNECT_TIMEOUT` | `10000` | Connection timeout (ms) |
| `OPENCODE_MONGO_SOCKET_TIMEOUT` | `30000` | Socket timeout (ms) |
| `OPENCODE_MONGO_POOL_SIZE` | `10` | Max connection pool size |

## Files Modified

- `src/storage/mongo.ts` - Core MongoDB adapter
- `src/storage/storage.ts` - Storage abstraction layer
- `src/auth/index.ts` - Auth storage with Mongo backend
- `src/mcp/auth.ts` - MCP auth storage with Mongo backend
- `src/config/config.ts` - Config loading with Mongo support

## Validation Notes

- Test with `OPENCODE_MONGODB_URI` pointing to local/container MongoDB.
- Verify import runs once on first enable.
- Confirm config changes persist to Mongo.
- Check logs for bootstrap and import completion messages.
