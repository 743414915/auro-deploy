# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Auto Deploy is a dual-mode frontend deployment tool: **Electron GUI** (Vue 3 + TypeScript) and **CLI** (Node.js). It clones a Git repo, runs a build command, compresses artifacts, and deploys via SSH/SFTP to a production server. Deployment is direct overwrite with automatic `.backup/` tarball snapshots for rollback.

## Build & Run

```bash
# Development (GUI hot-reload)
npm run dev                    # Starts Vite + Electron concurrently

# Production build
npm run build                  # Vite build → dist/
npm run electron:pack          # Full: vite build + electron-rebuild + electron-builder → release/win-unpacked/

# CLI mode
node src/cli.js deploy --config ./deploy.config.json
node src/cli.js deploy --repo 0 --branch release/v2.0
node src/cli.js deploy --tag v1.5.0
node src/cli.js list --repo 0
node src/cli.js rollback --version v20260520_143000_abc12345
```

**Environment constraint**: This project targets Node 18. Electron 28 is used (last major version compatible with Node 18). Vite is pinned to v5, electron-builder to v23.

**China network mirror**: `electron:pack` must use `ELECTRON_MIRROR` and `ELECTRON_BUILDER_BINARIES_MIRROR` pointing to `npmmirror.com`. The electron-builder target is `dir` (raw unpacked directory, no installer) with `sign: null` because `winCodeSign` download from GitHub is blocked.

## Architecture

```
electron/main.js          — Main process: window management, all IPC handlers
electron/preload.js       — contextBridge API exposed to renderer
src/main.ts               — Vue 3 entry point
src/App.vue               — Root component: tab bar (Deploy / Versions / Settings)
                            Uses v-show (not v-if) to preserve component state across tabs
src/components/
  DeployView.vue          — Repo selector, branch/tag combobox, simulate + deploy buttons,
                            progress steps + log panel + result banner
  VersionsView.vue        — Repo selector, backup version list, rollback action
  SettingsView.vue        — Repo tab bar (add/remove/rename), full config form,
                            test buttons (Git/SSH/path), preDeployFiles UI, log panel
src/config.js             — Load/validate deploy.config.json, getRepo(), auto-migrate old format
src/git.js                — Git clone, checkout, testConnection, fetchBranches, fetchTags
                            Submodule SSH→HTTPS rewrite via .gitmodules editing
src/ssh.js                — SSHClient class (password or privateKey auth, readyTimeout)
src/build.js              — Run build command via spawn with real-time log streaming
src/deploy.js             — CLI deploy orchestrator (uses ora/chalk), tar-based compression + backup
src/rollback.js           — CLI rollback + list backups
src/cli.js                — Commander CLI entry with --repo flag
```

**Key boundary**: `src/*.js` modules are CommonJS (shared by CLI and Electron main process). Vue components in `src/components/` are ESM/TypeScript (Vite-compiled into `dist/`).

## IPC Protocol

All IPC uses `ipcMain.handle` / `ipcRenderer.invoke` with `contextIsolation: true`.
All handlers accept `repoIndex` parameter for multi-repo support.

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `config:load/save/getPath/selectFile` | r→m | Config CRUD |
| `config:test` | r→m | Test SSH connectivity |
| `git:test` | r→m | Test Git connectivity (15s timeout) |
| `git:branches` | r→m | Fetch remote branches via ls-remote |
| `git:tags` | r→m | Fetch remote tags via ls-remote |
| `deploy:testPath` | r→m | Test remote deploy path exists/writable |
| `deploy:start` | r→m | Full deploy pipeline (remote) |
| `deploy:simulate` | r→m | Local simulation deploy (no SSH) |
| `versions:list` | r→m | List deployed backups on remote |
| `rollback:execute` | r→m | Rollback by extracting backup tarball |
| `deploy:event` | m→r | Deploy progress streaming (log + progress + done) |

