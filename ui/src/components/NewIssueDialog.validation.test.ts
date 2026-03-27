import { describe, expect, it } from "vitest";
import { canSubmitNewIssue } from "./NewIssueDialog";

describe("canSubmitNewIssue", () => {
  it("requires title and project while not pending", () => {
    expect(canSubmitNewIssue({ title: "Scoped task", projectId: "project-1", isPending: false })).toBe(true);
    expect(canSubmitNewIssue({ title: "", projectId: "project-1", isPending: false })).toBe(false);
    expect(canSubmitNewIssue({ title: "Scoped task", projectId: "", isPending: false })).toBe(false);
    expect(canSubmitNewIssue({ title: "Scoped task", projectId: "project-1", isPending: true })).toBe(false);
  });
});
