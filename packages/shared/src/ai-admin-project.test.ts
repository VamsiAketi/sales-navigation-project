import { describe, expect, it } from "vitest";
import {
  AI_ADMIN_PROJECT_NAME,
  CREATE_AGENT_ISSUE_TITLE,
  isAgentCreationIssueTitle,
  isAiAdminProject,
} from "./ai-admin-project.js";

describe("isAiAdminProject", () => {
  it("matches the canonical onboarding project name", () => {
    expect(isAiAdminProject(AI_ADMIN_PROJECT_NAME)).toBe(true);
    expect(isAiAdminProject("  AI-Admin Project  ")).toBe(true);
  });

  it("matches legacy onboarding names", () => {
    expect(isAiAdminProject("Default Project")).toBe(true);
    expect(isAiAdminProject("onboarding")).toBe(true);
  });

  it("does not match other projects", () => {
    expect(isAiAdminProject("Sales")).toBe(false);
  });
});

describe("isAgentCreationIssueTitle", () => {
  it("matches the hire preset title exactly", () => {
    expect(isAgentCreationIssueTitle(CREATE_AGENT_ISSUE_TITLE)).toBe(true);
    expect(isAgentCreationIssueTitle(`  ${CREATE_AGENT_ISSUE_TITLE}  `)).toBe(true);
    expect(isAgentCreationIssueTitle("Hire agent")).toBe(false);
  });
});
