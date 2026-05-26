type StatusChangeWakeInput = {
  statusInRequest: boolean;
  previousStatus: string;
  nextStatus: string;
  previousAssigneeAgentId: string | null;
  nextAssigneeAgentId: string | null;
};

/** Wake assignee on PATCH when status changes but assignee agent id is unchanged. */
export function shouldWakeAssigneeOnStatusChange(input: StatusChangeWakeInput): boolean {
  if (!input.statusInRequest) return false;
  if (input.previousStatus === input.nextStatus) return false;
  if (!input.nextAssigneeAgentId) return false;
  if (input.previousAssigneeAgentId !== input.nextAssigneeAgentId) return false;
  if (input.nextStatus === "backlog") return false;
  return true;
}
