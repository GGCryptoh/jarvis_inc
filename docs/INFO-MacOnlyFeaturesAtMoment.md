# Mac-Only Features (Current State)

Some features in the setup/auto-update pipeline currently only work on macOS. This document tracks them so users on Windows and Linux know what to expect.

## Mac-Specific Features

| Feature | File | Lines | Impact on Other OS |
|---------|------|-------|--------------------|
| `open -a Docker` auto-launch | `docker/setup.mjs` | 218, 274, 314 | **Broken** — Windows/Linux users must start Docker manually |
| Launch Agent (reboot persistence) | `docker/setup.mjs` | 924-1000 | **Missing** — no systemd (Linux) or Task Scheduler (Windows) equivalent yet |
| Screen Sharing detection | `docker/setup.mjs` | 168-183 | Graceful skip — `isRemoteSession()` returns `false` on non-Mac, SSH check still works |
| Homebrew Docker install | `docker/setup.mjs` | 187-188, 215-233 | Falls back — Linux gets `curl` script, Windows gets manual download link |
| `crontab` for auto-updates | `auto-update.mjs` | 64-94 | **Broken on Windows** — no native cron. Works on Linux. |
| Hosts file auto-edit via `sudo tee` | `docker/setup.mjs` | 906 | Works on Linux. Windows shows manual instructions (line 917-919). |
| `open -a Docker` in help text | `src/App.tsx` | 68 | Shows macOS-specific command to all platforms |

## What Works Everywhere

These core features are fully cross-platform:

- **Docker Compose stack** — all Supabase services, Caddy, gateway, sidecar
- **Vite dev server** — `npm run dev`
- **The entire dashboard app** — React SPA runs in any browser
- **Setup script** — `npm run jarvis` works on all platforms (Docker install step differs)
- **Supabase** — self-hosted Postgres, PostgREST, Realtime, Auth
- **CEO sidecar** — Docker container, runs identically everywhere
- **Skills execution** — browser-side + gateway-side
- **Auto-update check** — `npm run update` works everywhere (only the cron install is Mac/Linux)

## Planned Cross-Platform Support

| Feature | Linux Plan | Windows Plan |
|---------|-----------|--------------|
| Reboot persistence | systemd service unit | Task Scheduler or Startup folder |
| Docker auto-start | `systemctl start docker` | Docker Desktop auto-start setting |
| Auto-update scheduling | crontab (already works) | Task Scheduler XML |
