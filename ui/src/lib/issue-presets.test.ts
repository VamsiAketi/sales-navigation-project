import { describe, expect, it } from "vitest";
import type { ProjectIssueStatus } from "@paperclipai/shared";
import { resolveDefaultIssueStatusForAgentTask } from "./issue-presets";

function stage(
  value: string,
  overrides: Partial<ProjectIssueStatus> = {},
): ProjectIssueStatus {
  return {
    id: value,
    companyId: "co-1",
    projectId: "proj-1",
    name: value,
    value,
    color: "#000",
    position: 0,
    isActive: true,
    isHumanApproval: false,
    allowedActors: "human_and_agent",
    allowedNextStatusValues: [],
    approverUserIds: [],
    defaultAssigneeUserId: null,
    defaultAssigneeAgentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("resolveDefaultIssueStatusForAgentTask", () => {
  it("prefers the first agent-eligible stage in pipeline order", () => {
    const status = resolveDefaultIssueStatusForAgentTask([
      stage("backlog", { position: 0, allowedActors: "human_and_agent" }),
      stage("generate_lead", { position: 1, allowedActors: "agent_only", name: "Generate lead" }),
      stage("human_review", { position: 2, allowedActors: "human_only", isHumanApproval: true }),
    ]);
    expect(status).toBe("generate_lead");
  });

  it("falls back to backlog when no agent stage exists", () => {
    const status = resolveDefaultIssueStatusForAgentTask([
      stage("human_review", { position: 0, allowedActors: "human_only", isHumanApproval: true }),
      stage("backlog", { position: 1 }),
    ]);
    expect(status).toBe("backlog");
  });
});
