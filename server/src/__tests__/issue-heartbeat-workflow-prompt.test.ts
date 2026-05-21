import { describe, expect, it } from "vitest";
import {
  buildIssueWorkflowInvocationPrompt,
  extractWorkflowStageSection,
} from "../services/issue-heartbeat-workflow-prompt.js";
import { buildHeartbeatProjectWorkflowContext } from "../services/heartbeat-project-workflow.js";
import type { ProjectIssueStatus } from "@paperclipai/shared";

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

describe("extractWorkflowStageSection", () => {
  it("extracts a single stage section from workflow markdown", () => {
    const doc = [
      "# Playbook",
      "",
      "## Lead Generation",
      "- Done means: leads exist.",
      "",
      "## Qualified",
      "- Done means: qualified.",
    ].join("\n");

    expect(extractWorkflowStageSection(doc, "Lead Generation")).toBe("- Done means: leads exist.");
  });
});

describe("buildIssueWorkflowInvocationPrompt", () => {
  it("includes status meaning, allowed next stages, and stage playbook section", () => {
    const workflow = buildHeartbeatProjectWorkflowContext(
      [
        stage({
          value: "todo",
          name: "Lead Generation",
          allowedNextStatusValues: ["qualified", "blocked"],
          agentInstructions: "Do not advance until leads are in the project DB.",
        }),
        stage({ value: "qualified", name: "Qualified" }),
        stage({ value: "blocked", name: "Blocked" }),
      ],
      "todo",
    )!;

    const prompt = buildIssueWorkflowInvocationPrompt({
      issueIdentifier: "AIHAR-4",
      issueTitle: "sell AI Harness in India",
      issueStatus: "todo",
      projectWorkflow: workflow,
      workflowSummary: [
        "## Lead Generation",
        "- Done means: at least one lead row exists.",
        "",
        "## Qualified",
        "- Done means: outreach ready.",
      ].join("\n"),
      currentStagePlaybook: "Do not advance until leads are in the project DB.",
    });

    expect(prompt).toContain("AIHAR-4");
    expect(prompt).toContain("Lead Generation (API key: todo)");
    expect(prompt).toContain("Qualified (`qualified`)");
    expect(prompt).toContain("Do not advance until leads are in the project DB.");
    expect(prompt).toContain("at least one lead row exists");
    expect(prompt).toContain("Do not PATCH generic keys");
  });
});
