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
    subtitle: "Configuration, workflow, budget, and lifecycle controls.",
    keys: [
      "project:read",
      "project:edit configuration",
      "project:edit Workflow",
      "project:edit Budget",
      "project:hide tickets",
      "project:archive",
    ],
  },
  {
    id: "issues",
    title: "Tasks",
    subtitle: "Create/update tasks under this project.",
    keys: ["project:edit tickets"],
  },
  {
    id: "admin",
    title: "Access",
    subtitle: "Delegate who can manage project principals.",
    keys: ["members:manage"],
  },
];

const LABELS: Partial<Record<ProjectPermissionKey, string>> = {
  "project:read": "View project",
  "project:edit tickets": "Edit tasks",
  "project:hide tickets": "Hide tasks",
  "project:edit configuration": "Edit configuration",
  "project:edit Workflow": "Edit workflow",
  "project:edit Budget": "Edit budget",
  "project:archive": "Archive / unarchive",
  "members:manage": "Manage project access",
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
    description: "Read-only project visibility.",
    keys: ["project:read"],
  },
  {
    id: "contributor",
    label: "Contributor",
    description: "Can read and edit tasks.",
    keys: ["project:read", "project:edit tickets"],
  },
  {
    id: "manager",
    label: "Manager",
    description: "Can manage tasks, workflow and budget.",
    keys: [
      "project:read",
      "project:edit tickets",
      "project:hide tickets",
      "project:edit Workflow",
      "project:edit Budget",
    ],
  },
  {
    id: "admin",
    label: "Admin",
    description: "Configuration + workflow + budget + access management.",
    keys: [
      "project:read",
      "project:edit configuration",
      "project:edit Workflow",
      "project:edit Budget",
      "members:manage",
    ],
  },
  {
    id: "owner",
    label: "Owner (full)",
    description: "All project-level permissions.",
    keys: [
      "project:read",
      "project:edit tickets",
      "project:hide tickets",
      "project:edit configuration",
      "project:edit Workflow",
      "project:edit Budget",
      "project:archive",
      "members:manage",
    ],
  },
];
