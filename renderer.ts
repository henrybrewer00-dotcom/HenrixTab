import {FitAddon} from "@xterm/addon-fit";
import {ipcRenderer} from "electron";
import {Terminal} from "xterm";
import {PersistedSession, PresetSlot, SessionConfig, SessionPreset, SessionType} from "./types";
import {isClaudeSessionReady} from "./terminal-utils";
import * as path from "path";

interface Session {
  id: string;
  terminal: Terminal | null;
  fitAddon: FitAddon | null;
  element: HTMLDivElement | null;
  name: string;
  config: SessionConfig;
  worktreePath?: string;
  hasActivePty: boolean;
  presetGroupId?: string;
}

interface PresetGroup {
  id: string;
  name: string;
  sessionIds: string[];
  collapsed: boolean;
  slots: PresetSlot[];
}

interface McpServer {
  name: string;
  connected?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  type?: "stdio" | "sse";
}

interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  theme: string; // Theme preset name
  cursorBlink: boolean;
  worktreeDir: string;
}

interface ThemeColors {
  background: string;
  foreground: string;
  cursor?: string;
  cursorAccent?: string;
  selection?: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
}

// Theme presets
const THEME_PRESETS: Record<string, ThemeColors> = {
  "macos-light": {
    background: "#ffffff",
    foreground: "#000000",
    cursor: "#000000",
    selection: "#b4d5fe",
    black: "#000000",
    red: "#c23621",
    green: "#25bc24",
    yellow: "#adad27",
    blue: "#492ee1",
    magenta: "#d338d3",
    cyan: "#33bbc8",
    white: "#cbcccd",
    brightBlack: "#818383",
    brightRed: "#fc391f",
    brightGreen: "#31e722",
    brightYellow: "#eaec23",
    brightBlue: "#5833ff",
    brightMagenta: "#f935f8",
    brightCyan: "#14f0f0",
    brightWhite: "#e9ebeb",
  },
  "macos-dark": {
    background: "#000000",
    foreground: "#ffffff",
    cursor: "#ffffff",
    selection: "#4d4d4d",
    black: "#000000",
    red: "#c23621",
    green: "#25bc24",
    yellow: "#adad27",
    blue: "#492ee1",
    magenta: "#d338d3",
    cyan: "#33bbc8",
    white: "#cbcccd",
    brightBlack: "#818383",
    brightRed: "#fc391f",
    brightGreen: "#31e722",
    brightYellow: "#eaec23",
    brightBlue: "#5833ff",
    brightMagenta: "#f935f8",
    brightCyan: "#14f0f0",
    brightWhite: "#e9ebeb",
  },
  "solarized-dark": {
    background: "#002b36",
    foreground: "#839496",
    cursor: "#839496",
    selection: "#073642",
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#002b36",
    brightRed: "#cb4b16",
    brightGreen: "#586e75",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3",
  },
  "dracula": {
    background: "#282a36",
    foreground: "#f8f8f2",
    cursor: "#f8f8f2",
    selection: "#44475a",
    black: "#21222c",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#bd93f9",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#f8f8f2",
    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff",
  },
  "one-dark": {
    background: "#282c34",
    foreground: "#abb2bf",
    cursor: "#528bff",
    selection: "#3e4451",
    black: "#282c34",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#abb2bf",
    brightBlack: "#5c6370",
    brightRed: "#e06c75",
    brightGreen: "#98c379",
    brightYellow: "#e5c07b",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff",
  },
  "github-dark": {
    background: "#0d1117",
    foreground: "#c9d1d9",
    cursor: "#58a6ff",
    selection: "#163c61",
    black: "#484f58",
    red: "#ff7b72",
    green: "#3fb950",
    yellow: "#d29922",
    blue: "#58a6ff",
    magenta: "#bc8cff",
    cyan: "#39c5cf",
    white: "#b1bac4",
    brightBlack: "#6e7681",
    brightRed: "#ffa198",
    brightGreen: "#56d364",
    brightYellow: "#e3b341",
    brightBlue: "#79c0ff",
    brightMagenta: "#d2a8ff",
    brightCyan: "#56d4dd",
    brightWhite: "#f0f6fc",
  },
};

// Detect system theme
function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// Default settings - macOS Terminal matching system theme
const DEFAULT_SETTINGS: TerminalSettings = {
  fontFamily: "Menlo, Monaco, 'Courier New', monospace",
  fontSize: 11,
  theme: getSystemTheme() === "dark" ? "macos-dark" : "macos-light",
  cursorBlink: false,
  worktreeDir: require("path").join(require("os").homedir(), "worktrees"),
};

const sessions = new Map<string, Session>();
let activeSessionId: string | null = null;
let mcpServers: McpServer[] = [];
let mcpPollerActive = false;
let terminalSettings: TerminalSettings = { ...DEFAULT_SETTINGS };

// Track activity timers for each session
const activityTimers = new Map<string, NodeJS.Timeout>();

// Grid view state
let gridViewActive = false;
let gridSessionIds: string[] = [];
let focusedGridCell: string | null = null;
let gridLaunching = false; // true while preset is creating sessions
let activeGridGroupId: string | null = null; // which group is currently in grid view

// Preset group tracking
const presetGroups = new Map<string, PresetGroup>();

async function loadAndPopulateBranches(
  directory: string,
  selectedBranch?: string
): Promise<void> {
  const branches = await ipcRenderer.invoke("get-branches", directory);
  existingBranches = branches;
  parentBranchSelect.innerHTML = "";

  if (branches.length === 0) {
    parentBranchSelect.innerHTML = '<option value="">No git repository found</option>';
  } else {
    branches.forEach((branch: string) => {
      const option = document.createElement("option");
      option.value = branch;
      option.textContent = branch;
      if (branch === selectedBranch) {
        option.selected = true;
      }
      parentBranchSelect.appendChild(option);
    });
  }
}

function createTerminalUI(sessionId: string, targetContainer?: HTMLElement) {
  const themeColors = THEME_PRESETS[terminalSettings.theme] || THEME_PRESETS["macos-dark"];

  const term = new Terminal({
    cursorBlink: terminalSettings.cursorBlink,
    fontSize: targetContainer ? Math.max(9, terminalSettings.fontSize - 2) : terminalSettings.fontSize,
    fontFamily: terminalSettings.fontFamily,
    theme: themeColors,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  const sessionElement = document.createElement("div");
  sessionElement.className = targetContainer ? "grid-cell-terminal" : "session-wrapper";
  sessionElement.id = `session-${sessionId}`;

  const container = targetContainer || document.getElementById("session-container");
  if (container) {
    container.appendChild(sessionElement);
  }

  term.open(sessionElement);

  term.onData((data) => {
    ipcRenderer.send("session-input", sessionId, data);
  });

  // Listen for bell character to mark unread activity
  term.onBell(() => {
    if (activeSessionId !== sessionId) {
      markSessionAsUnread(sessionId);
    }
  });

  const resizeHandler = () => {
    if (gridViewActive && gridSessionIds.includes(sessionId)) {
      // In grid mode, fit all grid terminals
      try {
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          ipcRenderer.send("session-resize", sessionId, dims.cols, dims.rows);
        }
      } catch (_e) { /* terminal may not be visible yet */ }
    } else if (activeSessionId === sessionId) {
      const proposedDimensions = fitAddon.proposeDimensions();
      if (proposedDimensions) {
        fitAddon.fit();
        ipcRenderer.send("session-resize", sessionId, proposedDimensions.cols, proposedDimensions.rows);
      }
    }
  };
  window.addEventListener("resize", resizeHandler);

  return { terminal: term, fitAddon, element: sessionElement };
}

function addSession(persistedSession: PersistedSession, hasActivePty: boolean) {
  const groupId = persistedSession.config.presetGroupId;
  const session: Session = {
    id: persistedSession.id,
    terminal: null,
    fitAddon: null,
    element: null,
    name: persistedSession.name,
    config: persistedSession.config,
    worktreePath: persistedSession.worktreePath,
    hasActivePty,
    presetGroupId: groupId,
  };

  sessions.set(persistedSession.id, session);

  if (groupId) {
    // Add to group — sidebar item goes inside the folder
    const group = presetGroups.get(groupId);
    if (group) {
      if (!group.sessionIds.includes(persistedSession.id)) {
        group.sessionIds.push(persistedSession.id);
      }
    } else {
      // Group not created yet — create it on the fly
      const newGroup: PresetGroup = {
        id: groupId,
        name: persistedSession.config.presetGroupName || "Preset Group",
        sessionIds: [persistedSession.id],
        collapsed: false,
        slots: [],
      };
      presetGroups.set(groupId, newGroup);
      renderSidebarFolder(newGroup);
    }
    addToSidebarInFolder(persistedSession.id, persistedSession.name, hasActivePty, groupId);
  } else {
    // Normal session — add directly to sidebar
    addToSidebar(persistedSession.id, persistedSession.name, hasActivePty, persistedSession.config);
  }

  // Only add tab if terminal is active and NOT in grid mode
  if (hasActivePty && !gridLaunching) {
    addTab(persistedSession.id, persistedSession.name);
  }

  return session;
}

function activateSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return;

  // If terminal UI doesn't exist yet, create it
  if (!session.terminal) {
    const ui = createTerminalUI(sessionId);
    session.terminal = ui.terminal;
    session.fitAddon = ui.fitAddon;
    session.element = ui.element;
  }

  session.hasActivePty = true;
  updateSessionState(sessionId, true);

  // Add tab if it doesn't exist
  if (!document.getElementById(`tab-${sessionId}`)) {
    addTab(sessionId, session.name);
  }

  // Switch to this session
  switchToSession(sessionId);
}

function updateSessionState(sessionId: string, isActive: boolean) {
  const sidebarItem = document.getElementById(`sidebar-${sessionId}`);
  const indicator = sidebarItem?.querySelector(".session-indicator");

  if (indicator) {
    if (isActive) {
      indicator.classList.add("active");
    } else {
      indicator.classList.remove("active");
    }
  }
}

// === Sidebar Folder (Preset Group) Functions ===

