import type { ProjectIssueStatus, ProjectIssueStatusAllowedActors } from "@paperclipai/shared";

export type HeartbeatProjectWorkflowStage = {
  value: string;
  name: string;
  description: string | null;
  agentInstructions: string | null;
  capabilityTags: string[];
  allowedNextStatusValues: string[];
  allowedActors: ProjectIssueStatusAllowedActors;
  isHumanApproval: boolean;
};

export type HeartbeatProjectWorkflowStageRef = {
  value: string;
  name: string;
};

export type HeartbeatProjectWorkflowContext = {
  /** Human-readable current stage; `issue.status` is only the API write key. */
  statusMeaning: string | null;
  currentStage: HeartbeatProjectWorkflowStage | null;
  checkoutStage: {
    value: string;
    name: string;
    allowedActors: ProjectIssueStatusAllowedActors;
  } | null;
  /** Legal next stages with display names (use `value` in PATCH/checkout). */
  allowedNextStages: HeartbeatProjectWorkflowStageRef[];
  allowedCheckoutStatuses: string[];
};

export function formatProjectWorkflowStatusMeaning(stageName: string, stageValue: string): string {
  return `${stageName} (API key: ${stageValue})`;
}

export function buildHeartbeatProjectWorkflowContext(
  statuses: ProjectIssueStatus[],
  issueStatus: string,
): HeartbeatProjectWorkflowContext | null {
  if (statuses.length === 0) return null;

  const byValue = new Map(statuses.map((status) => [status.value, status]));
  const current = byValue.get(issueStatus) ?? null;
  const checkout = current && current.allowedActors !== "human_only" ? current : null;
  const allowedCheckoutStatuses = statuses
    .filter((status) => status.isActive !== false && status.allowedActors !== "human_only")
    .map((status) => status.value);

  const allowedNextStages =
    current?.allowedNextStatusValues.map((value) => {
      const target = byValue.get(value);
      return { value, name: target?.name ?? value };
    }) ?? [];

  const statusMeaning = current ? formatProjectWorkflowStatusMeaning(current.name, current.value) : null;

  return {
    statusMeaning,
    currentStage: current
      ? {
          value: current.value,
          name: current.name,
          description: current.description ?? null,
          agentInstructions: current.agentInstructions ?? null,
          capabilityTags: current.agentCapabilityTags ?? [],
          allowedNextStatusValues: current.allowedNextStatusValues,
          allowedActors: current.allowedActors,
          isHumanApproval: current.isHumanApproval,
        }
      : null,
    checkoutStage: checkout
      ? { value: checkout.value, name: checkout.name, allowedActors: checkout.allowedActors }
      : null,
    allowedNextStages,
    allowedCheckoutStatuses,
  };
}
