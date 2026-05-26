import { describe, expect, it } from "vitest";
import { canSubmitNewIssue, formatRequiredFieldLabel } from "./NewIssueDialog";

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