function renderSidebarFolder(group: PresetGroup) {
  const list = document.getElementById("session-list");
  if (!list) return;

  // Don't duplicate
  if (document.getElementById(`folder-${group.id}`)) return;

  const folder = document.createElement("div");
  folder.id = `folder-${group.id}`;
  folder.className = "sidebar-folder";

  const header = document.createElement("div");
  header.className = "sidebar-folder-header";
  header.innerHTML = `
    <div class="flex items-center space-x-2 flex-1 min-w-0 cursor-pointer folder-toggle" data-id="${group.id}">
      <span class="folder-arrow ${group.collapsed ? '' : 'open'}">&#9654;</span>
      <span class="truncate text-sm text-gray-200 font-medium">${group.name}</span>
      <span class="text-xs text-gray-500">(${group.sessionIds.length})</span>
    </div>
    <div class="flex items-center space-x-1">
      <button class="folder-grid-btn section-add-btn" data-id="${group.id}" title="Grid View" style="font-size: 9px; width: auto; padding: 0 3px;">Grid</button>
      <button class="folder-delete-btn section-add-btn" data-id="${group.id}" title="Delete All" style="color: #f87171;">&times;</button>
    </div>
  `;

  const children = document.createElement("div");
  children.className = "sidebar-folder-children";
  children.id = `folder-children-${group.id}`;
  if (group.collapsed) {
    children.style.display = "none";
  }

  folder.appendChild(header);
  folder.appendChild(children);
  list.appendChild(folder);

  // Toggle collapse
  header.querySelector(".folder-toggle")?.addEventListener("click", () => {
    group.collapsed = !group.collapsed;
    const arrow = header.querySelector(".folder-arrow");
    if (group.collapsed) {
      children.style.display = "none";
      arrow?.classList.remove("open");
    } else {
      children.style.display = "";
      arrow?.classList.add("open");
    }
  });

  // Grid view button
  header.querySelector(".folder-grid-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    enterGridViewForGroup(group.id);
  });

  // Delete all button
  header.querySelector(".folder-delete-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!confirm(`Delete all sessions in "${group.name}"?`)) return;
    deleteGroup(group.id);
  });
}

function addToSidebarInFolder(sessionId: string, name: string, hasActivePty: boolean, groupId: string) {
  const container = document.getElementById(`folder-children-${groupId}`);
  if (!container) return;

  const item = document.createElement("div");
  item.id = `sidebar-${sessionId}`;
  item.className = "session-list-item folder-session-item";
  item.innerHTML = `
    <div class="flex items-center space-x-2 flex-1 session-name-container">
      <span class="session-indicator ${hasActivePty ? 'active' : ''}"></span>
      <span class="truncate session-name-text text-xs" data-id="${sessionId}">${name}</span>
    </div>
  `;

  item.addEventListener("click", () => {
    handleSessionClick(sessionId);
  });

  container.appendChild(item);
}

function updateFolderCount(groupId: string) {
  const folder = document.getElementById(`folder-${groupId}`);
  if (!folder) return;
  const group = presetGroups.get(groupId);
  if (!group) return;
  const countEl = folder.querySelector(".sidebar-folder-header .text-xs.text-gray-500");
  if (countEl) {
    countEl.textContent = `(${group.sessionIds.length})`;
  }
}

function deleteGroup(groupId: string) {
  const group = presetGroups.get(groupId);
  if (!group) return;

  // If in grid view for this group, exit first
  if (gridViewActive && activeGridGroupId === groupId) {
    gridViewActive = false;
    document.getElementById("tabs")!.style.display = "";
    document.getElementById("session-container")!.style.display = "";
    const gridView = document.getElementById("grid-view")!;
    gridView.style.display = "none";
    gridView.classList.add("hidden");
    document.getElementById("grid-cells")!.innerHTML = "";
    gridSessionIds = [];
    focusedGridCell = null;
    activeGridGroupId = null;
  }

  // Close all sessions in group from UI
  group.sessionIds.forEach(sid => {
    const session = sessions.get(sid);
    if (session) {
      if (session.element) session.element.remove();
      if (session.terminal) session.terminal.dispose();
      document.getElementById(`tab-${sid}`)?.remove();
      document.getElementById(`sidebar-${sid}`)?.remove();
      sessions.delete(sid);
    }
  });

  // Remove folder from sidebar
  document.getElementById(`folder-${groupId}`)?.remove();

  // Tell main process to delete all sessions in this group
  ipcRenderer.send("delete-group", groupId);

  presetGroups.delete(groupId);
}

function enterGridViewForGroup(groupId: string) {
  const group = presetGroups.get(groupId);
  if (!group || group.sessionIds.length === 0) return;

  // Check that sessions have active PTYs — reopen if needed
  const needsReopen: string[] = [];
  group.sessionIds.forEach(sid => {
    const session = sessions.get(sid);
    if (session && !session.hasActivePty) {
      needsReopen.push(sid);
    }
  });

  activeGridGroupId = groupId;
  gridViewActive = true;
  gridSessionIds = [...group.sessionIds];
  focusedGridCell = null;

  // Hide normal view, show grid
  document.getElementById("tabs")!.style.display = "none";
  document.getElementById("session-container")!.style.display = "none";
  const gridView = document.getElementById("grid-view")!;
  gridView.style.display = "flex";
  gridView.style.flexDirection = "column";
  gridView.style.flex = "1";
  gridView.classList.remove("hidden");

  document.getElementById("grid-title")!.textContent = `${group.name} — ${group.sessionIds.length} terminals`;

  const cols = Math.ceil(Math.sqrt(group.sessionIds.length));
  const rows = Math.ceil(group.sessionIds.length / cols);
  const gridCells = document.getElementById("grid-cells")!;
  gridCells.innerHTML = "";
  gridCells.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  gridCells.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

  // First pass: clean up all existing terminals and create grid cell containers
  group.sessionIds.forEach((sid, index) => {
    const session = sessions.get(sid);
    if (!session) return;

    // Clean up existing terminal
    if (session.element) session.element.remove();
    if (session.terminal) session.terminal.dispose();
    session.terminal = null;
    session.fitAddon = null;
    session.element = null;

    // Remove tab
    document.getElementById(`tab-${sid}`)?.remove();

    // Create empty grid cell (terminal created after layout)
    const agentType = session.config.codingAgent as PresetSlot["agent"];
    const slot: PresetSlot = { agent: agentType, customCommand: session.config.customCommand };
    const cell = createGridCell(sid, slot, index);
    gridCells.appendChild(cell);
  });

  // Wait for the grid to be laid out, then create terminals inside cells
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      group.sessionIds.forEach((sid) => {
        const session = sessions.get(sid);
        if (!session) return;

        const cell = document.getElementById(`grid-cell-${sid}`);
        if (!cell) return;

        // Create terminal inside grid cell
        const ui = createTerminalUI(sid, cell);
        session.terminal = ui.terminal;
        session.fitAddon = ui.fitAddon;
        session.element = ui.element;

        // Reopen PTY if needed
        if (!session.hasActivePty) {
          ipcRenderer.send("reopen-session", sid);
          session.hasActivePty = true;
          updateSessionState(sid, true);
        }
      });

      // Fit all after terminals are created
      setTimeout(() => {
        fitAllGridTerminals();
        if (gridSessionIds.length > 0) {
          focusGridCell(gridSessionIds[0]);
        }
      }, 100);
    });
  });
}

// === End Folder Functions ===

function addToSidebar(sessionId: string, name: string, hasActivePty: boolean, config: SessionConfig) {
  const list = document.getElementById("session-list");
  if (!list) return;

  const isWorktree = config.sessionType === SessionType.WORKTREE;
  const applyMenuItem = isWorktree ? `<button class="session-menu-item apply-to-project-btn" data-id="${sessionId}">Apply to project</button>` : '';

  const item = document.createElement("div");
  item.id = `sidebar-${sessionId}`;
  item.className = "session-list-item";
  item.innerHTML = `
    <div class="flex items-center space-x-2 flex-1 session-name-container">
      <span class="session-indicator ${hasActivePty ? 'active' : ''}"></span>
      <span class="truncate session-name-text" data-id="${sessionId}">${name}</span>
      <input type="text" class="session-name-input hidden" data-id="${sessionId}" value="${name}" />
    </div>
    <div class="relative">
      <button class="session-menu-btn" data-id="${sessionId}" title="Session options">⋯</button>
      <div class="session-menu hidden" data-id="${sessionId}">
        <button class="session-menu-item rename-session-btn" data-id="${sessionId}">Rename</button>
        ${applyMenuItem}
        <button class="session-menu-item delete-session-btn" data-id="${sessionId}">Delete</button>
      </div>
    </div>
  `;

  // Handle input blur and enter key
  const nameInput = item.querySelector(".session-name-input") as HTMLInputElement;
  nameInput?.addEventListener("blur", () => {
    finishEditingSessionName(sessionId);
  });

  nameInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      finishEditingSessionName(sessionId);
    } else if (e.key === "Escape") {
      cancelEditingSessionName(sessionId);
    }
  });

  // Click on item to activate session
  item.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("session-menu-btn") &&
        !target.classList.contains("session-menu-item") &&
        !target.classList.contains("session-name-input") &&
        !target.closest(".session-menu")) {
      handleSessionClick(sessionId);
    }
  });

  // Menu button toggle
  const menuBtn = item.querySelector(".session-menu-btn");
  const menu = item.querySelector(".session-menu") as HTMLElement;

  menuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();

    // Close all other menus
    document.querySelectorAll(".session-menu").forEach(m => {
      if (m !== menu) m.classList.add("hidden");
    });

    // Toggle this menu
    menu?.classList.toggle("hidden");
  });

  // Rename button
  const renameBtn = item.querySelector(".rename-session-btn");
  renameBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    menu?.classList.add("hidden");
    startEditingSessionName(sessionId);
  });

  // Delete button
  const deleteBtn = item.querySelector(".delete-session-btn");
  deleteBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    menu?.classList.add("hidden");
    deleteSession(sessionId);
  });

  // Apply to project button (only for worktree sessions)
  const applyBtn = item.querySelector(".apply-to-project-btn");
  applyBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    menu?.classList.add("hidden");
    showApplyToProjectDialog(sessionId);
  });

  list.appendChild(item);
}

function startEditingSessionName(sessionId: string) {
  const sidebarItem = document.getElementById(`sidebar-${sessionId}`);
  const nameText = sidebarItem?.querySelector(".session-name-text");
  const nameInput = sidebarItem?.querySelector(".session-name-input") as HTMLInputElement;

  if (nameText && nameInput) {
    nameText.classList.add("hidden");
    nameInput.classList.remove("hidden");
    nameInput.focus();
    nameInput.select();
  }
}

function finishEditingSessionName(sessionId: string) {
  const sidebarItem = document.getElementById(`sidebar-${sessionId}`);
  const nameText = sidebarItem?.querySelector(".session-name-text");
  const nameInput = sidebarItem?.querySelector(".session-name-input") as HTMLInputElement;
  const session = sessions.get(sessionId);

  if (nameText && nameInput && session) {
    const newName = nameInput.value.trim();
    if (newName && newName !== session.name) {
      // Update session name
      session.name = newName;
      nameText.textContent = newName;

      // Update tab name if exists
      const tab = document.getElementById(`tab-${sessionId}`);
      const tabName = tab?.querySelector(".tab-name");
      if (tabName) {
        tabName.textContent = newName;
      }

      // Save to backend
      ipcRenderer.send("rename-session", sessionId, newName);
    }

    nameInput.classList.add("hidden");
    nameText.classList.remove("hidden");
  }
}

