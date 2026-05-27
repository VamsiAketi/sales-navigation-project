import { describe, expect, it } from "vitest";
import {
  buildCompactDataSection,
  computeIssueRunPromptFingerprint,
} from "../services/issue-run-prompt-digest.js";
import {
  ISSUE_PROJECT_DATA_VISIBILITY_MANDATORY_REVIEW,
} from "@paperclipai/shared";
import { buildProjectDashboardApiGuide, buildProjectDataApiGuide, formatProjectDashboardAgentGuidance } from "../services/project-data-api-guide.js";

describe("formatProjectDashboardAgentGuidance", () => {
  it("discourages agent telemetry dashboards", () => {
    const text = formatProjectDashboardAgentGuidance();
    expect(text).toContain("business users");
    expect(text).toContain("heartbeat runs");
    expect(text).toContain("run logs");
  });
});

describe("buildCompactDataSection", () => {
  it("always includes mandatory data and dashboard review", () => {
    const projectId = "proj-1";
    const projectDataApi = buildProjectDataApiGuide(projectId, null, []);
    const projectDashboardApi = buildProjectDashboardApiGuide(projectId, []);
    const text = buildCompactDataSection(projectId, projectDataApi, projectDashboardApi);
    expect(text).toContain(ISSUE_PROJECT_DATA_VISIBILITY_MANDATORY_REVIEW.split("\n")[0]!);
    expect(text).toContain("No tables yet");
    expect(text).toContain("No dashboards yet");
    expect(text).toContain("protocol step 5");
  });

  it("lists tables without repeating full rule blocks", () => {
    const projectId = "proj-1";
    const projectDataApi = buildProjectDataApiGuide(projectId, null, [
      {
        kind: "table",
        name: "items",
        definition: {
          primaryKey: ["id"],
          columns: [{ name: "title", type: "text" }],
        },
      },
    ]);
    const projectDashboardApi = buildProjectDashboardApiGuide(projectId, []);
    const text = buildCompactDataSection(projectId, projectDataApi, projectDashboardApi);
    expect(text).toContain("**items**");
    expect(text).toContain("POST /api/projects/proj-1/data");
    expect(text).toContain("operators");
    expect(text).toContain("heartbeat logs");
  });
});

describe("computeIssueRunPromptFingerprint", () => {
  it("changes when issue status changes", () => {
    const base = {
      projectId: "p1",
      workflowDocUpdatedAt: "2026-01-01",
      tableNames: ["a"],
      dashboardCount: 1,
    };
    const a = computeIssueRunPromptFingerprint({ ...base, issueStatus: "stage_a" });
    const b = computeIssueRunPromptFingerprint({ ...base, issueStatus: "stage_b" });
    expect(a).not.toBe(b);
  });
});
