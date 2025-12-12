# Mongo + Testcontainers Cloud Integration Test Plan

Purpose: guard the Mongo-backed storage/CLI path against upstream regressions by running a fast, deterministic smoke on merges and weekly syncs. This is NOT in AGENTS yet; we will add a brief pointer once this flow is proven.

## Overview

- Build the `packages/opencode` binary (Bun + optional Docker Build Cloud for caching).
- Start MongoDB via Testcontainers Cloud (TC Cloud) using repo/org secrets.
- Run a minimal integration suite that:
  - Exercises `MongoStorage` (init, write/read/list/remove, optimistic update, config under `data`, auth/mcpAuth uniqueness, importFromFilesystem, indexes exist).
  - Runs a CLI smoke with a cheap test model token: issue a trivial prompt (e.g., "hi"), ensure a session/message is written to Mongo, and no filesystem fallback occurs.
- Fail fast if required secrets are missing. Collect logs on failure (Mongo logs, CLI stdout/stderr, test output).

## Secrets / Env (required in GitHub Actions)

- `TESTCONTAINERS_CLOUD_TOKEN`: TC Cloud token.
- `TESTCONTAINERS_CLOUD_ENDPOINT` (if your TC Cloud setup requires it).
- `TEST_AI_MODEL_TOKEN`: low-cost model key for the CLI smoke.
- `TEST_AI_MODEL_NAME`: model identifier used by the CLI (we will fill in the exact model when ready).

## Integration Test File (proposed)

- Location: `packages/opencode/test/integration/mongo.test.ts`.
- Behavior:
  - **Skip locally** if `TESTCONTAINERS_CLOUD_TOKEN` is absent; **required in CI** (workflow will fail early if missing).
  - Start Mongo via TC Cloud (use timeouts: serverSelectionTimeoutMS/connectTimeoutMS ~ 5–10s; retry up to 3x on startup).
  - Use a fresh DB per run; drop DB in `afterAll`.
  - Cover:
    - `MongoStorage.init/ensureInit`.
    - `write/read/list/remove` round-trip with typed documents.
    - `update` optimistic lock: two concurrent updates, ensure one wins and version increments.
    - `configGet/configSet`: stored under `data`, no `_id`/metadata leak.
    - `auth`/`mcpAuth`: set/get/all, uniqueness on providerId/mcpName, invalid entries rejected.
    - `importFromFilesystem`: seed a temp dir with a couple of JSON fixtures, run import, assert collections populated and indexes exist.
  - **CLI smoke**:
    - Point app to TC Mongo URI via env (e.g., `OPENCODE_MONGODB_URI`).
    - Provide `TEST_AI_MODEL_TOKEN`/`TEST_AI_MODEL_NAME` envs.
    - Run a minimal command (example placeholder): `bun run ./src/index.ts --model $TEST_AI_MODEL_NAME --prompt "hi"` or the canonical CLI entry. The smoke must write a session/message to Mongo.
    - After CLI run, query Mongo to confirm the session/message documents exist.

## Workflow (GitHub Actions) – high level

- Triggers: pushes to `main` (or release branch), weekly cron (for upstream sync), and PRs touching `packages/opencode/**` (optional but recommended).
- Concurrency: set a `concurrency` group like `mongo-smoke-${{ github.ref }}` to avoid overlapping runs.
- Steps:
  1. Checkout.
  2. Setup Bun (match repo version).
  3. `bun install` in `packages/opencode`.
  4. Unit/coverage: `bun test --coverage`.
  5. Build: `bun run build` or Docker Build Cloud step (cache if available). Produce an image/tag if you want to run the CLI from the image; otherwise run from workspace.
  6. Integration: export `TESTCONTAINERS_CLOUD_TOKEN`, `TESTCONTAINERS_CLOUD_ENDPOINT` (if needed), `TEST_AI_MODEL_TOKEN`, `TEST_AI_MODEL_NAME`, and `OPENCODE_MONGODB_URI` from the TC container info; run `bun test --test-match "integration/mongo.test.ts"`.
  7. On failure: always upload artifacts (TC container logs, test output, CLI stdout/stderr).

## Failure Handling

- Fail fast if any required secret/env is missing.
- Apply explicit timeouts for TC startup and Mongo connect.
- Surface container logs on failure.
- Ensure DB is dropped after tests to avoid leaking resources.

## What NOT to do (yet)

- Do not add tokens or TC details to AGENTS. Keep secrets in GitHub settings.
- Do not gate this on optional env in CI; the integration job should require the token and fail otherwise.

## Follow-ups

- After the workflow and test pass in CI, add a short note to AGENTS pointing to this plan and the required secrets.
- Add a couple of fast unit tests around storage/auth/config to catch regressions even without TC.

## Open Items to Fill In

- Exact CLI invocation and model name for the cheap test model.
- Whether to run the CLI from the built image or from the workspace build; both are fine—image is closer to production.
- TC Cloud endpoint setting (if non-default).