function cancelEditingSessionName(sessionId: string) {
  const sidebarItem = document.getElementById(`sidebar-${sessionId}`);
  const nameText = sidebarItem?.querySelector(".session-name-text");
  const nameInput = sidebarItem?.querySelector(".session-name-input") as HTMLInputElement;
  const session = sessions.get(sessionId);

  if (nameText && nameInput && session) {
    // Reset to original name
    nameInput.value = session.name;
    nameInput.classList.add("hidden");
    nameText.classList.remove("hidden");
  }
}

function handleSessionClick(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return;

  if (session.hasActivePty) {
    // Just switch to it
    switchToSession(sessionId);
  } else {
    // Reopen the session
    ipcRenderer.send("reopen-session", sessionId);
  }
}

function addTab(sessionId: string, name: string) {
  const tabsContainer = document.getElementById("tabs");
  if (!tabsContainer) return;

  const tab = document.createElement("div");
  tab.id = `tab-${sessionId}`;
  tab.className = "tab";
  tab.innerHTML = `
    <span class="unread-indicator"></span>
    <span class="tab-name">${name}</span>
    <button class="tab-close-btn" data-id="${sessionId}">×</button>
  `;

  tab.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).classList.contains("tab-close-btn")) {
      switchToSession(sessionId);
    }
  });

  const closeBtn = tab.querySelector(".tab-close-btn");
  closeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeSession(sessionId);
  });

  tabsContainer.appendChild(tab);
}

function markSessionAsUnread(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Add unread indicator to tab
  const tab = document.getElementById(`tab-${sessionId}`);
  if (tab) {
    tab.classList.add("unread");
  }
}

function clearUnreadStatus(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Remove unread indicator from tab
  const tab = document.getElementById(`tab-${sessionId}`);
  if (tab) {
    tab.classList.remove("unread");
  }
}

function markSessionActivity(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Add activity indicator to tab
  const tab = document.getElementById(`tab-${sessionId}`);
  if (tab) {
    tab.classList.add("activity");
    tab.classList.remove("unread");
  }

  // Clear any existing timer
  const existingTimer = activityTimers.get(sessionId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Set a new timer to remove activity after 1 second of no output
  const timer = setTimeout(() => {
    clearActivityStatus(sessionId);
  }, 1000);

  activityTimers.set(sessionId, timer);
}

function clearActivityStatus(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Remove activity indicator from tab, but keep unread if it's set
  const tab = document.getElementById(`tab-${sessionId}`);
  if (tab) {
    tab.classList.remove("activity");
    // If there's no unread status, transition to unread after activity ends
    if (!tab.classList.contains("unread") && activeSessionId !== sessionId) {
      tab.classList.add("unread");
    }
  }

  // Clear the timer
  activityTimers.delete(sessionId);
}

function switchToSession(sessionId: string) {
  // Hide all sessions
  sessions.forEach((session, id) => {
    if (session.element) {
      session.element.classList.remove("active");
    }
    document.getElementById(`tab-${id}`)?.classList.remove("active");
    document.getElementById(`sidebar-${id}`)?.classList.remove("active");
  });

  // Show active session
  const session = sessions.get(sessionId);
  if (session && session.element && session.terminal && session.fitAddon) {
    session.element.classList.add("active");
    document.getElementById(`tab-${sessionId}`)?.classList.add("active");
    document.getElementById(`sidebar-${sessionId}`)?.classList.add("active");
    activeSessionId = sessionId;

    // Show MCP section when a session is active
    const mcpSection = document.getElementById("mcp-section");
    if (mcpSection) {
      mcpSection.style.display = "block";
    }

    // Clear MCP servers from previous session and re-render
    mcpServers = [];
    renderMcpServers();

    // Load MCP servers for this session
    loadMcpServers();

    // Clear unread and activity status when switching to this session
    clearUnreadStatus(sessionId);
    clearActivityStatus(sessionId);

    // Focus and resize
    session.terminal.focus();
    // Dispatch resize event to trigger terminal resize
    window.dispatchEvent(new Event("resize"));
  }
}

function closeSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Remove terminal UI
  if (session.element) {
    session.element.remove();
  }
  if (session.terminal) {
    session.terminal.dispose();
  }

  // Remove tab
  document.getElementById(`tab-${sessionId}`)?.remove();

  // Update session state
  session.terminal = null;
  session.fitAddon = null;
  session.element = null;
  session.hasActivePty = false;

  // Update UI indicator
  updateSessionState(sessionId, false);

  // Close PTY in main process
  ipcRenderer.send("close-session", sessionId);

  // Switch to another active session
  if (activeSessionId === sessionId) {
    const activeSessions = Array.from(sessions.values()).filter(s => s.hasActivePty);
    if (activeSessions.length > 0) {
      switchToSession(activeSessions[0].id);
    } else {
      activeSessionId = null;
      // Hide MCP section when no sessions are active
      const mcpSection = document.getElementById("mcp-section");
      if (mcpSection) {
        mcpSection.style.display = "none";
      }
    }
  }
}

function deleteSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Confirm deletion with different message based on session type
  const isWorktree = session.config.sessionType === SessionType.WORKTREE;
  const message = isWorktree
    ? `Delete ${session.name}? This will remove the git worktree.`
    : `Delete ${session.name}? This will remove the session.`;

  if (!confirm(message)) {
    return;
  }

  // Remove from UI
  if (session.element) {
    session.element.remove();
  }
  if (session.terminal) {
    session.terminal.dispose();
  }
  document.getElementById(`tab-${sessionId}`)?.remove();
  document.getElementById(`sidebar-${sessionId}`)?.remove();

  // Remove from sessions map
  sessions.delete(sessionId);

  // Delete in main process (handles worktree removal)
  ipcRenderer.send("delete-session", sessionId);

  // Switch to another session
  if (activeSessionId === sessionId) {
    const remainingSessions = Array.from(sessions.values()).filter(s => s.hasActivePty);
    if (remainingSessions.length > 0) {
      switchToSession(remainingSessions[0].id);
    } else {
      activeSessionId = null;
      // Hide MCP section when no sessions are active
      const mcpSection = document.getElementById("mcp-section");
      if (mcpSection) {
        mcpSection.style.display = "none";
      }
    }
  }
}

function showApplyToProjectDialog(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return;

  const modal = document.getElementById("apply-to-project-modal");
  const branchName = document.getElementById("apply-branch-name");
  const parentBranch = document.getElementById("apply-parent-branch");

  if (branchName && session.config.branchName) {
    branchName.textContent = session.config.branchName;
  }
  if (parentBranch && session.config.parentBranch) {
    parentBranch.textContent = session.config.parentBranch;
  }

  // Store session ID for later use in confirm handler
  modal?.setAttribute("data-session-id", sessionId);

  modal?.classList.remove("hidden");
}

// Handle session output
ipcRenderer.on("session-output", (_event, sessionId: string, data: string) => {
  const session = sessions.get(sessionId);
  if (session && session.terminal) {
    // Filter out [3J (clear scrollback) to prevent viewport resets during interactive menus
    // Keep [2J (clear screen) which is needed for the menu redraw
    const filteredData = data.replace(/\x1b\[3J/g, '');

    session.terminal.write(filteredData);

    // Only mark as unread/activity if this is not the active session
    if (activeSessionId !== sessionId && session.hasActivePty) {
      // Show activity spinner while output is coming in
      markSessionActivity(sessionId);

      // Check if Claude session is ready for input
      if (isClaudeSessionReady(filteredData)) {
        // Clear activity timer and set unread
        const existingTimer = activityTimers.get(sessionId);
        if (existingTimer) {
          clearTimeout(existingTimer);
          activityTimers.delete(sessionId);
        }

        const tab = document.getElementById(`tab-${sessionId}`);
        if (tab) {
          tab.classList.remove("activity");
          tab.classList.add("unread");
        }
      }
    }
  }
});

// Handle session created
ipcRenderer.on("session-created", (_event, sessionId: string, persistedSession: any) => {
  // Skip if grid launcher is handling this
  if (gridLaunching) return;

  const session = addSession(persistedSession, true);
  activateSession(sessionId);

  // Reset button state and close modal
  const createBtn = document.getElementById("create-session") as HTMLButtonElement;
  const modal = document.getElementById("config-modal");
  const projectDirInput = document.getElementById("project-dir") as HTMLInputElement;
  const parentBranchSelect = document.getElementById("parent-branch") as HTMLSelectElement;
  const branchNameInput = document.getElementById("branch-name") as HTMLInputElement;
  const setupCommandsTextarea = document.getElementById("setup-commands") as HTMLTextAreaElement;

  if (createBtn) {
    createBtn.disabled = false;
    createBtn.textContent = "Create Session";
    createBtn.classList.remove("loading");
  }

  modal?.classList.add("hidden");

  // Reset form
  projectDirInput.value = "";
  selectedDirectory = "";
  parentBranchSelect.innerHTML = '<option value="">Loading branches...</option>';
  if (branchNameInput) {
    branchNameInput.value = "";
  }
  if (setupCommandsTextarea) {
    setupCommandsTextarea.value = "";
  }

  // Reset validation state
  const branchNameError = document.getElementById("branch-name-error");
  const branchNameHelp = document.getElementById("branch-name-help");
  branchNameError?.classList.add("hidden");
  branchNameHelp?.classList.remove("hidden");
  existingBranches = [];
});

// Handle session reopened
ipcRenderer.on("session-reopened", (_event, sessionId: string) => {
  activateSession(sessionId);
});

// Handle session deleted
ipcRenderer.on("session-deleted", (_event, sessionId: string) => {
  const session = sessions.get(sessionId);
  if (session) {
    // Remove from its group if it belongs to one
    if (session.presetGroupId) {
      const group = presetGroups.get(session.presetGroupId);
      if (group) {
        group.sessionIds = group.sessionIds.filter(id => id !== sessionId);
        updateFolderCount(session.presetGroupId);
        // If group is now empty, remove the folder
        if (group.sessionIds.length === 0) {
          document.getElementById(`folder-${session.presetGroupId}`)?.remove();
          presetGroups.delete(session.presetGroupId);
        }
      }
    }

    if (session.element) session.element.remove();
    if (session.terminal) session.terminal.dispose();
    document.getElementById(`tab-${sessionId}`)?.remove();
    document.getElementById(`sidebar-${sessionId}`)?.remove();
    sessions.delete(sessionId);

    if (activeSessionId === sessionId) {
      const remainingSessions = Array.from(sessions.values()).filter(s => s.hasActivePty);
      if (remainingSessions.length > 0) {
        switchToSession(remainingSessions[0].id);
      } else {
        activeSessionId = null;
      }
    }
  }
});

// Handle group deletion from main process
ipcRenderer.on("group-deleted", (_event, groupId: string) => {
  document.getElementById(`folder-${groupId}`)?.remove();
  presetGroups.delete(groupId);
});

// Load persisted sessions on startup
ipcRenderer.on("load-persisted-sessions", (_event, persistedSessions: PersistedSession[]) => {
  // First pass: identify all preset groups
  const groupNames = new Map<string, string>();
  persistedSessions.forEach(ps => {
    const gid = ps.config.presetGroupId;
    if (gid && !groupNames.has(gid)) {
      const name = ps.config.presetGroupName || "Preset Group";
      groupNames.set(gid, name);
    }
  });

  // Create group objects and render folders before adding sessions
  groupNames.forEach((name, gid) => {
    const group: PresetGroup = {
      id: gid,
      name,
      sessionIds: [],
      collapsed: true,
      slots: [],
    };
    presetGroups.set(gid, group);
    renderSidebarFolder(group);
  });

  // Second pass: add all sessions (they'll go into folders or sidebar)
  persistedSessions.forEach(ps => {
    addSession(ps, false);
  });

  // Update folder counts
  groupNames.forEach((_name, gid) => {
    updateFolderCount(gid);
  });
});

// Modal handling
const modal = document.getElementById("config-modal");
const projectDirInput = document.getElementById("project-dir") as HTMLInputElement;
const parentBranchSelect = document.getElementById("parent-branch") as HTMLSelectElement;
const codingAgentSelect = document.getElementById("coding-agent") as HTMLSelectElement;
const skipPermissionsCheckbox = document.getElementById("skip-permissions") as HTMLInputElement;
const skipPermissionsGroup = skipPermissionsCheckbox?.parentElement?.parentElement;
const sessionTypeSelect = document.getElementById("session-type") as HTMLSelectElement;
const parentBranchGroup = document.getElementById("parent-branch-group");
const branchNameGroup = document.getElementById("branch-name-group");
const worktreeDescription = document.getElementById("worktree-description");
const localDescription = document.getElementById("local-description");
const browseDirBtn = document.getElementById("browse-dir");
const cancelBtn = document.getElementById("cancel-session");
const createBtn = document.getElementById("create-session") as HTMLButtonElement;
const branchNameInput = document.getElementById("branch-name") as HTMLInputElement;
const branchNameError = document.getElementById("branch-name-error");
const branchNameHelp = document.getElementById("branch-name-help");

let selectedDirectory = "";
let existingBranches: string[] = [];

// Preset Launcher
let loadedPresets: SessionPreset[] = [];
let presetSlots: PresetSlot[] = [];
let editingSlotIndex = -1;
let presetProjectDir = "";

const AGENT_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  openrouter: "OpenRouter",
  custom: "Custom",
};

