import type { ProjectIssueStatus, ProjectIssueStatusAllowedActors } from "@paperclipai/shared";

export type HeartbeatProjectWorkflowStage = {
  value: string;
  name: string;
  allowedNextStatusValues: string[];
  allowedActors: ProjectIssueStatusAllowedActors;
  isHumanApproval: boolean;
};

export type HeartbeatProjectWorkflowContext = {
  currentStage: HeartbeatProjectWorkflowStage | null;
  checkoutStage: {
    allowedActors: ProjectIssueStatusAllowedActors;
  } | null;
};

export function buildHeartbeatProjectWorkflowContext(
  statuses: ProjectIssueStatus[],
  issueStatus: string,
): HeartbeatProjectWorkflowContext | null {
  if (statuses.length === 0) return null;

  const byValue = new Map(statuses.map((status) => [status.value, status]));
  const current = byValue.get(issueStatus) ?? null;
  const checkout = byValue.get("in_progress") ?? null;

  return {
    currentStage: current
      ? {
          value: current.value,
          name: current.name,
          allowedNextStatusValues: current.allowedNextStatusValues,
          allowedActors: current.allowedActors,
          isHumanApproval: current.isHumanApproval,
        }
      : null,
    checkoutStage: checkout
      ? { allowedActors: checkout.allowedActors }
      : null,
  };
}
