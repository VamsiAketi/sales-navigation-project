/** Canonical name for the company onboarding / agent-operations project. */
export const AI_ADMIN_PROJECT_NAME = "AI-Admin Project";

/** Title for hire-coordination tasks opened from the + Agent flow. */
export const CREATE_AGENT_ISSUE_TITLE = "Create a new agent";

/** @deprecated Use {@link AI_ADMIN_PROJECT_NAME}. */
export const ONBOARDING_PROJECT_NAME = AI_ADMIN_PROJECT_NAME;

const LEGACY_AI_ADMIN_PROJECT_NAMES = new Set([
  "default project",
  "onboarding",
]);

export function normalizeProjectNameForMatch(name: string): string {
  return name.trim().toLowerCase();
}

export function isAiAdminProject(projectOrName: { name: string } | string): boolean {
  const normalized = normalizeProjectNameForMatch(
    typeof projectOrName === "string" ? projectOrName : projectOrName.name,
  );
  return (
    normalized === normalizeProjectNameForMatch(AI_ADMIN_PROJECT_NAME)
    || LEGACY_AI_ADMIN_PROJECT_NAMES.has(normalized)
  );
}

export function isAgentCreationIssueTitle(title: string): boolean {
  return title.trim() === CREATE_AGENT_ISSUE_TITLE;
}
