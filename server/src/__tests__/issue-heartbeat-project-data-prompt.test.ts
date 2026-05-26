import { describe, expect, it } from "vitest";
import { buildIssueProjectDataInvocationPrompt } from "../services/issue-heartbeat-project-data-prompt.js";
import {
  buildProjectDashboardApiGuide,
  buildProjectDataApiGuide,
} from "../services/project-data-api-guide.js";

describe("buildIssueProjectDataInvocationPrompt", () => {
  const projectId = "proj-123";
  const projectDataApi = buildProjectDataApiGuide(projectId, "prj_internal", [
    {
      kind: "table",
      name: "work_items",
      definition: {
        primaryKey: ["id"],
        columns: [
          { name: "title", type: "text" },
          { name: "status", type: "text" },
        ],
      },
    },
  ]);
  const projectDashboardApi = buildProjectDashboardApiGuide(
    projectId,
    [
      {
        id: "view-1",
        name: "Overview",
        description: "Project metrics",
        widgets: [{ id: "w-1", title: "Active count", type: "kpi", queryRef: null }],
      },
    ],
    { exampleTableName: "work_items" },
  );

  it("includes table columns and dashboard routes", () => {
    const prompt = buildIssueProjectDataInvocationPrompt({
      projectId,
      projectDataApi,
      projectDashboardApi,
      currentStagePlaybook: null,
    });

    expect(prompt).toContain("title:text, status:text");
    expect(prompt).toContain("POST /api/projects/proj-123/data/{tableName}/rows");
    expect(prompt).toContain("Overview");
    expect(prompt).toContain("Active count (kpi)");
    expect(prompt).toContain("Issue comments are narrative only");
  });

  it("appends stage playbook when provided", () => {
    const prompt = buildIssueProjectDataInvocationPrompt({
      projectId,
      projectDataApi,
      projectDashboardApi,
      currentStagePlaybook: "Persist each completed item in the project data table before handoff.",
    });

    expect(prompt).toContain("Stage note (may require data writes)");
    expect(prompt).toContain("Persist each completed item");
  });
});
