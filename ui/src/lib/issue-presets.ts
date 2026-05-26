import {
  CREATE_AGENT_ISSUE_TITLE,
  isBoardPinnedHiddenProjectIssueStatusValue,
  type ProjectIssueStatus,
} from "@paperclipai/shared";

export { CREATE_AGENT_ISSUE_TITLE };

/**
 * Default description for the hire-agent task. The assigned CEO (or hiring manager)
 * uses `paperclip-create-agent` to fulfill this.
 */
export const CREATE_AGENT_ISSUE_DESCRIPTION = `## Hire request

Describe the agent you want added to this company. The assignee (AI Admin) will use **paperclip-create-agent** to:

1. Review product projects to understand where the role fits (planning only — do not copy playbooks into AGENTS.md)
2. Author **role-first** **AGENTS.md** (mandate, Paperclip rules, runtime heartbeat-context pattern for any project)
3. Submit the hire (or board approval)

**Coordination rules:** Hire work stays on **AI-Admin Project**. The AI Admin should **not** create follow-up tasks for the new agent unless absolutely necessary (see skill). Product work is assigned later on the relevant projects.

### Role and scope
- **Role / title** (e.g. Sales development rep, CTO, Research analyst):
- **Reports to** (which existing agent or human lead):
- **Primary responsibilities** (3–5 bullets):

### Adapter and runtime
- **Adapter** (e.g. \`claude_local\`, \`codex_local\`, \`cursor\`, \`openclaw_gateway\`):
- **Working directory / repo** (if engineering):
- **Model** (if known):
- **Heartbeat** (interval, on-demand only, or disabled):

### Skills and permissions
- **Company skills** to attach (if any):
- **Can create sub-agents?** (yes/no)

### Prompt / behavior
- **What success looks like** in the first week:
- **Constraints** (budget, tools, approvals, things they must not do):
- **Heartbeat prompt focus** (what they should check each run — keep short):

### Governance
- [ ] Hire can proceed without board approval
- [ ] Board approval required before the agent is activated

### Links / context
- Related tasks, docs, or project context:

---
*Replace the sections above with your specifics. Remove sections that do not apply.*`;

/** Pick a workflow stage that exists on the project and agents can work in. */
export function resolveDefaultIssueStatusForAgentTask(statuses: ProjectIssueStatus[]): string {
  const sorted = [...statuses]
    .filter((status) => status.isActive !== false)
    .sort((a, b) => a.position - b.position);

  const agentStage = sorted.find(
    (status) =>
      !isBoardPinnedHiddenProjectIssueStatusValue(status.value)
      && status.allowedActors !== "human_only"
      && !status.isHumanApproval,
  );
  if (agentStage) return agentStage.value;

  const backlogAgentStage = sorted.find(
    (status) =>
      isBoardPinnedHiddenProjectIssueStatusValue(status.value)
      && status.allowedActors !== "human_only",
  );
  if (backlogAgentStage) return backlogAgentStage.value;

  const backlog = sorted.find((status) =>
    isBoardPinnedHiddenProjectIssueStatusValue(status.value),
  );
  if (backlog) return backlog.value;

  return sorted[0]?.value ?? "backlog";
}
