import { describe, expect, it } from "vitest";
import {
  buildCompactDataSection,
  computeIssueRunPromptFingerprint,
  stageLikelyNeedsProjectData,
} from "../services/issue-run-prompt-digest.js";
import { buildProjectDashboardApiGuide, buildProjectDataApiGuide } from "../services/project-data-api-guide.js";

describe("stageLikelyNeedsProjectData", () => {
  it("includes data when tables exist", () => {
    expect(
      stageLikelyNeedsProjectData({
        capabilityTags: [],
        agentInstructions: null,
        stagePlaybookSection: null,
        tableCount: 1,
        dashboardCount: 0,
      }),
    ).toBe(true);
  });

  it("skips data when no tables and stage text has no data signals", () => {
    expect(
      stageLikelyNeedsProjectData({
        capabilityTags: [],
        agentInstructions: "Draft the customer email.",
        stagePlaybookSection: "Write copy only.",
        tableCount: 0,
        dashboardCount: 0,
      }),
    ).toBe(false);
  });

  it("includes data when stage instructions mention tables", () => {
    expect(
      stageLikelyNeedsProjectData({
        capabilityTags: [],
        agentInstructions: "Insert rows into the campaign table.",
        stagePlaybookSection: null,
        tableCount: 0,
        dashboardCount: 0,
      }),
    ).toBe(true);
  });
});

describe("buildCompactDataSection", () => {
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
    expect(text).not.toContain("Design table and column names");
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
