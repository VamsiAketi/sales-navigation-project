import { describe, expect, it } from "vitest";
import type { ProjectIssueStatus } from "@paperclipai/shared";
import { buildHeartbeatProjectWorkflowContext } from "../services/heartbeat-project-workflow.js";

function stage(partial: Partial<ProjectIssueStatus> & Pick<ProjectIssueStatus, "value" | "name">): ProjectIssueStatus {
  return {
    id: partial.id ?? `${partial.value}-id`,
    projectId: partial.projectId ?? "project-1",
    companyId: partial.companyId ?? "company-1",
    color: partial.color ?? "#000000",
    position: partial.position ?? 0,
    isActive: partial.isActive ?? true,
    isHumanApproval: partial.isHumanApproval ?? false,
    approverUserIds: partial.approverUserIds ?? [],
    allowedActors: partial.allowedActors ?? "human_and_agent",
    defaultAssigneeUserId: partial.defaultAssigneeUserId ?? null,
    defaultAssigneeAgentId: partial.defaultAssigneeAgentId ?? null,
    allowedNextStatusValues: partial.allowedNextStatusValues ?? [],
    createdAt: partial.createdAt ?? new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: partial.updatedAt ?? new Date("2026-01-01T00:00:00.000Z"),
    ...partial,
  };
}

describe("buildHeartbeatProjectWorkflowContext", () => {
  it("returns null when the project has no workflow stages", () => {
    expect(buildHeartbeatProjectWorkflowContext([], "todo")).toBeNull();
  });

  it("returns the current stage and checkout stage metadata", () => {
    const result = buildHeartbeatProjectWorkflowContext(
      [
        stage({ value: "todo", name: "Todo", allowedNextStatusValues: ["in_progress"] }),
        stage({ value: "in_progress", name: "In Progress", allowedActors: "agent_only" }),
        stage({ value: "done", name: "Done" }),
      ],
      "todo",
    );

    expect(result).toEqual({
      currentStage: {
        value: "todo",
        name: "Todo",
        allowedNextStatusValues: ["in_progress"],
        allowedActors: "human_and_agent",
        isHumanApproval: false,
      },
      checkoutStage: {
        allowedActors: "agent_only",
      },
    });
  });
});
