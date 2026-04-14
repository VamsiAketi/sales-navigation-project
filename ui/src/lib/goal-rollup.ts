import type { Issue, Project } from "@paperclipai/shared";

/** Whether a project counts toward a goal (dashboard stats, filters). */
export function projectLinkedToGoal(p: Project, goalId: string): boolean {
  if (p.goalIds?.includes(goalId)) return true;
  return p.goalId === goalId;
}

/** Whether an issue rolls up to a goal via direct link or its project. */
export function issueRollsUpToGoal(
  issue: Issue,
  goalId: string,
  projectById: Map<string, Project>,
): boolean {
  if (issue.goalId === goalId) return true;
  if (!issue.projectId) return false;
  const p = projectById.get(issue.projectId);
  return p ? projectLinkedToGoal(p, goalId) : false;
}

/** Statuses used for "Active" task counts on the dashboard goal cards. */
export const GOAL_ACTIVE_ISSUE_STATUSES = ["todo", "in_progress", "in_review"] as const;

export function isGoalActiveIssueStatus(status: string): boolean {
  return (GOAL_ACTIVE_ISSUE_STATUSES as readonly string[]).includes(status);
}
