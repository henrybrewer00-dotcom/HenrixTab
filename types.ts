export enum SessionType {
  WORKTREE = "worktree",
  LOCAL = "local"
}

export interface SessionConfig {
  projectDir: string;
  sessionType: SessionType;
  parentBranch?: string;
  branchName?: string;
  codingAgent: string;
  skipPermissions: boolean;
  setupCommands?: string[];
  customCommand?: string;
  presetGroupId?: string;
  presetGroupName?: string;
}

export interface PersistedSession {
  id: string;
  number: number;
  name: string;
  config: SessionConfig;
  worktreePath?: string;
  createdAt: number;
  sessionUuid: string;
  mcpConfigPath?: string;
  gitBranch?: string;
}

export interface PresetSlot {
  agent: "claude" | "codex" | "openrouter" | "custom";
  customCommand?: string;
}

export interface SessionPreset {
  id: string;
  name: string;
  projectDir: string;
  sessionType: SessionType;
  parentBranch?: string;
  slots: PresetSlot[];
  yoloMode: boolean;
  setupCommands?: string[];
}
