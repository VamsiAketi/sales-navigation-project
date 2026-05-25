import type { ProjectIssueStatus } from "./types/project.js";
import { isBoardPinnedHiddenProjectIssueStatusValue } from "./constants.js";

/** Human-readable label for a workflow stage (`name` from project config, else title-cased `value`). */
export function projectIssueStatusDisplayLabel(
  statusValue: string,
  statusRow?: Pick<ProjectIssueStatus, "value" | "name"> | null,
): string {
  if (statusRow && statusRow.value === statusValue && statusRow.name.trim()) {
    return statusRow.name.trim();
  }
  if (statusValue === "backlog") return "Backlog";
  return statusValue.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function projectIssueStatusRequiresAssignee(statusValue: string): boolean {
  return !isBoardPinnedHiddenProjectIssueStatusValue(statusValue);
}

export function assigneeRequiredForStatusMessage(statusLabel: string): string {
  return `An assignee is required for tasks in ${statusLabel}.`;
}

export function assigneeRequiredToEnterStatusMessage(statusLabel: string): string {
  return `Assign an owner before moving this task to ${statusLabel}.`;
}

export function cannotUnassignInStatusMessage(statusLabel: string): string {
  return `This task cannot be unassigned while it is in ${statusLabel}.`;
}

export function workflowStatusHumanOnlyAssigneeMessage(statusLabel: string): string {
  return `${statusLabel} only allows human assignees. Assign a teammate or change this stage's assignment rules in the project workflow.`;
}

export function workflowStatusAgentOnlyAssigneeMessage(statusLabel: string): string {
  return `${statusLabel} only allows AI agent assignees. Assign an agent or change this stage's assignment rules in the project workflow.`;
}

export function workflowTransitionNotAllowedMessage(input: {
  fromLabel: string;
  toLabel: string;
  allowedNextLabels: string[];
}): string {
  const { fromLabel, toLabel, allowedNextLabels } = input;
  if (allowedNextLabels.length === 0) {
    return `Cannot move this task to ${toLabel} from ${fromLabel}. This stage has no allowed next steps configured.`;
  }
  return `Cannot move this task to ${toLabel} from ${fromLabel}. Allowed next stages: ${allowedNextLabels.join(", ")}.`;
}