const AGENT_COLORS: Record<string, string> = {
  claude: "#8b5cf6",
  codex: "#10b981",
  openrouter: "#f59e0b",
  custom: "#6b7280",
};

async function loadPresets() {
  loadedPresets = await ipcRenderer.invoke("get-presets");
}

function renderPresetList() {
  const listEl = document.getElementById("preset-list");
  if (!listEl) return;

  if (loadedPresets.length === 0) {
    listEl.innerHTML = '<div class="text-sm text-gray-500">No presets saved yet. Create one below.</div>';
    return;
  }

  listEl.innerHTML = "";
  loadedPresets.forEach(preset => {
    const item = document.createElement("div");
    item.className = "flex items-center justify-between bg-gray-700 rounded p-3 cursor-pointer hover:bg-gray-600 transition";

    // Build slot summary
    const slotCounts: Record<string, number> = {};
    preset.slots.forEach(s => {
      const label = AGENT_LABELS[s.agent] || s.agent;
      slotCounts[label] = (slotCounts[label] || 0) + 1;
    });
    const summary = Object.entries(slotCounts).map(([k, v]) => `${v}x ${k}`).join(", ");
    const dirName = path.basename(preset.projectDir);

    item.innerHTML = `
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium text-white truncate">${preset.name}</div>
        <div class="text-xs text-gray-400 truncate">${dirName} &mdash; ${summary}</div>
        <div class="text-xs text-gray-500">${preset.yoloMode ? "Yolo mode" : "Normal mode"} &middot; ${preset.slots.length} terminals</div>
      </div>
      <div class="flex items-center space-x-2 ml-3">
        <button class="preset-launch-btn btn-primary text-xs" style="padding: 4px 12px;" data-id="${preset.id}">Launch</button>
        <button class="preset-delete-btn text-gray-500 hover:text-red-400 text-lg" data-id="${preset.id}" title="Delete">&times;</button>
      </div>
    `;

    // Launch button
    item.querySelector(".preset-launch-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      launchPreset(preset);
    });

    // Delete button
    item.querySelector(".preset-delete-btn")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete preset "${preset.name}"?`)) return;
      loadedPresets = await ipcRenderer.invoke("delete-preset", preset.id);
      renderPresetList();
    });

    listEl.appendChild(item);
  });
}

function renderPresetGrid() {
  const gridEl = document.getElementById("preset-grid");
  if (!gridEl) return;

  // Determine grid columns based on slot count
  const count = presetSlots.length;
  let cols = 4;
  if (count <= 2) cols = 2;
  else if (count <= 4) cols = 4;
  else if (count <= 6) cols = 3;
  else if (count <= 9) cols = 3;
  else cols = 4;

  gridEl.className = `grid gap-2`;
  gridEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

  gridEl.innerHTML = "";
  presetSlots.forEach((slot, index) => {
    const box = document.createElement("div");
    const color = AGENT_COLORS[slot.agent] || "#6b7280";
    const label = slot.agent === "custom" && slot.customCommand
      ? slot.customCommand.split(" ")[0]
      : AGENT_LABELS[slot.agent];

    box.className = "rounded p-3 text-center cursor-pointer transition hover:opacity-80";
    box.style.cssText = `border: 2px solid ${color}; background: ${color}22; min-height: 60px; display: flex; flex-direction: column; align-items: center; justify-content: center;`;
    box.innerHTML = `
      <div class="text-xs font-bold" style="color: ${color};">${label}</div>
      <div class="text-xs text-gray-500 mt-1">Slot ${index + 1}</div>
    `;

    box.addEventListener("click", () => {
      editingSlotIndex = index;
      openSlotConfigPopup(slot);
    });

    gridEl.appendChild(box);
  });
}

function openSlotConfigPopup(slot: PresetSlot) {
  const popup = document.getElementById("slot-config-popup");
  const agentSelect = document.getElementById("slot-agent-select") as HTMLSelectElement;
  const customGroup = document.getElementById("slot-custom-cmd-group");
  const customInput = document.getElementById("slot-custom-cmd") as HTMLInputElement;

  agentSelect.value = slot.agent;
  customInput.value = slot.customCommand || "";
  customGroup?.classList.toggle("hidden", slot.agent !== "custom");

  popup?.classList.remove("hidden");
}

function initPresetSlots(count: number) {
  // Preserve existing assignments where possible
  const oldSlots = [...presetSlots];
  presetSlots = [];
  for (let i = 0; i < count; i++) {
    if (i < oldSlots.length) {
      presetSlots.push(oldSlots[i]);
    } else {
      presetSlots.push({ agent: "claude" });
    }
  }
  renderPresetGrid();
}

function enterGridView(presetName: string, slotCount: number) {
  gridViewActive = true;
  gridSessionIds = [];
  focusedGridCell = null;

  // Hide normal view, show grid
  document.getElementById("tabs")!.style.display = "none";
  document.getElementById("session-container")!.style.display = "none";
  const gridView = document.getElementById("grid-view")!;
  gridView.style.display = "flex";
  gridView.style.flexDirection = "column";
  gridView.style.flex = "1";
  gridView.classList.remove("hidden");

  // Set title
  document.getElementById("grid-title")!.textContent = `${presetName} — ${slotCount} terminals`;

  // Calculate grid dimensions
  const cols = Math.ceil(Math.sqrt(slotCount));
  const rows = Math.ceil(slotCount / cols);
  const gridCells = document.getElementById("grid-cells")!;
  gridCells.innerHTML = "";
  gridCells.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  gridCells.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
}

function exitGridView() {
  gridViewActive = false;
  expandedCellId = null;

  // Show normal view, hide grid
  document.getElementById("tabs")!.style.display = "";
  document.getElementById("session-container")!.style.display = "";
  const gridView = document.getElementById("grid-view")!;
  gridView.style.display = "none";
  gridView.classList.add("hidden");

  // Move grid session terminals back to normal session-container
  gridSessionIds.forEach(sid => {
    const session = sessions.get(sid);
    if (session) {
      // Remove old grid element
      if (session.element) {
        session.element.remove();
      }
      if (session.terminal) {
        session.terminal.dispose();
      }
      session.terminal = null;
      session.fitAddon = null;
      session.element = null;

      // Recreate in normal container
      const ui = createTerminalUI(sid);
      session.terminal = ui.terminal;
      session.fitAddon = ui.fitAddon;
      session.element = ui.element;
    }
  });

  // Switch to the first grid session in tab mode
  if (gridSessionIds.length > 0) {
    gridSessionIds.forEach(sid => {
      const session = sessions.get(sid);
      if (session && !document.getElementById(`tab-${sid}`)) {
        addTab(sid, session.name);
      }
    });
    switchToSession(gridSessionIds[0]);
  }

  // Keep the group intact — just clear grid state
  gridSessionIds = [];
  focusedGridCell = null;
  activeGridGroupId = null;
}

let expandedCellId: string | null = null;

function createGridCell(sessionId: string, slot: PresetSlot, index: number): HTMLElement {
  const color = AGENT_COLORS[slot.agent] || "#6b7280";
  const label = slot.agent === "custom" && slot.customCommand
    ? slot.customCommand.split(" ")[0]
    : AGENT_LABELS[slot.agent];

  const cell = document.createElement("div");
  cell.className = "grid-cell";
  cell.id = `grid-cell-${sessionId}`;
  cell.setAttribute("draggable", "true");
  cell.dataset.sessionId = sessionId;

  const header = document.createElement("div");
  header.className = "grid-cell-header";
  header.innerHTML = `
    <span class="grid-cell-label" style="color: ${color};">
      <span class="drag-handle" title="Drag to reorder" style="cursor: grab; margin-right: 4px; opacity: 0.4;">&#9776;</span>
      ${label} #${index + 1}
    </span>
    <div class="flex items-center" style="gap: 6px;">
      <button class="grid-expand-btn" title="Expand (double-click)" style="font-size: 10px; color: #666; cursor: pointer; background: none; border: none; padding: 0;">&#9634;</button>
    </div>
  `;

  // Click header to focus this cell
  header.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).classList.contains("grid-expand-btn")) {
      focusGridCell(sessionId);
    }
  });

  // Expand button — toggle full-screen for this cell
  header.querySelector(".grid-expand-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleExpandCell(sessionId);
  });

  // Double-click anywhere on cell to expand
  cell.addEventListener("dblclick", () => {
    toggleExpandCell(sessionId);
  });

  // Drag and drop for reordering
  cell.addEventListener("dragstart", (e) => {
    e.dataTransfer?.setData("text/plain", sessionId);
    e.dataTransfer!.effectAllowed = "move";

    // Create a styled drag preview
    const preview = document.createElement("div");
    preview.style.cssText = `
      background: linear-gradient(135deg, #1e1b2e, #16132a);
      border: 2px solid ${color};
      border-radius: 8px;
      padding: 10px 16px;
      color: ${color};
      font-size: 12px;
      font-weight: 700;
      font-family: -apple-system, sans-serif;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5), 0 0 12px ${color}44;
      position: absolute;
      top: -1000px;
      white-space: nowrap;
    `;
    preview.textContent = `${label} #${index + 1}`;
    document.body.appendChild(preview);
    e.dataTransfer?.setDragImage(preview, preview.offsetWidth / 2, preview.offsetHeight / 2);
    setTimeout(() => preview.remove(), 0);

    cell.style.opacity = "0.3";
    cell.style.transform = "scale(0.95)";
  });

  cell.addEventListener("dragend", () => {
    cell.style.opacity = "1";
    cell.style.transform = "";
    // Clear all drag-over highlights
    document.querySelectorAll(".grid-cell").forEach(c => {
      (c as HTMLElement).style.borderColor = "";
      (c as HTMLElement).style.background = "";
    });
  });

  cell.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    cell.style.borderColor = "#8b5cf6";
    cell.style.background = "rgba(139, 92, 246, 0.08)";
  });

  cell.addEventListener("dragleave", () => {
    cell.style.borderColor = "";
    cell.style.background = "";
  });

  cell.addEventListener("drop", (e) => {
    e.preventDefault();
    cell.style.borderColor = "";
    cell.style.background = "";
    const draggedId = e.dataTransfer?.getData("text/plain");
    if (!draggedId || draggedId === sessionId) return;
    swapGridCells(draggedId, sessionId);
  });

  cell.appendChild(header);
  return cell;
}

