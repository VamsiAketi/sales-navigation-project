import type { ProjectIssueStatus } from "./types/project.js";

/** Non-empty list means only those `value` keys are valid next statuses; `null` = unrestricted. */
export function projectIssueStatusRestrictedNextValues(
  meta: Pick<ProjectIssueStatus, "allowedNextStatusValues"> | undefined | null,
): string[] | null {
  const list = meta?.allowedNextStatusValues;
  if (!list || list.length === 0) return null;
  return list;
}

export function isProjectIssueWorkflowTransitionAllowed(
  fromValue: string,
  toValue: string,
  fromMeta: Pick<ProjectIssueStatus, "allowedNextStatusValues"> | undefined | null,
): boolean {
  if (fromValue === toValue) return true;
  const restricted = projectIssueStatusRestrictedNextValues(fromMeta);
  if (!restricted) return true;
  return restricted.includes(toValue);
}
