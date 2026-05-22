import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Root directory for one agent's isolated Cursor CLI config + data (SQLite lives here). */
export function resolveCursorAgentStateRoot(agentId: string, env: Record<string, string>): string {
  const stateRoot = asNonEmptyString(env.PAPERCLIP_CURSOR_STATE_ROOT)
    ?? asNonEmptyString(process.env.PAPERCLIP_CURSOR_STATE_ROOT);
  if (stateRoot) {
    return path.join(path.resolve(stateRoot), agentId);
  }

  const agentHome = asNonEmptyString(env.AGENT_HOME);
  if (agentHome) {
    return path.join(path.resolve(agentHome), ".cursor-state");
  }

  const paperclipHome =
    asNonEmptyString(env.PAPERCLIP_HOME) ?? asNonEmptyString(process.env.PAPERCLIP_HOME);
  if (paperclipHome) {
    return path.join(path.resolve(paperclipHome), "cursor-state", agentId);
  }

  return path.join(os.homedir(), ".cursor-state", agentId);
}

export function resolveCursorConfigDir(env: Record<string, string>): string {
  const explicit = asNonEmptyString(env.CURSOR_CONFIG_DIR);
  if (explicit) return path.resolve(explicit);

  const xdgConfig = asNonEmptyString(env.XDG_CONFIG_HOME);
  if (xdgConfig) return path.join(path.resolve(xdgConfig), "cursor");

  return path.join(os.homedir(), ".cursor");
}

export function resolveCursorSkillsHomeFromEnv(env: Record<string, string>): string {
  return path.join(resolveCursorConfigDir(env), "skills");
}

/** Apply per-agent Cursor dirs unless the operator set them explicitly in adapter env. */
export function applyCursorAgentStateDirs(
  agentId: string,
  env: Record<string, string>,
): Record<string, string> {
  if (asNonEmptyString(env.CURSOR_CONFIG_DIR) || asNonEmptyString(env.CURSOR_DATA_DIR)) {
    return env;
  }

  const root = resolveCursorAgentStateRoot(agentId, env);
  return {
    ...env,
    CURSOR_CONFIG_DIR: path.join(root, "config"),
    CURSOR_DATA_DIR: path.join(root, "data"),
  };
}

export async function ensureCursorAgentStateDirs(env: Record<string, string>): Promise<void> {
  const configDir = resolveCursorConfigDir(env);
  const dataDir = asNonEmptyString(env.CURSOR_DATA_DIR) ?? path.join(os.homedir(), ".cursor");
  await fs.mkdir(path.join(configDir, "skills"), { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
}
