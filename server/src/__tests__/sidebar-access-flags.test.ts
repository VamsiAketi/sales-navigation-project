import { describe, expect, it } from "vitest";
import type { PermissionKey } from "@paperclipai/shared";
import { buildSidebarAccessFlags } from "../lib/sidebar-access-flags.js";

describe("buildSidebarAccessFlags", () => {
  it("grants board teams read when any team-management permission is present", () => {
    const has = (key: PermissionKey) => key === "users:invite";
    const flags = buildSidebarAccessFlags(has, "board");
    expect(flags.canReadTeams).toBe(true);
    expect(flags.canEditTeams).toBe(false);
  });

  it("limits agent teams read to teams.read only", () => {
    const has = (key: PermissionKey) => key === "users:invite";
    const flags = buildSidebarAccessFlags(has, "agent");
    expect(flags.canReadTeams).toBe(false);
  });

  it("grants agent edit when agents.create is present without agents.edit", () => {
    const has = (key: PermissionKey) => key === "agents:create";
    const flags = buildSidebarAccessFlags(has);
    expect(flags.canReadAgents).toBe(true);
    expect(flags.canEditAgents).toBe(true);
  });

  it("denies all flags when no permissions are granted", () => {
    const flags = buildSidebarAccessFlags(() => false);
    expect(flags.canReadCommandCenter).toBe(false);
    expect(flags.canReadTasks).toBe(false);
    expect(flags.canManageConnectors).toBe(false);
  });
});