function toggleExpandCell(sessionId: string) {
  const gridCells = document.getElementById("grid-cells")!;

  if (expandedCellId === sessionId) {
    // Collapse — restore grid
    expandedCellId = null;
    gridSessionIds.forEach(sid => {
      const c = document.getElementById(`grid-cell-${sid}`);
      if (c) {
        c.style.display = "";
      }
    });
    // Restore grid template
    const count = gridSessionIds.length;
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    gridCells.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    gridCells.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    setTimeout(fitAllGridTerminals, 50);
  } else {
    // Expand — hide all other cells, make this one fill
    expandedCellId = sessionId;
    gridSessionIds.forEach(sid => {
      const c = document.getElementById(`grid-cell-${sid}`);
      if (c) {
        c.style.display = sid === sessionId ? "" : "none";
      }
    });
    gridCells.style.gridTemplateColumns = "1fr";
    gridCells.style.gridTemplateRows = "1fr";
    focusGridCell(sessionId);
    setTimeout(() => {
      const session = sessions.get(sessionId);
      if (session?.fitAddon) {
        session.fitAddon.fit();
        const dims = session.fitAddon.proposeDimensions();
        if (dims) {
          ipcRenderer.send("session-resize", sessionId, dims.cols, dims.rows);
        }
      }
    }, 50);
  }
}

function swapGridCells(draggedId: string, targetId: string) {
  // Swap positions in gridSessionIds
  const fromIdx = gridSessionIds.indexOf(draggedId);
  const toIdx = gridSessionIds.indexOf(targetId);
  if (fromIdx === -1 || toIdx === -1) return;

  gridSessionIds[fromIdx] = targetId;
  gridSessionIds[toIdx] = draggedId;

  // Also swap in the group
  if (activeGridGroupId) {
    const group = presetGroups.get(activeGridGroupId);
    if (group) {
      const gi = group.sessionIds.indexOf(draggedId);
      const gj = group.sessionIds.indexOf(targetId);
      if (gi !== -1 && gj !== -1) {
        group.sessionIds[gi] = targetId;
        group.sessionIds[gj] = draggedId;
      }
    }
  }

  // Swap DOM elements
  const gridCells = document.getElementById("grid-cells")!;
  const draggedCell = document.getElementById(`grid-cell-${draggedId}`);
  const targetCell = document.getElementById(`grid-cell-${targetId}`);
  if (!draggedCell || !targetCell) return;

  // Use a placeholder to swap
  const placeholder = document.createElement("div");
  gridCells.insertBefore(placeholder, draggedCell);
  gridCells.insertBefore(draggedCell, targetCell);
  gridCells.insertBefore(targetCell, placeholder);
  gridCells.removeChild(placeholder);

  setTimeout(fitAllGridTerminals, 50);
}

function focusGridCell(sessionId: string) {
  // Remove focus from all cells
  document.querySelectorAll(".grid-cell").forEach(c => c.classList.remove("focused"));

  // Focus this cell
  const cell = document.getElementById(`grid-cell-${sessionId}`);
  cell?.classList.add("focused");
  focusedGridCell = sessionId;

  // Focus the terminal so keystrokes go to it
  const session = sessions.get(sessionId);
  if (session?.terminal) {
    session.terminal.focus();
  }
}

function fitAllGridTerminals() {
  gridSessionIds.forEach(sid => {
    const session = sessions.get(sid);
    if (session?.fitAddon && session?.terminal) {
      try {
        session.fitAddon.fit();
        const dims = session.fitAddon.proposeDimensions();
        if (dims) {
          ipcRenderer.send("session-resize", sid, dims.cols, dims.rows);
        }
      } catch (_e) { /* ignore */ }
    }
  });
}

async function launchPreset(preset: SessionPreset) {
  // Close the preset launcher modal
  document.getElementById("preset-launcher-modal")?.classList.add("hidden");

  gridLaunching = true;

  // Create a preset group
  const groupId = `group-${Date.now()}`;
  const group: PresetGroup = {
    id: groupId,
    name: preset.name,
    sessionIds: [],
    collapsed: false,
    slots: [...preset.slots],
  };
  presetGroups.set(groupId, group);
  activeGridGroupId = groupId;

  // Render the folder in sidebar
  renderSidebarFolder(group);

  // Enter grid view
  enterGridView(preset.name, preset.slots.length);

  const gridCells = document.getElementById("grid-cells")!;

  // Create all sessions and grid cells
  for (let i = 0; i < preset.slots.length; i++) {
    const slot = preset.slots[i];
    const config: SessionConfig = {
      projectDir: preset.projectDir,
      sessionType: preset.sessionType,
      parentBranch: preset.parentBranch,
      codingAgent: slot.agent,
      skipPermissions: preset.yoloMode,
      setupCommands: preset.setupCommands,
      customCommand: slot.customCommand,
      presetGroupId: groupId,
      presetGroupName: preset.name,
    };

    const sessionId = await new Promise<string>((resolve) => {
      const handler = (_event: any, sid: string, persistedSession: any) => {
        ipcRenderer.removeListener("session-created", handler);

        // Create the grid cell
        const cell = createGridCell(sid, slot, i);
        gridCells.appendChild(cell);

        // Add session to our map (this also adds to folder sidebar)
        const session = addSession(persistedSession, true);

        // Create terminal inside the grid cell
        const ui = createTerminalUI(sid, cell);
        session.terminal = ui.terminal;
        session.fitAddon = ui.fitAddon;
        session.element = ui.element;

        gridSessionIds.push(sid);

        // Update sidebar state
        updateSessionState(sid, true);

        resolve(sid);
      };

      ipcRenderer.on("session-created", handler);
      ipcRenderer.send("create-session", config);
    });

    // Small delay for stability
    if (i < preset.slots.length - 1) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  gridLaunching = false;

  // Update folder count
  updateFolderCount(groupId);

  // Fit all terminals after grid is fully built
  setTimeout(() => {
    fitAllGridTerminals();
    if (gridSessionIds.length > 0) {
      focusGridCell(gridSessionIds[0]);
    }
  }, 300);
}

// Open Presets button
document.getElementById("open-presets")?.addEventListener("click", async () => {
  await loadPresets();
  renderPresetList();

  // Reset the builder form
  presetSlots = [];
  presetProjectDir = "";
  initPresetSlots(4);
  (document.getElementById("preset-name-input") as HTMLInputElement).value = "";
  (document.getElementById("preset-project-dir") as HTMLInputElement).value = "";
  (document.getElementById("preset-slot-count") as HTMLInputElement).value = "4";
  (document.getElementById("preset-yolo-mode") as HTMLInputElement).checked = true;
  (document.getElementById("preset-setup-commands") as HTMLTextAreaElement).value = "";
  const presetSessionType = document.getElementById("preset-session-type") as HTMLSelectElement;
  presetSessionType.value = "local";
  document.getElementById("preset-parent-branch-group")!.style.display = "none";

  document.getElementById("preset-launcher-modal")?.classList.remove("hidden");
});

// Preset builder: browse directory
document.getElementById("preset-browse-dir")?.addEventListener("click", async () => {
  const dir = await ipcRenderer.invoke("select-directory");
  if (dir) {
    presetProjectDir = dir;
    const dirName = path.basename(dir);
    (document.getElementById("preset-project-dir") as HTMLInputElement).value = `(${dirName}) ${dir}`;

    // Load branches for worktree mode
    const branches = await ipcRenderer.invoke("get-branches", dir);
    const branchSelect = document.getElementById("preset-parent-branch") as HTMLSelectElement;
    branchSelect.innerHTML = "";
    branches.forEach((branch: string) => {
      const option = document.createElement("option");
      option.value = branch;
      option.textContent = branch;
      branchSelect.appendChild(option);
    });
  }
});

// Preset builder: session type toggle
document.getElementById("preset-session-type")?.addEventListener("change", (e) => {
  const val = (e.target as HTMLSelectElement).value;
  document.getElementById("preset-parent-branch-group")!.style.display = val === "worktree" ? "block" : "none";
});

// Preset builder: fill all slots with one agent
document.querySelectorAll(".preset-fill-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const agent = (btn as HTMLElement).dataset.agent as PresetSlot["agent"];
    presetSlots = presetSlots.map(() => ({ agent }));
    renderPresetGrid();
  });
});

