import { describe, expect, it } from "vitest";
import { canSubmitNewIssue } from "./NewIssueDialog";

describe("canSubmitNewIssue", () => {
  it("returns false without project selection", () => {
    expect(canSubmitNewIssue({ title: "Task title", projectId: "", isPending: false })).toBe(false);
  });

  it("returns true only when title and project are present and request is idle", () => {
    expect(
      canSubmitNewIssue({
        title: "Task title",
        projectId: "project-1",
        isPending: false,
      }),
    ).toBe(true);
  });

  it("returns false while create request is pending", () => {
    expect(
      canSubmitNewIssue({
        title: "Task title",
        projectId: "project-1",
        isPending: true,
      }),
    ).toBe(false);
  });
});
