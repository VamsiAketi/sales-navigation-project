import { describe, expect, it } from "vitest";
import { shouldWakeAssigneeOnStatusChange } from "../routes/issues-update-wakeup.js";

describe("shouldWakeAssigneeOnStatusChange", () => {
  const base = {
    statusInRequest: true,
    previousStatus: "todo",
    nextStatus: "in_progress",
    previousAssigneeAgentId: "agent-1",
    nextAssigneeAgentId: "agent-1",
  };

  it("wakes when status changes and assignee is unchanged", () => {
    expect(shouldWakeAssigneeOnStatusChange(base)).toBe(true);
  });

  it("skips when status is omitted from the request", () => {
    expect(shouldWakeAssigneeOnStatusChange({ ...base, statusInRequest: false })).toBe(false);
  });

  it("skips when status is unchanged", () => {
    expect(
      shouldWakeAssigneeOnStatusChange({
        ...base,
        previousStatus: "in_progress",
        nextStatus: "in_progress",
      }),
    ).toBe(false);
  });

  it("skips when assignee agent changes (handled by assignment wakeup)", () => {
    expect(
      shouldWakeAssigneeOnStatusChange({
        ...base,
        previousAssigneeAgentId: "agent-1",
        nextAssigneeAgentId: "agent-2",
      }),
    ).toBe(false);
  });

  it("skips when there is no assignee agent", () => {
    expect(
      shouldWakeAssigneeOnStatusChange({
        ...base,
        previousAssigneeAgentId: null,
        nextAssigneeAgentId: null,
      }),
    ).toBe(false);
  });

  it("skips when the issue moves into backlog", () => {
    expect(
      shouldWakeAssigneeOnStatusChange({
        ...base,
        previousStatus: "todo",
        nextStatus: "backlog",
      }),
    ).toBe(false);
  });

  it("wakes when leaving backlog with the same assignee", () => {
    expect(
      shouldWakeAssigneeOnStatusChange({
        ...base,
        previousStatus: "backlog",
        nextStatus: "todo",
      }),
    ).toBe(true);
  });
});