// Preset builder: update slot count
document.getElementById("preset-update-slots")?.addEventListener("click", () => {
  const count = parseInt((document.getElementById("preset-slot-count") as HTMLInputElement).value) || 4;
  initPresetSlots(Math.min(Math.max(count, 1), 20));
});

// Slot config popup: agent change
document.getElementById("slot-agent-select")?.addEventListener("change", (e) => {
  const val = (e.target as HTMLSelectElement).value;
  document.getElementById("slot-custom-cmd-group")?.classList.toggle("hidden", val !== "custom");
});

// Slot config popup: OK
document.getElementById("slot-config-ok")?.addEventListener("click", () => {
  if (editingSlotIndex >= 0 && editingSlotIndex < presetSlots.length) {
    const agent = (document.getElementById("slot-agent-select") as HTMLSelectElement).value as PresetSlot["agent"];
    const customCmd = (document.getElementById("slot-custom-cmd") as HTMLInputElement).value.trim();
    presetSlots[editingSlotIndex] = {
      agent,
      customCommand: agent === "custom" ? customCmd : undefined,
    };
    renderPresetGrid();
  }
  document.getElementById("slot-config-popup")?.classList.add("hidden");
});

// Slot config popup: Cancel
document.getElementById("slot-config-cancel")?.addEventListener("click", () => {
  document.getElementById("slot-config-popup")?.classList.add("hidden");
});

// Preset builder: Cancel
document.getElementById("preset-cancel")?.addEventListener("click", () => {
  document.getElementById("preset-launcher-modal")?.classList.add("hidden");
});

// Preset builder: Save
document.getElementById("preset-save")?.addEventListener("click", async () => {
  const name = (document.getElementById("preset-name-input") as HTMLInputElement).value.trim();
  if (!name) { alert("Please enter a preset name"); return; }
  if (!presetProjectDir) { alert("Please select a project directory"); return; }

  const sessionType = (document.getElementById("preset-session-type") as HTMLSelectElement).value as SessionType;
  const parentBranch = sessionType === SessionType.WORKTREE
    ? (document.getElementById("preset-parent-branch") as HTMLSelectElement).value
    : undefined;
  const yoloMode = (document.getElementById("preset-yolo-mode") as HTMLInputElement).checked;
  const setupText = (document.getElementById("preset-setup-commands") as HTMLTextAreaElement).value.trim();
  const setupCommands = setupText ? setupText.split("\n").filter(c => c.trim()) : undefined;

  const preset: SessionPreset = {
    id: `preset-${Date.now()}`,
    name,
    projectDir: presetProjectDir,
    sessionType,
    parentBranch,
    slots: [...presetSlots],
    yoloMode,
    setupCommands,
  };

  loadedPresets = await ipcRenderer.invoke("save-preset", preset);
  renderPresetList();

  // Reset builder
  (document.getElementById("preset-name-input") as HTMLInputElement).value = "";
  alert(`Preset "${name}" saved! Click Launch to start it.`);
});

// Global resize handler for grid view
let gridResizeTimer: NodeJS.Timeout | null = null;
window.addEventListener("resize", () => {
  if (gridViewActive) {
    if (gridResizeTimer) clearTimeout(gridResizeTimer);
    gridResizeTimer = setTimeout(fitAllGridTerminals, 100);
  }
});

// Grid view toolbar handlers
document.getElementById("grid-to-tabs")?.addEventListener("click", () => {
  exitGridView();
});

document.getElementById("grid-exit")?.addEventListener("click", () => {
  if (!confirm("Close all grid terminals?")) return;

  const groupId = activeGridGroupId;
  gridViewActive = false;

  // Hide grid, show normal
  document.getElementById("tabs")!.style.display = "";
  document.getElementById("session-container")!.style.display = "";
  const gridView = document.getElementById("grid-view")!;
  gridView.style.display = "none";
  gridView.classList.add("hidden");
  document.getElementById("grid-cells")!.innerHTML = "";

  // Delete the entire group if it exists
  if (groupId) {
    deleteGroup(groupId);
  } else {
    const idsToClose = [...gridSessionIds];
    idsToClose.forEach(sid => closeSession(sid));
  }

  gridSessionIds = [];
  focusedGridCell = null;
  activeGridGroupId = null;
});

// Load presets on startup
loadPresets();

// Validate branch name
function validateBranchName(): boolean {
  const branchName = branchNameInput?.value.trim();

  if (!branchName) {
    // Empty branch name is allowed (it's optional)
    branchNameError?.classList.add("hidden");
    branchNameHelp?.classList.remove("hidden");
    return true;
  }

  // Check if branch already exists
  const branchExists = existingBranches.some(branch =>
    branch === branchName || branch === `origin/${branchName}`
  );

  if (branchExists) {
    branchNameError?.classList.remove("hidden");
    branchNameHelp?.classList.add("hidden");
    return false;
  } else {
    branchNameError?.classList.add("hidden");
    branchNameHelp?.classList.remove("hidden");
    return true;
  }
}

// Add input event listener for branch name validation
branchNameInput?.addEventListener("input", () => {
  validateBranchName();
});

// Toggle skip permissions checkbox visibility based on coding agent
codingAgentSelect?.addEventListener("change", () => {
  if (codingAgentSelect.value === "claude") {
    skipPermissionsGroup?.classList.remove("hidden");
  } else {
    skipPermissionsGroup?.classList.add("hidden");
  }
});

// Toggle parent branch and branch name visibility based on session type
sessionTypeSelect?.addEventListener("change", () => {
  const isWorktree = sessionTypeSelect.value === SessionType.WORKTREE;
  if (isWorktree) {
    parentBranchGroup?.classList.remove("hidden");
    branchNameGroup?.classList.remove("hidden");
    worktreeDescription?.style.setProperty("display", "block");
    localDescription?.style.setProperty("display", "none");
  } else {
    parentBranchGroup?.classList.add("hidden");
    branchNameGroup?.classList.add("hidden");
    worktreeDescription?.style.setProperty("display", "none");
    localDescription?.style.setProperty("display", "block");
  }
});

// New session button - opens modal
document.getElementById("new-session")?.addEventListener("click", async () => {
  modal?.classList.remove("hidden");

  // Load last used settings
  const lastSettings = await ipcRenderer.invoke("get-last-settings");

  if (lastSettings.projectDir) {
    selectedDirectory = lastSettings.projectDir;
    // Show last part of path in parentheses before full path
    const dirName = path.basename(lastSettings.projectDir);
    projectDirInput.value = `(${dirName}) ${lastSettings.projectDir}`;

    // Load git branches for the last directory
    await loadAndPopulateBranches(lastSettings.projectDir, lastSettings.parentBranch);
  }

  // Set last used session type (default to worktree if not set)
  if (lastSettings.sessionType) {
    sessionTypeSelect.value = lastSettings.sessionType;
  } else {
    sessionTypeSelect.value = SessionType.WORKTREE;
  }

  // Show/hide parent branch, branch name, and descriptions based on session type
  const isWorktree = sessionTypeSelect.value === SessionType.WORKTREE;
  if (isWorktree) {
    parentBranchGroup?.classList.remove("hidden");
    branchNameGroup?.classList.remove("hidden");
    worktreeDescription?.style.setProperty("display", "block");
    localDescription?.style.setProperty("display", "none");
  } else {
    parentBranchGroup?.classList.add("hidden");
    branchNameGroup?.classList.add("hidden");
    worktreeDescription?.style.setProperty("display", "none");
    localDescription?.style.setProperty("display", "block");
  }

  // Set last used coding agent
  if (lastSettings.codingAgent) {
    codingAgentSelect.value = lastSettings.codingAgent;
  }

  // Set last used skip permissions setting and visibility
  if (lastSettings.skipPermissions !== undefined) {
    skipPermissionsCheckbox.checked = lastSettings.skipPermissions;
  }

  // Set last used setup commands
  const setupCommandsTextarea = document.getElementById("setup-commands") as HTMLTextAreaElement;
  if (lastSettings.setupCommands && setupCommandsTextarea) {
    setupCommandsTextarea.value = lastSettings.setupCommands.join("\n");
  }

  // Show/hide skip permissions based on coding agent
  if (lastSettings.codingAgent === "codex") {
    skipPermissionsGroup?.classList.add("hidden");
  } else {
    skipPermissionsGroup?.classList.remove("hidden");
  }
});

// Browse directory
browseDirBtn?.addEventListener("click", async () => {
  const dir = await ipcRenderer.invoke("select-directory");
  if (dir) {
    selectedDirectory = dir;
    // Show last part of path in parentheses before full path
    const dirName = path.basename(dir);
    projectDirInput.value = `(${dirName}) ${dir}`;

    // Load git branches
    await loadAndPopulateBranches(dir);
  }
});

// Cancel button
cancelBtn?.addEventListener("click", () => {
  modal?.classList.add("hidden");
  projectDirInput.value = "";
  selectedDirectory = "";
  parentBranchSelect.innerHTML = '<option value="">Loading branches...</option>';
  branchNameInput.value = "";
  branchNameError?.classList.add("hidden");
  branchNameHelp?.classList.remove("hidden");
  existingBranches = [];
});

// Create session button
createBtn?.addEventListener("click", () => {
  if (!selectedDirectory) {
    alert("Please select a project directory");
    return;
  }

  const sessionType = sessionTypeSelect.value as SessionType;

  // Validate parent branch is selected for worktree sessions
  if (sessionType === SessionType.WORKTREE && !parentBranchSelect.value) {
    alert("Please select a parent branch for worktree session");
    return;
  }

  // Validate branch name doesn't already exist for worktree sessions
  if (sessionType === SessionType.WORKTREE && !validateBranchName()) {
    alert("Cannot create worktree: branch already exists");
    return;
  }

  const setupCommandsTextarea = document.getElementById("setup-commands") as HTMLTextAreaElement;
  const setupCommandsText = setupCommandsTextarea?.value.trim();
  const setupCommands = setupCommandsText
    ? setupCommandsText.split("\n").filter(cmd => cmd.trim())
    : undefined;

  const branchNameInput = document.getElementById("branch-name") as HTMLInputElement;
  const branchName = branchNameInput?.value.trim() || undefined;

  const config: SessionConfig = {
    projectDir: selectedDirectory,
    sessionType,
    parentBranch: sessionType === SessionType.WORKTREE ? parentBranchSelect.value : undefined,
    branchName,
    codingAgent: codingAgentSelect.value,
    skipPermissions: codingAgentSelect.value === "claude" ? skipPermissionsCheckbox.checked : false,
    setupCommands,
  };

  // Show loading state
  if (createBtn) {
    createBtn.disabled = true;
    createBtn.innerHTML = '<span class="loading-spinner"></span> Creating...';
    createBtn.classList.add("loading");
  }

  // Save settings for next time
  ipcRenderer.send("save-settings", config);

  // Create the session
  ipcRenderer.send("create-session", config);
});

