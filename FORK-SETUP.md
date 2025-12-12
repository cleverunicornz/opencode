# OpenCode Fork Setup - Operational Guide

## Objective

Prepare this fork for long-term maintenance with minimal merge conflicts. We're adding MongoDB storage shims to 4 files. Upstream (sst/opencode) moves fast (~80 commits/day). This doc gets us to a clean starting point.

---

## Current State

```
Repository: cleverunicornz/opencode (fork of sst/opencode)
Current branch: dev
Origin remote: cleverunicornz/opencode
Upstream remote: NOT CONFIGURED (needs to be added)
```

**Upstream branch structure:**
- `dev` = bleeding edge, extremely active
- `production` = stable releases (tagged v1.0.x)

---

## Target Branch Structure

```
sst/opencode:dev (upstream)
       │
       │ (auto-sync daily)
       ▼
origin/dev ◄──── mirror of upstream, no direct commits
       │
       │ (manual merge when tested)
       ▼
origin/main ◄─── our stable baseline
       │
       │ (rebase onto main)
       ▼
origin/mongo-shim ◄─── our 4-file changes ONLY
```

**Workflow:**
1. `dev` syncs from upstream automatically
2. We test that upstream changes don't break anything
3. We merge `dev` → `main` when stable
4. `mongo-shim` gets rebased onto `main` periodically
5. Deployments use `main` + `mongo-shim` merged

---

## Setup Steps

### Step 1: Add Upstream Remote

```bash
git remote add upstream https://github.com/sst/opencode.git
git fetch upstream
```

**Verify:**
```bash
git remote -v
# Should show:
# origin    https://github.com/cleverunicornz/opencode.git (fetch)
# origin    https://github.com/cleverunicornz/opencode.git (push)
# upstream  https://github.com/sst/opencode.git (fetch)
# upstream  https://github.com/sst/opencode.git (push)
```

### Step 2: Create Main Branch

```bash
git checkout dev
git pull origin dev
git checkout -b main
git push -u origin main
```

### Step 3: Create Mongo-Shim Branch

```bash
git checkout main
git checkout -b mongo-shim
git push -u origin mongo-shim
```

### Step 4: Set Default Branch on GitHub

Go to GitHub repo settings → Branches → Change default branch to `main`.

This makes `main` the landing page and PR target.

---

## Workflow Cleanup

### DELETE These Workflows

These are SST-specific and will never run on our fork (or are useless to us):

| File | Reason |
|------|--------|
| `deploy.yml` | SST's infrastructure deployment |
| `stats.yml` | Download stats for their releases |
| `notify-discord.yml` | Their Discord notifications |
| `publish.yml` | Publishes to npm under `opencode` namespace |
| `publish-github-action.yml` | Their GitHub Action publishing |
| `publish-vscode.yml` | Their VSCode extension |
| `sync-zed-extension.yml` | Their Zed extension sync |
| `update-nix-hashes.yml` | Nix package hashes |
| `auto-label-tui.yml` | Their issue auto-labeling |
| `duplicate-issues.yml` | Their duplicate issue detection |
| `review.yml` | Uses opencode for PR reviews (optional keep) |
| `opencode.yml` | Unclear purpose, likely their CI |

### KEEP These Workflows

| File | Reason |
|------|--------|
| `test.yml` | Runs tests - useful for our PRs |
| `typecheck.yml` | Type checking - catches errors |
| `generate.yml` | Code generation if needed |

### ADD New Workflow

Create `.github/workflows/sync-upstream.yml` for automated syncing.

---

## Sync Upstream Workflow

Create `.github/workflows/sync-upstream.yml`:

```yaml
name: Sync Upstream

on:
  schedule:
    - cron: '0 6 * * *'  # Daily at 6 AM UTC
  workflow_dispatch:      # Manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: dev
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Setup Git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - name: Add Upstream
        run: |
          git remote add upstream https://github.com/sst/opencode.git
          git fetch upstream

      - name: Check for Conflicts in Target Files
        id: conflict-check
        run: |
          # Files we care about for merge conflicts
          TARGET_FILES=(
            "packages/opencode/src/storage/storage.ts"
            "packages/opencode/src/auth/index.ts"
            "packages/opencode/src/mcp/auth.ts"
            "packages/opencode/src/config/config.ts"
          )
          
          # Get list of changed files in upstream
          CHANGED=$(git diff --name-only dev upstream/dev)
          
          CONFLICTS=""
          for file in "${TARGET_FILES[@]}"; do
            if echo "$CHANGED" | grep -q "$file"; then
              CONFLICTS="$CONFLICTS $file"
            fi
          done
          
          if [ -n "$CONFLICTS" ]; then
            echo "conflicts=true" >> $GITHUB_OUTPUT
            echo "files=$CONFLICTS" >> $GITHUB_OUTPUT
          else
            echo "conflicts=false" >> $GITHUB_OUTPUT
          fi

      - name: Merge Upstream (if no conflicts in target files)
        if: steps.conflict-check.outputs.conflicts == 'false'
        run: |
          git merge upstream/dev --no-edit
          git push origin dev

      - name: Create Issue on Conflict
        if: steps.conflict-check.outputs.conflicts == 'true'
        uses: actions/github-script@v7
        with:
          script: |
            const files = '${{ steps.conflict-check.outputs.files }}';
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '⚠️ Upstream sync: Target files changed',
              body: `The following target files have changes in upstream that need manual review:\n\n${files.trim().split(' ').map(f => '- \`' + f + '\`').join('\n')}\n\nThese are files we modify for MongoDB shims. Manual merge required.`,
              labels: ['upstream-sync', 'needs-review']
            });
```

---

## Files to Delete

```bash
# Run from repo root
rm .github/workflows/deploy.yml
rm .github/workflows/stats.yml
rm .github/workflows/notify-discord.yml
rm .github/workflows/publish.yml
rm .github/workflows/publish-github-action.yml
rm .github/workflows/publish-vscode.yml
rm .github/workflows/sync-zed-extension.yml
rm .github/workflows/update-nix-hashes.yml
rm .github/workflows/auto-label-tui.yml
rm .github/workflows/duplicate-issues.yml
rm .github/workflows/review.yml
rm .github/workflows/opencode.yml
```

---

## Execution Checklist

- [ ] Add upstream remote
- [ ] Fetch upstream
- [ ] Create `main` branch from current `dev`
- [ ] Push `main` to origin
- [ ] Create `mongo-shim` branch from `main`
- [ ] Push `mongo-shim` to origin
- [ ] Set `main` as default branch on GitHub
- [ ] Delete unnecessary workflows (list above)
- [ ] Create `sync-upstream.yml` workflow
- [ ] Commit cleanup changes to `main`
- [ ] Verify `test.yml` and `typecheck.yml` still work

---

## After Setup

Once this is done, we're ready to:
1. Work on `mongo-shim` branch for our 4-file changes
2. Keep `dev` synced with upstream automatically
3. Merge tested changes from `dev` → `main` periodically
4. Rebase `mongo-shim` onto `main` after merges

---

## Target Files (Reference)

These are the only files we'll modify for MongoDB:

```
packages/opencode/src/storage/storage.ts   # Storage abstraction
packages/opencode/src/auth/index.ts        # Auth token storage (4 functions)
packages/opencode/src/mcp/auth.ts          # MCP OAuth storage (7 functions)
packages/opencode/src/config/config.ts     # Config loading
```

Plus new files we'll add:
```
packages/opencode/src/storage/mongo.ts     # MongoDB adapter (NEW)
packages/opencode/src/migrations/          # Bootstrap migrations (NEW)
```