**Important**: Test handlers (`git:test`, `config:test`, `deploy:testPath`) return `{ success, error, logs }` — logs are collected in the main process and returned in the response. Do NOT use `event.sender.send()` inside `ipcMain.handle()` to stream logs; it does not deliver while the invoke is pending.

Deploy handlers MUST `return { success, info }` explicitly — the renderer reads the result from the promise return value (not just the `done` event).

## Config File Format

`deploy.config.json` is placed next to the EXE (resolved via `app.getPath('exe')`). Auto-created with empty template on first launch.

Multi-repo array format:

```json
{
  "repos": [
    {
      "name": "前端项目",
      "git": {
        "url": "https://gitee.com/user/repo.git",
        "branch": "main",
        "cloneDir": "./.deploy-cache",
        "username": "",
        "token": ""
      },
      "build": { "command": "npm install && npm run build", "outputDir": "dist" },
      "server": {
        "host": "192.168.1.100", "port": 22, "username": "root",
        "password": "",
        "privateKey": "~/.ssh/id_rsa"
      },
      "deploy": {
        "remotePath": "/var/www/myapp",
        "backupKeep": 5,
        "preDeployCommands": [],
        "postDeployCommands": ["nginx -s reload"],
        "preDeployFiles": [
          { "path": "config.js", "content": "window.API_URL = '...'" }
        ]
      }
    }
  ]
}
```

Server auth: provide `password` OR `privateKey`, not both. If both set, privateKey takes priority.
Git auth: for SSH URLs, leave username/token empty. For HTTPS URLs, fill in both. Token is embedded into the URL.
Submodules: SSH URLs in `.gitmodules` are rewritten to HTTPS automatically after clone.

## Deployment Flow

```
Git clone (clean each time) → Checkout branch/tag → Submodule sync+update
→ Run build command (spawn, streaming stdout to log)
→ Write preDeployFiles overrides into build output
→ Compress build output with system tar
→ SSH connect → Backup existing files to .backup/vXXX.tar.gz
→ Upload tarball → Extract to remotePath (overwrite)
→ Pre/post deploy commands → Cleanup old backups
```

### Server directory structure:

```
/var/www/myapp/
├── .backup/                          ← Hidden, preserved across deploys (rm -rf * skips dotfiles)
│   ├── v20260521_143000_abc.tar.gz
│   └── v20260520_120000_def.tar.gz
├── index.html
└── assets/
```

### Rollback flow:

```
SSH connect → rm -rf remotePath/* → tar -xzf .backup/vXXX.tar.gz -C remotePath → post-deploy commands
```

## Simulation Deploy

Local dry-run that mirrors real deploy but skips SSH: `./.deploy-simulate/<repo-name>/`. Compress uses system `tar` (not `archiver` which is ESM-only and incompatible with Electron main process). Progress step names differ (6 steps vs 9 for real deploy).

## Notable Constraints

- **`archiver` v8 is ESM-only**: removed from `electron/main.js`. Compression uses `spawn('tar', ...)` instead. `deploy.js` (CLI-only) still uses archiver since Node.js CLI handles ESM interop.
- **`chalk` v5 is ESM-only**: removed from `build.js`, `git.js`, `ssh.js`. Kept only in `deploy.js` and `rollback.js` (CLI-only).
- **Git test timeout**: uses `spawn()` with a manual 15s timer + `taskkill /F /T /PID` on Windows.
- **SSH timeout**: `readyTimeout: 15000` in ssh2 connection options.
- **`electron-builder` config**: `win.target: "dir"`, `win.sign: null` — skips code signing to avoid winCodeSign download issues.
- **Files glob**: `src/**/*.js` — only .js files are included in the asar. Vue/TS files are compiled by Vite into `dist/` first.
- **No native `.node` modules**: `ssh2` is pure JS. `electron-rebuild` still runs as a safety step.
- **Tab state**: `v-show` (not `v-if`) in App.vue preserves component state. DeployView/VersionsView watch `visible` prop to reload data on tab switch.
- **Result banner**: Set from promise return value (`res.info`), not from `done` event (race condition with listener removal).
