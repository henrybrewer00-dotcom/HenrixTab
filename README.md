# HenrixTab

Run multiple AI coding agents (Claude Code, Codex, OpenRouter, custom) in parallel — all in one window.

Built on and inspired by [FleetCode](https://github.com/built-by-as/FleetCode) by [@built-by-as](https://github.com/built-by-as).

---

## Features

- **Presets** — Save configurations with multiple terminal slots, pick agents for each, and launch them all at once
- **Grid View** — See all your terminals side by side in one window. Double-click to expand one, drag to reorder
- **Folders** — Preset sessions are grouped into collapsible folders in the sidebar. Delete the folder to kill them all
- **Yolo Mode** — Launch all agents with `--dangerously-skip-permissions` in one click
- **Keyboard Shortcuts** — `Cmd+1-9` switch tabs/cells, `Cmd+G` toggle grid, `Cmd+B` toggle sidebar
- **Agents** — Claude Code, Codex, OpenRouter, or any custom CLI command
- **Git Worktrees** — Each session gets its own isolated branch
- **Collapsible Sidebar** — Hide it for more terminal space
- **Themes** — Dracula, One Dark, Solarized, GitHub Dark, macOS, and more
- **MCP Server Management** — Add/remove MCP servers per session
- **Session Persistence** — Sessions survive app restarts

---

## Install

### Prerequisites

- **Node.js** 18+ — [download here](https://nodejs.org/)
- **Git**
- **Claude Code** and/or **Codex** CLI installed globally

### Steps

```bash
git clone https://github.com/henrybrewer00-dotcom/HenrixTab.git
cd HenrixTab
npm install
npx electron-rebuild
npm start
```

### Build a .app / .dmg (macOS)

```bash
npm run dist
```

The built app will be in the `dist/` folder.

---

## Troubleshooting

### "App is damaged" / Quarantine warning (macOS)

macOS quarantines apps downloaded from the internet or built locally. To fix:

```bash
xattr -cr /path/to/HenrixTab.app
```

If running from source and you get a quarantine error on `node-pty`:

```bash
xattr -cr node_modules/node-pty
npx electron-rebuild
```

### `node-pty` compiled against a different Node.js version

This means your Node.js version doesn't match Electron's native module version. Fix:

```bash
npx electron-rebuild
```

### Blank white grid cells

If grid cells appear blank when entering grid view, resize the window to force a re-fit. You can also exit grid and re-enter via the folder's **Grid** button in the sidebar.

### `claude` or `codex` command not found

Install the CLI tools globally first:

```bash
# Claude Code
npm install -g @anthropic-ai/claude-code

# Codex (OpenAI)
npm install -g @openai/codex
```

### App won't start / crashes on launch

Nuclear option — clean reinstall:

```bash
rm -rf node_modules dist
npm install
npx electron-rebuild
npm start
```

### Claude Code reading/writing files from wrong directory

Disable auto IDE connection in Claude Code settings:

```bash
claude config
```

Set `autoConnectToIde` to `false` so Claude operates within the correct worktree directory.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+1` through `Cmd+9` | Switch to Nth tab or focus Nth grid cell |
| `Cmd+G` | Toggle grid view for current session group |
| `Cmd+B` | Toggle sidebar |

On first use it will ask for permission. You can enable/disable shortcuts in Settings.

---

## Credits

Inspired by and built on top of [FleetCode](https://github.com/built-by-as/FleetCode) by [@built-by-as](https://github.com/built-by-as). Original concept: a lightweight control pane to run CLI coding agents in parallel with git worktree isolation.

HenrixTab adds presets, grid view, drag-to-reorder, expand-to-focus, sidebar folders, keyboard shortcuts, and a revamped UI.

---

## License

ISC
