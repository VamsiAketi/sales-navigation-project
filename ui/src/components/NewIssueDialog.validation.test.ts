import { describe, expect, it } from "vitest";
import { canSubmitNewIssue, formatRequiredFieldLabel } from "./NewIssueDialog";

describe("canSubmitNewIssue", () => {
  it("requires title and project while not pending", () => {
    expect(canSubmitNewIssue({ title: "Scoped task", projectId: "project-1", isPending: false })).toBe(true);
    expect(canSubmitNewIssue({ title: "", projectId: "project-1", isPending: false })).toBe(false);
    expect(canSubmitNewIssue({ title: "Scoped task", projectId: "", isPending: false })).toBe(false);
    expect(canSubmitNewIssue({ title: "Scoped task", projectId: "project-1", isPending: true })).toBe(false);
  });
});

describe("formatRequiredFieldLabel", () => {
  it("appends required marker for required fields", () => {
    expect(formatRequiredFieldLabel("Project")).toBe("Project *");
  });
});
