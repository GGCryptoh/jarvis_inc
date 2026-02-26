# PLAN: Marketplace Git Submodule Migration

## Problem

The marketplace (Vercel/Neon server) lives inside the `jarvis_inc` monorepo as a plain subdirectory. Anyone cloning the repo to run their own Jarvis instance gets the full marketplace server code + DB schema, which they don't need and shouldn't have.

## Current State

- `marketplace/` is a regular directory in the monorepo — same git history, same pushes
- `.gitmodules` only has `skills_repo` as a submodule
- Vercel project `marketplace` is linked to `GGCryptoh/jarvis_inc` with root directory override set to `marketplace/`
- Vercel auto-deploys on every push to `main` (even non-marketplace changes trigger a build)

## Proposed: Git Submodule (matches skills_repo pattern)

### Step 1: Create Separate Repo

- Repo already created: `https://github.com/GGCryptoh/jarvis_inc_marketplace.git` (private)
- Push current `marketplace/` contents as initial commit

### Step 2: Remove from Monorepo

- `git rm -r marketplace/` (removes from tracking, keeps local)
- Commit the removal

### Step 3: Add as Submodule

```bash
git submodule add https://github.com/GGCryptoh/jarvis_inc_marketplace.git marketplace
git commit -m "chore: Add marketplace as git submodule"
```

### Step 4: Update Vercel

- Change Vercel project `marketplace` to watch `GGCryptoh/jarvis_inc_marketplace` directly
- Remove the root directory override (no longer needed — repo root IS the Next.js app)
- Only marketplace commits trigger marketplace deploys (no more spurious builds)

### Step 5: Dev Workflow

```bash
# Make marketplace changes
cd marketplace
git add . && git commit -m "fix: whatever" && git push

# Bump submodule ref in parent (optional, for version tracking)
cd ..
git add marketplace
git commit -m "chore: Update marketplace submodule ref"
git push
```

## Benefits

- **Cloners** don't get marketplace code (submodule not initialized by default)
- **Vercel** only rebuilds on actual marketplace changes
- **Consistent** with `skills_repo` submodule pattern already in use
- **Clean separation** between client (Jarvis app) and infrastructure (marketplace server)

## Alternatives Considered

| Approach | Pros | Cons |
|---|---|---|
| `.gitignore` marketplace/ | Simplest | Need separate repo anyway, lose monorepo convenience |
| Keep as-is | Zero effort | Cloners get server code, Vercel rebuilds on every push |
| **Submodule (chosen)** | Clean, consistent | Submodule ref bumps on changes |

## When

Not urgent — do this during a quiet maintenance window. The marketplace works fine as-is. This is a cleanup/hygiene task.
