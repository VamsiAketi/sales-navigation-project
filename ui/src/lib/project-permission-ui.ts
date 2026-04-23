import type { ProjectPermissionKey } from "@paperclipai/shared";

export const PROJECT_PERMISSION_UI_GROUPS: {
  id: string;
  title: string;
  subtitle: string;
  keys: readonly ProjectPermissionKey[];
}[] = [
  {
    id: "project",
    title: "Project",
    subtitle: "Structure, lifecycle, and configuration surfaces.",
    keys: [
      "project:read",
      "project:settings",
      "project:workspaces",
      "project:statuses",
      "project:archive",
      "project:delete",
    ],
  },
  {
    id: "issues",
    title: "Tasks",
    subtitle: "Issue board, comments, attachments, and mutations.",
    keys: ["issue:read", "issue:write"],
  },
  {
    id: "admin",
    title: "Governance & spend",
    subtitle: "Delegated administration and financial views.",
    keys: ["members:manage", "budget:company_update", "costs:read"],
  },
];

const LABELS: Partial<Record<ProjectPermissionKey, string>> = {
  "project:read": "View project",
  "project:settings": "Edit project settings",
  "project:workspaces": "Manage workspaces",
  "project:statuses": "Manage workflow statuses",
  "project:archive": "Archive / unarchive",
  "project:delete": "Delete project",
  "issue:read": "View tasks",
  "issue:write": "Create & edit tasks",
  "members:manage": "Manage project access",
  "budget:company_update": "Edit company budget (from project context)",
  "costs:read": "View cost breakdowns",
};

export function projectPermissionLabel(key: ProjectPermissionKey): string {
  return LABELS[key] ?? key;
}

export const PROJECT_ACCESS_PRESETS: {
  id: string;
  label: string;
  description: string;
  keys: readonly ProjectPermissionKey[];
}[] = [
  { id: "none", label: "No access", description: "Remove all grants for this principal.", keys: [] },
  {
    id: "reader",
    label: "Reader",
    description: "Browse project and tasks only.",
    keys: ["project:read", "issue:read"],
  },
  {
    id: "contributor",
    label: "Contributor",
    description: "Work on tasks; cannot change project structure.",
    keys: ["project:read", "issue:read", "issue:write"],
  },
  {
    id: "maintainer",
    label: "Maintainer",
    description: "Full project ops except delete and org-wide budget.",
    keys: [
      "project:read",
      "project:settings",
      "project:workspaces",
      "project:statuses",
      "project:archive",
      "issue:read",
      "issue:write",
      "members:manage",
      "costs:read",
    ],
  },
  {
    id: "owner",
    label: "Owner (full)",
    description: "All capabilities including delete and company budget updates.",
    keys: [
      "project:read",
      "project:settings",
      "project:workspaces",
      "project:statuses",
      "project:archive",
      "project:delete",
      "issue:read",
      "issue:write",
      "members:manage",
      "budget:company_update",
      "costs:read",
    ],
  },
];