// MCP Server management functions
async function loadMcpServers() {
  // Only load MCP servers if there's an active session
  if (!activeSessionId) {
    return;
  }

  try {
    await ipcRenderer.invoke("list-mcp-servers", activeSessionId);
    // Results will come via mcp-servers-updated event
  } catch (error) {
    console.error("Failed to load MCP servers:", error);
  }
}

// Force immediate refresh of MCP servers after add/remove operations
async function refreshMcpServers() {
  if (!activeSessionId) {
    return;
  }

  // Show loading state on add button
  const addMcpServerBtn = document.getElementById("add-mcp-server");
  if (addMcpServerBtn) {
    addMcpServerBtn.innerHTML = '<span class="loading-spinner"></span>';
    addMcpServerBtn.classList.add("pointer-events-none");
  }

  try {
    // Trigger MCP list command
    await ipcRenderer.invoke("list-mcp-servers", activeSessionId);
    // Wait a bit for the poller to process and send results
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (error) {
    console.error("Failed to refresh MCP servers:", error);
  } finally {
    // Restore add button will happen via mcp-servers-updated event
  }
}

function renderMcpServers() {
  const list = document.getElementById("mcp-server-list");
  if (!list) return;

  list.innerHTML = "";

  mcpServers.forEach(server => {
    const item = document.createElement("div");
    item.className = "session-list-item";
    const indicatorClass = server.connected ? "active" : "disconnected";
    item.innerHTML = `
      <div class="flex items-center space-x-2 flex-1">
        <span class="session-indicator ${indicatorClass}"></span>
        <span class="truncate">${server.name}</span>
      </div>
      <button class="session-delete-btn mcp-remove-btn" data-name="${server.name}" title="Remove server">×</button>
    `;

    // Click to show details
    item.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains("mcp-remove-btn")) {
        await showMcpServerDetails(server.name);
      }
    });

    const removeBtn = item.querySelector(".mcp-remove-btn");
    removeBtn?.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm(`Remove MCP server "${server.name}"?`)) {
        // Optimistically remove from UI
        mcpServers = mcpServers.filter(s => s.name !== server.name);
        renderMcpServers();

        try {
          await ipcRenderer.invoke("remove-mcp-server", server.name);
        } catch (error) {
          alert(`Failed to remove server: ${error}`);
          // Refresh to restore correct state on error
          await refreshMcpServers();
        }
      }
    });

    list.appendChild(item);
  });
}

async function showMcpServerDetails(name: string) {
  const detailsModal = document.getElementById("mcp-details-modal");
  const detailsTitle = document.getElementById("mcp-details-title");
  const detailsContent = document.getElementById("mcp-details-content");

  // Show modal immediately with loading state
  if (detailsTitle) {
    detailsTitle.textContent = name;
  }

  if (detailsContent) {
    detailsContent.innerHTML = '<div class="flex items-center justify-center py-8"><span class="loading-spinner" style="width: 24px; height: 24px; border-width: 3px;"></span></div>';
  }

  detailsModal?.classList.remove("hidden");

  try {
    const details = await ipcRenderer.invoke("get-mcp-server-details", name);

    if (detailsContent) {
      let html = "";
      if (details.scope) {
        html += `<div><strong>Scope:</strong> ${details.scope}</div>`;
      }
      if (details.status) {
        html += `<div><strong>Status:</strong> ${details.status}</div>`;
      }
      if (details.type) {
        html += `<div><strong>Type:</strong> ${details.type}</div>`;
      }
      if (details.url) {
        html += `<div><strong>URL:</strong> ${details.url}</div>`;
      }
      if (details.command) {
        html += `<div><strong>Command:</strong> ${details.command}</div>`;
      }
      if (details.args) {
        html += `<div><strong>Args:</strong> ${details.args}</div>`;
      }

      detailsContent.innerHTML = html;
    }

    // Store current server name for remove button
    const removeMcpDetailsBtn = document.getElementById("remove-mcp-details") as HTMLButtonElement;
    if (removeMcpDetailsBtn) {
      removeMcpDetailsBtn.dataset.serverName = name;
    }
  } catch (error) {
    console.error("Failed to get server details:", error);
    if (detailsContent) {
      detailsContent.innerHTML = `<div class="text-red-400">Failed to load server details</div>`;
    }
  }
}

// MCP Modal handling
const mcpModal = document.getElementById("mcp-modal");
const mcpNameInput = document.getElementById("mcp-name") as HTMLInputElement;
const mcpTypeSelect = document.getElementById("mcp-type") as HTMLSelectElement;
const mcpCommandInput = document.getElementById("mcp-command") as HTMLInputElement;
const mcpArgsInput = document.getElementById("mcp-args") as HTMLInputElement;
const mcpEnvInput = document.getElementById("mcp-env") as HTMLTextAreaElement;
const mcpUrlInput = document.getElementById("mcp-url") as HTMLInputElement;
const mcpHeadersInput = document.getElementById("mcp-headers") as HTMLTextAreaElement;
const mcpAlwaysAllowInput = document.getElementById("mcp-always-allow") as HTMLInputElement;
const localFields = document.getElementById("local-fields");
const remoteFields = document.getElementById("remote-fields");
const cancelMcpBtn = document.getElementById("cancel-mcp");
const addMcpBtn = document.getElementById("add-mcp") as HTMLButtonElement;

// Toggle fields based on server type
mcpTypeSelect?.addEventListener("change", () => {
  if (mcpTypeSelect.value === "local") {
    localFields!.style.display = "block";
    remoteFields!.style.display = "none";
  } else {
    localFields!.style.display = "none";
    remoteFields!.style.display = "block";
  }
});

// Add MCP server button - opens modal
document.getElementById("add-mcp-server")?.addEventListener("click", () => {
  mcpModal?.classList.remove("hidden");
  mcpNameInput.value = "";
  mcpTypeSelect.value = "local";
  mcpCommandInput.value = "";
  mcpArgsInput.value = "";
  mcpEnvInput.value = "";
  mcpUrlInput.value = "";
  mcpHeadersInput.value = "";
  mcpAlwaysAllowInput.value = "";
  localFields!.style.display = "block";
  remoteFields!.style.display = "none";
});

// Cancel MCP button
cancelMcpBtn?.addEventListener("click", () => {
  mcpModal?.classList.add("hidden");
});

// Add MCP button
addMcpBtn?.addEventListener("click", async () => {
  const name = mcpNameInput.value.trim();
  const serverType = mcpTypeSelect.value;

  if (!name) {
    alert("Please enter a server name");
    return;
  }

  const config: any = {};

  if (serverType === "local") {
    config.type = "stdio";

    const command = mcpCommandInput.value.trim();
    const argsInput = mcpArgsInput.value.trim();

    if (!command) {
      alert("Please enter a command");
      return;
    }

    config.command = command;
    if (argsInput) {
      config.args = argsInput.split(" ").filter(a => a.trim());
    }

    // Parse environment variables if provided
    const envInput = mcpEnvInput.value.trim();
    if (envInput) {
      try {
        config.env = JSON.parse(envInput);
      } catch (error) {
        alert("Invalid JSON for environment variables");
        return;
      }
    }
  } else {
    // Remote server
    config.type = "sse";

    const url = mcpUrlInput.value.trim();

    if (!url) {
      alert("Please enter a server URL");
      return;
    }

    config.url = url;

    // Parse headers if provided
    const headersInput = mcpHeadersInput.value.trim();
    if (headersInput) {
      try {
        config.headers = JSON.parse(headersInput);
      } catch (error) {
        alert("Invalid JSON for headers");
        return;
      }
    }
  }

  // Parse always allow tools
  const alwaysAllowInput = mcpAlwaysAllowInput.value.trim();
  if (alwaysAllowInput) {
    config.alwaysAllow = alwaysAllowInput.split(",").map(t => t.trim()).filter(t => t);
  }

  // Show loading state
  const originalText = addMcpBtn.innerHTML;
  addMcpBtn.innerHTML = '<span class="loading-spinner"></span> Adding...';
  addMcpBtn.disabled = true;
  addMcpBtn.classList.add("opacity-50", "cursor-not-allowed");

  try {
    await ipcRenderer.invoke("add-mcp-server", name, config);
    mcpModal?.classList.add("hidden");
    // Force immediate refresh of MCP servers
    await refreshMcpServers();
  } catch (error) {
    console.error("Error adding server:", error);
    alert(`Failed to add server: ${error}`);
  } finally {
    // Reset button state
    addMcpBtn.innerHTML = originalText;
    addMcpBtn.disabled = false;
    addMcpBtn.classList.remove("opacity-50", "cursor-not-allowed");
  }
});

// MCP Details Modal handling
const closeMcpDetailsBtn = document.getElementById("close-mcp-details");
const removeMcpDetailsBtn = document.getElementById("remove-mcp-details") as HTMLButtonElement;
const mcpDetailsModal = document.getElementById("mcp-details-modal");

closeMcpDetailsBtn?.addEventListener("click", () => {
  mcpDetailsModal?.classList.add("hidden");
});

removeMcpDetailsBtn?.addEventListener("click", async () => {
  const serverName = removeMcpDetailsBtn.dataset.serverName;
  if (!serverName) return;

  if (confirm(`Remove MCP server "${serverName}"?`)) {
    // Close modal immediately
    mcpDetailsModal?.classList.add("hidden");

    // Optimistically remove from UI
    mcpServers = mcpServers.filter(s => s.name !== serverName);
    renderMcpServers();

    try {
      await ipcRenderer.invoke("remove-mcp-server", serverName);
    } catch (error) {
      alert(`Failed to remove server: ${error}`);
      // Refresh to restore correct state on error
      await refreshMcpServers();
    }
  }
});

// Listen for MCP polling started event
ipcRenderer.on("mcp-polling-started", (_event, sessionId: string) => {
  if (sessionId === activeSessionId) {
    const addMcpServerBtn = document.getElementById("add-mcp-server");
    if (addMcpServerBtn) {
      addMcpServerBtn.innerHTML = '<span class="loading-spinner"></span>';
      addMcpServerBtn.classList.add("pointer-events-none");
    }
  }
});

