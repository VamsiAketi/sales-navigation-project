import { describe, expect, it } from "vitest";
import { canSubmitNewIssue, formatRequiredFieldLabel, shouldForceTodoStatusOnCreateForProject } from "./NewIssueDialog";

describe("canSubmitNewIssue", () => {
  it("requires title and project while not pending", () => {
    expect(canSubmitNewIssue({ title: "Scoped task", projectId: "project-1", isPending: false })).toBe(true);
    expect(canSubmitNewIssue({ title: "", projectId: "project-1", isPending: false })).toBe(false);
    expect(canSubmitNewIssue({ title: "Scoped task", projectId: "", isPending: false })).toBe(false);
    expect(canSubmitNewIssue({ title: "Scoped task", projectId: "project-1", isPending: true })).toBe(false);
  });

  it("requires an assignee when status is not backlog", () => {
    expect(
      canSubmitNewIssue({
        title: "Scoped task",
        projectId: "project-1",
        isPending: false,
        status: "todo",
        hasAssignee: false,
      }),
    ).toBe(false);
    expect(
      canSubmitNewIssue({
        title: "Scoped task",
        projectId: "project-1",
        isPending: false,
        status: "todo",
        hasAssignee: true,
      }),
    ).toBe(true);
    expect(
      canSubmitNewIssue({
        title: "Scoped task",
        projectId: "project-1",
        isPending: false,
        status: "backlog",
        hasAssignee: false,
      }),
    ).toBe(true);
  });
});

describe("formatRequiredFieldLabel", () => {
  it("appends required marker for required fields", () => {
    expect(formatRequiredFieldLabel("Project")).toBe("Project *");
  });
});

describe("shouldForceTodoStatusOnCreateForProject", () => {
  it("forces todo for backlog and planned projects", () => {
    expect(shouldForceTodoStatusOnCreateForProject("backlog")).toBe(true);
    expect(shouldForceTodoStatusOnCreateForProject("planned")).toBe(true);
  });

  it("does not force todo once the project has started", () => {
    expect(shouldForceTodoStatusOnCreateForProject("in_progress")).toBe(false);
    expect(shouldForceTodoStatusOnCreateForProject("completed")).toBe(false);
    expect(shouldForceTodoStatusOnCreateForProject(null)).toBe(false);
  });
});
