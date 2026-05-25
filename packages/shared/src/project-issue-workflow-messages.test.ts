import { describe, expect, it } from "vitest";
import {
  assigneeRequiredForStatusMessage,
  assigneeRequiredToEnterStatusMessage,
  cannotUnassignInStatusMessage,
  projectIssueStatusDisplayLabel,
  workflowTransitionNotAllowedMessage,
} from "./project-issue-workflow-messages.js";

describe("projectIssueWorkflowMessages", () => {
  it("uses configured status name when available", () => {
    expect(
      projectIssueStatusDisplayLabel("in_qa", {
        value: "in_qa",
        name: "In QA",
      }),
    ).toBe("In QA");
  });

  it("formats status value when name is missing", () => {
    expect(projectIssueStatusDisplayLabel("in_progress")).toBe("In Progress");
  });

  it("mentions the target status for assignee rules", () => {
    expect(assigneeRequiredForStatusMessage("Todo")).toBe(
      "An assignee is required for tasks in Todo.",
    );
    expect(assigneeRequiredToEnterStatusMessage("In Review")).toBe(
      "Assign an owner before moving this task to In Review.",
    );
    expect(cannotUnassignInStatusMessage("In Progress")).toBe(
      "This task cannot be unassigned while it is in In Progress.",
    );
  });

  it("lists allowed next stages on transition errors", () => {
    expect(
      workflowTransitionNotAllowedMessage({
        fromLabel: "In Progress",
        toLabel: "Done",
        allowedNextLabels: ["In Review", "Blocked"],
      }),
    ).toBe(
      "Cannot move this task to Done from In Progress. Allowed next stages: In Review, Blocked.",
    );
  });
});