// Listen for MCP server updates from main process
ipcRenderer.on("mcp-servers-updated", (_event, sessionId: string, servers: McpServer[]) => {
  // Only update if this is for the active session
  if (sessionId === activeSessionId) {
    mcpServers = servers;
    renderMcpServers();

    // Restore add button
    const addMcpServerBtn = document.getElementById("add-mcp-server");
    if (addMcpServerBtn) {
      addMcpServerBtn.innerHTML = '+';
      addMcpServerBtn.classList.remove("pointer-events-none");
    }
  }
});

// Settings Modal handling
const settingsModal = document.getElementById("settings-modal");
const openSettingsBtn = document.getElementById("open-settings");
const cancelSettingsBtn = document.getElementById("cancel-settings");
const resetSettingsBtn = document.getElementById("reset-settings");
const saveSettingsBtn = document.getElementById("save-settings");

const settingsTheme = document.getElementById("settings-theme") as HTMLSelectElement;
const settingsFontFamily = document.getElementById("settings-font-family") as HTMLSelectElement;
const settingsFontSize = document.getElementById("settings-font-size") as HTMLInputElement;
const settingsCursorBlink = document.getElementById("settings-cursor-blink") as HTMLInputElement;
const settingsWorktreeDir = document.getElementById("settings-worktree-dir") as HTMLInputElement;
const settingsShortcuts = document.getElementById("settings-shortcuts") as HTMLInputElement;
const browseWorktreeDirBtn = document.getElementById("browse-worktree-dir");

// Load saved settings on startup
async function loadSettings() {
  const savedSettings = await ipcRenderer.invoke("get-terminal-settings");
  if (savedSettings) {
    terminalSettings = { ...DEFAULT_SETTINGS, ...savedSettings };
  }
}

// Populate settings form
function populateSettingsForm() {
  // Set theme
  settingsTheme.value = terminalSettings.theme;

  // Set font family - match against dropdown options
  const fontOptions = Array.from(settingsFontFamily.options);
  const matchingOption = fontOptions.find(opt => opt.value === terminalSettings.fontFamily);
  if (matchingOption) {
    settingsFontFamily.value = matchingOption.value;
  } else {
    // Default to first option (Menlo) if no match
    settingsFontFamily.selectedIndex = 0;
  }

  settingsFontSize.value = terminalSettings.fontSize.toString();
  settingsCursorBlink.checked = terminalSettings.cursorBlink;
  settingsWorktreeDir.value = terminalSettings.worktreeDir;
}

// Apply settings to all existing terminals
function applySettingsToAllTerminals() {
  const themeColors = THEME_PRESETS[terminalSettings.theme] || THEME_PRESETS["macos-dark"];

  sessions.forEach((session) => {
    if (session.terminal) {
      session.terminal.options.fontFamily = terminalSettings.fontFamily;
      session.terminal.options.fontSize = terminalSettings.fontSize;
      session.terminal.options.cursorBlink = terminalSettings.cursorBlink;
      session.terminal.options.theme = themeColors;

      // Refresh terminal to apply changes
      if (session.fitAddon) {
        session.fitAddon.fit();
      }
    }
  });
}

// Open settings modal
openSettingsBtn?.addEventListener("click", async () => {
  populateSettingsForm();

  // Load shortcuts setting
  const shortcutsEnabled = await ipcRenderer.invoke("get-shortcuts-enabled");
  settingsShortcuts.checked = shortcutsEnabled !== false;

  // Load and display app version
  const version = await ipcRenderer.invoke("get-app-version");
  const versionElement = document.getElementById("app-version");
  if (versionElement) {
    versionElement.textContent = `HenrixCode v${version}`;
  }

  settingsModal?.classList.remove("hidden");
});

// Cancel settings
cancelSettingsBtn?.addEventListener("click", () => {
  settingsModal?.classList.add("hidden");
});

// Reset settings to default
resetSettingsBtn?.addEventListener("click", () => {
  terminalSettings = { ...DEFAULT_SETTINGS };
  populateSettingsForm();
});

// Browse worktree directory
browseWorktreeDirBtn?.addEventListener("click", async () => {
  const dir = await ipcRenderer.invoke("select-directory");
  if (dir) {
    settingsWorktreeDir.value = dir;
  }
});

// Save settings
saveSettingsBtn?.addEventListener("click", async () => {
  // Read values from form
  terminalSettings.theme = settingsTheme.value;
  terminalSettings.fontFamily = settingsFontFamily.value || DEFAULT_SETTINGS.fontFamily;
  terminalSettings.fontSize = parseInt(settingsFontSize.value) || DEFAULT_SETTINGS.fontSize;
  terminalSettings.cursorBlink = settingsCursorBlink.checked;
  terminalSettings.worktreeDir = settingsWorktreeDir.value || DEFAULT_SETTINGS.worktreeDir;

  // Save to electron-store
  await ipcRenderer.invoke("save-terminal-settings", terminalSettings);

  // Save shortcuts setting
  await ipcRenderer.invoke("set-shortcuts-enabled", settingsShortcuts.checked);

  // Apply to all existing terminals
  applySettingsToAllTerminals();

  // Close modal
  settingsModal?.classList.add("hidden");
});

// Load settings on startup
loadSettings();

// Apply to Project Modal
const applyToProjectModal = document.getElementById("apply-to-project-modal");
const cancelApplyToProjectBtn = document.getElementById("cancel-apply-to-project");
const confirmApplyToProjectBtn = document.getElementById("confirm-apply-to-project");

cancelApplyToProjectBtn?.addEventListener("click", () => {
  applyToProjectModal?.classList.add("hidden");
});

confirmApplyToProjectBtn?.addEventListener("click", async () => {
  const sessionId = applyToProjectModal?.getAttribute("data-session-id");
  if (!sessionId) return;

  // Disable button during operation
  if (confirmApplyToProjectBtn) {
    confirmApplyToProjectBtn.textContent = "Applying...";
    confirmApplyToProjectBtn.setAttribute("disabled", "true");
  }

  try {
    const result = await ipcRenderer.invoke("apply-session-to-project", sessionId);

    if (result.success) {
      alert(`Changes applied successfully to project directory.`);
      applyToProjectModal?.classList.add("hidden");
    } else {
      alert(`Failed to apply changes: ${result.error}`);
    }
  } catch (error) {
    alert(`Error applying changes: ${error}`);
  } finally {
    // Re-enable button
    if (confirmApplyToProjectBtn) {
      confirmApplyToProjectBtn.textContent = "Apply Changes";
      confirmApplyToProjectBtn.removeAttribute("disabled");
    }
  }
});

// Sidebar toggle
function toggleSidebar() {
  const sidebar = document.getElementById("sidebar")!;
  const showBtn = document.getElementById("sidebar-show")!;
  const isCollapsed = sidebar.classList.contains("collapsed");

  if (isCollapsed) {
    sidebar.classList.remove("collapsed");
    showBtn.classList.remove("visible");
  } else {
    sidebar.classList.add("collapsed");
    showBtn.classList.add("visible");
  }

  // Refit active terminal after sidebar animation
  setTimeout(() => window.dispatchEvent(new Event("resize")), 300);
}

document.getElementById("sidebar-hide")?.addEventListener("click", toggleSidebar);
document.getElementById("sidebar-show")?.addEventListener("click", toggleSidebar);

// Close session menus when clicking outside
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest(".session-menu") && !target.classList.contains("session-menu-btn")) {
    document.querySelectorAll(".session-menu").forEach(menu => {
      menu.classList.add("hidden");
    });
  }
});

// Clear All Sessions button
document.getElementById("clear-all-sessions")?.addEventListener("click", async () => {
  if (!confirm("This will permanently delete ALL sessions, presets, and worktrees. Are you sure?")) return;

  const btn = document.getElementById("clear-all-sessions") as HTMLButtonElement;
  btn.textContent = "Clearing...";
  btn.disabled = true;

  try {
    await ipcRenderer.invoke("clear-all-sessions");

    // Clear all UI state
    sessions.forEach((session) => {
      if (session.element) session.element.remove();
      if (session.terminal) session.terminal.dispose();
    });
    sessions.clear();
    presetGroups.clear();
    loadedPresets = [];
    gridSessionIds = [];
    gridViewActive = false;
    activeSessionId = null;
    activeGridGroupId = null;

    // Clear DOM
    document.getElementById("session-list")!.innerHTML = "";
    document.getElementById("tabs")!.innerHTML = "";
    document.getElementById("grid-cells")!.innerHTML = "";
    document.getElementById("mcp-server-list")!.innerHTML = "";

    // Reset view
    document.getElementById("tabs")!.style.display = "";
    document.getElementById("session-container")!.style.display = "";
    const gridView = document.getElementById("grid-view")!;
    gridView.style.display = "none";
    gridView.classList.add("hidden");

    const mcpSection = document.getElementById("mcp-section");
    if (mcpSection) mcpSection.style.display = "none";

    settingsModal?.classList.add("hidden");
  } catch (error) {
    alert(`Error: ${error}`);
  } finally {
    btn.textContent = "Clear All Sessions & Data";
    btn.disabled = false;
  }
});

// Permission prompt for keyboard shortcuts
ipcRenderer.on("shortcut-permission-prompt", async () => {
  const yes = confirm(
    "Enable keyboard shortcuts?\n\n" +
    "Cmd+1-9: Switch between tabs/grid cells\n" +
    "Cmd+G: Toggle grid view\n\n" +
    "You can change this in Settings."
  );
  await ipcRenderer.invoke("set-shortcuts-enabled", yes);
});

// Keyboard shortcuts via main process (bypasses xterm capturing)
ipcRenderer.on("shortcut-switch-tab", (_event, index: number) => {
  if (gridViewActive) {
    if (index < gridSessionIds.length) {
      focusGridCell(gridSessionIds[index]);
    }
  } else {
    const tabs = document.querySelectorAll("#tabs .tab");
    if (index < tabs.length) {
      const tabId = tabs[index].id.replace("tab-", "");
      switchToSession(tabId);
    }
  }
});

ipcRenderer.on("shortcut-toggle-sidebar", () => {
  toggleSidebar();
});

ipcRenderer.on("shortcut-toggle-grid", () => {
  if (gridViewActive) {
    exitGridView();
  } else {
    const active = activeSessionId ? sessions.get(activeSessionId) : null;
    if (active?.presetGroupId) {
      enterGridViewForGroup(active.presetGroupId);
    }
  }
});
