import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpDown,
  Boxes,
  Bot,
  Check,
  DollarSign,
  FolderKanban,
  History,
  Inbox,
  LayoutDashboard,
  Loader2,
  Network,
  Settings2,
  Shield,
  Target,
  UserRound,
  Users,
  X
} from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { accessApi, type CompanyMember } from "../api/access";
import { agentsApi } from "../api/agents";
import { issuesApi } from "../api/issues";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { PERMISSION_KEYS, type Agent, type PermissionKey } from "@paperclipai/shared";
import { queryKeys } from "../lib/queryKeys";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InlineEntitySelector, type InlineEntityOption } from "@/components/InlineEntitySelector";
import { ApiError } from "../api/client";
import { isPermissionDeniedError } from "../lib/permission-feedback";
import {
  pickFirstCreatedHumanMemberId,
  pickFirstCreatedOwnerMemberId,
} from "../lib/org-defaults";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { azureSidebarIcon } from "../lib/sidebar-icon-tints";
import { authApi } from "../api/auth";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type TeamSortKey = "displayName" | "principal" | "type" | "role" | "title" | "reportsTo" | "status";
type TeamTypeFilter = "human" | "agent";

const HUMAN_ROLE_OPTIONS = ["owner", "Admin", "Manager", "Contributor", "Reader"] as const;

const AGENT_ROLE_OPTIONS = [
  "SREEngineer",
  "DevOpsEngineer",
  "QATestEngineer",
  "QAAutomationEngineer",
  "SystemsDesignEngineer",
  "BackendEngineer",
  "FrontendEngineer",
  "FullstackEngineer",
  "DataEngineer",
  "SecurityEngineer",
  "SupportEngineer",
  "ResearchEngineer"
] as const;

const COMPANY_ROLE_STORAGE_PREFIX = "paperclip.companyRoles";
const COMPANY_TITLE_STORAGE_PREFIX = "paperclip.companyTitles";
const COMPANY_HUMAN_ROLE_PERMISSIONS_STORAGE_PREFIX = "paperclip.companyHumanRolePermissions";
const DEFAULT_TITLE_OPTIONS = [
  "CEO",
  "COO",
  "CTO",
  "CFO",
  "VP Eng",
  "VP Product",
  "Director",
  "Manager",
  "Lead",
  "Intern",
] as const;
const ALL_PERMISSION_KEYS = [...PERMISSION_KEYS] as PermissionKey[];
const DEFAULT_INVITE_ROLE = "Manager";
const LEGACY_PERMISSION_MIGRATIONS: Partial<Record<PermissionKey, PermissionKey>> = {
  "teams.edit": "users:manage_permissions",
};
const READ_DEPENDENCIES: Partial<Record<PermissionKey, PermissionKey>> = {
  "agents:create": "agents.read",
  "agents.edit": "agents.read",
  "tasks.create": "tasks.read",
  "tasks:assign": "tasks.read",
  "tasks:assign_scope": "tasks.read",
  "skills.edit": "skills.read",
  "goals.write": "goals.read",
  "hybrid_org.edit": "hybrid_org.read",
  "hybrid_org.import": "hybrid_org.read",
  "hybrid_org.export": "hybrid_org.read",
  "teams.edit": "teams.read",
  "teams.title_create": "teams.read",
  "teams.title_assign": "teams.read",
  "teams.title_manage": "teams.read",
  "users:invite": "teams.read",
  "joins:approve": "teams.read",
  "users:manage_permissions": "teams.read",
  "company_settings.general": "company_settings.read",
  "company_settings.appearance": "company_settings.read",
  "company_settings.security_access": "company_settings.read",
  "company_settings.hiring": "company_settings.read",
  "company_settings.invites": "company_settings.read",
  "company_settings.secrets": "company_settings.read",
  "company_settings.packages": "company_settings.read",
};

function normalizePermissionSelection(keys: PermissionKey[]): PermissionKey[] {
  const next = new Set<PermissionKey>();
  for (const key of keys) {
    next.add(LEGACY_PERMISSION_MIGRATIONS[key] ?? key);
  }
  for (const [editKey, readKey] of Object.entries(READ_DEPENDENCIES) as Array<[PermissionKey, PermissionKey]>) {
    if (next.has(editKey)) next.add(readKey);
  }
  return ALL_PERMISSION_KEYS.filter((key) => next.has(key));
}

function defaultPermissionsForRole(role: string | null | undefined): PermissionKey[] {
  const normalized = (role ?? "").trim().toLowerCase();
  if (normalized === "owner") return [...ALL_PERMISSION_KEYS];
  const template = COMPANY_ROLE_PERMISSION_PRESETS[normalized];
  if (!template) return normalizePermissionSelection(COMPANY_ROLE_PERMISSION_PRESETS.manager ?? []);
  return normalizePermissionSelection(template);
}

const COMPANY_ROLE_PERMISSION_PRESETS: Record<string, PermissionKey[]> = {
  owner: [...ALL_PERMISSION_KEYS],
  admin: [
    "agents.read",
    "users:invite",
    "users:manage_permissions",
    "tasks.read",
    "tasks.create",
    "tasks:assign",
    "tasks:assign_scope",
    "joins:approve",
    "companies:create",
    "command_center.read",
    "hybrid_org.read",
    "hybrid_org.edit",
    "hybrid_org.import",
    "hybrid_org.export",
    "skills.read",
    "goals.read",
    "costs.read",
    "attention_queue.read",
    "teams.read",
    "teams.edit",
    "teams.title_create",
    "teams.title_assign",
    "teams.title_manage",
    "audit_logs.read",
    "company_settings.read",
    "company_settings.general",
    "company_settings.appearance",
    "company_settings.security_access",
    "company_settings.hiring",
    "company_settings.invites",
    "company_settings.secrets",
    "company_settings.packages",
  ],
  manager: [
    "agents.read",
    "agents.edit",
    "agents:create",
    "tasks.read",
    "tasks.create",
    "tasks:assign",
    "tasks:assign_scope",
    "joins:approve",
    "command_center.read",
    "hybrid_org.read",
    "hybrid_org.import",
    "hybrid_org.export",
    "skills.read",
    "skills.edit",
    "goals.read",
    "goals.write",
    "costs.read",
    "attention_queue.read",
    "teams.read",
    "teams.edit",
    "teams.title_assign",
    "company_settings.read",
  ],
  contributor: [
    "agents.read",
    "agents.edit",
    "tasks.read",
    "tasks.create",
    "tasks:assign",
    "command_center.read",
    "hybrid_org.read",
    "skills.read",
    "skills.edit",
    "goals.read",
    "goals.write",
    "attention_queue.read",
    "teams.read",
  ],
  reader: [
    "tasks.read",
    "agents.read",
    "command_center.read",
    "hybrid_org.read",
    "skills.read",
    "goals.read",
    "costs.read",
    "attention_queue.read",
    "teams.read",
    "audit_logs.read",
    "company_settings.read",
  ],
};

const PERMISSION_UI: Record<PermissionKey, { title: string }> = {
  "agents.read": {
    title: "View agents",
  },
  "agents.edit": {
    title: "Edit agents",
  },
  "agents:create": {
    title: "Create agents",
  },
  "users:invite": {
    title: "Invite teammates",
  },
  "users:manage_permissions": {
    title: "Manage roles & access",
  },
  "tasks.read": {
    title: "View tasks",
  },
  "tasks.create": {
    title: "Create tasks",
  },
  "tasks:assign": {
    title: "Assign work",
  },
  "tasks:assign_scope": {
    title: "Control assignment scope",
  },
  "joins:approve": {
    title: "Approve join requests",
  },
  "companies:create": {
    title: "Create companies",
  },
  "command_center.read": {
    title: "View Command Center",
  },
  "hybrid_org.read": {
    title: "View Hybrid Org Chart",
  },
  "hybrid_org.edit": {
    title: "Edit Hybrid Org Chart",
  },
  "hybrid_org.import": {
    title: "Import Hybrid Org Chart",
  },
  "hybrid_org.export": {
    title: "Export Hybrid Org Chart",
  },
  "skills.read": {
    title: "View Skills",
  },
  "skills.edit": {
    title: "Edit Skills",
  },
  "goals.read": {
    title: "View Goals",
  },
  "goals.write": {
    title: "Edit Goals",
  },
  "costs.read": {
    title: "View Costs",
  },
  "attention_queue.read": {
    title: "View Attention Queue",
  },
  "teams.read": {
    title: "View Teams",
  },
  "teams.edit": {
    title: "Edit Teams",
  },
  "teams.title_create": {
    title: "Create titles",
  },
  "teams.title_assign": {
    title: "Assign titles",
  },
  "teams.title_manage": {
    title: "Manage titles",
  },
  "audit_logs.read": {
    title: "View Audit Logs",
  },
  "company_settings.read": {
    title: "View Company Settings",
  },
  "company_settings.general": {
    title: "Edit Company Settings: General",
  },
  "company_settings.appearance": {
    title: "Edit Company Settings: Appearance",
  },
  "company_settings.security_access": {
    title: "Edit Company Settings: Security & Access",
  },
  "company_settings.hiring": {
    title: "Edit Company Settings: Hiring",
  },
  "company_settings.invites": {
    title: "Edit Company Settings: Invites",
  },
  "company_settings.secrets": {
    title: "Edit Company Settings: Secrets",
  },
  "company_settings.packages": {
    title: "Edit Company Settings: Company Packages",
  },
};

const PERMISSION_CATEGORY_DEFS: {
  id: string;
  title: string;
  keys: readonly PermissionKey[];
}[] = [
  {
    id: "team",
    title: "Team & access",
    keys: [
      "teams.read",
      "users:manage_permissions",
      "users:invite",
      "joins:approve",
      "teams.title_create",
      "teams.title_assign",
      "teams.title_manage",
    ],
  },
  {
    id: "agents",
    title: "Agents",
    keys: ["agents.read", "agents.edit", "agents:create"],
  },
  {
    id: "work",
    title: "Tasks & workflow",
    keys: ["tasks.read", "tasks.create", "tasks:assign", "tasks:assign_scope"],
  },
  {
    id: "command_center",
    title: "Command Center",
    keys: ["command_center.read"],
  },
  {
    id: "hybrid_org",
    title: "Hybrid Org Chart",
    keys: ["hybrid_org.read", "hybrid_org.edit", "hybrid_org.import", "hybrid_org.export"],
  },
  {
    id: "skills",
    title: "Skills",
    keys: ["skills.read", "skills.edit"],
  },
  {
    id: "goals",
    title: "Goals",
    keys: ["goals.read", "goals.write"],
  },
  {
    id: "costs",
    title: "Costs",
    keys: ["costs.read"],
  },
  {
    id: "attention_queue",
    title: "Attention Queue",
    keys: ["attention_queue.read"],
  },
  {
    id: "company",
    title: "Company management",
    keys: ["companies:create"],
  },
  {
    id: "audit_logs",
    title: "Audit Logs",
    keys: ["audit_logs.read"],
  },
  {
    id: "company_settings",
    title: "Company Settings",
    keys: [
      "company_settings.read",
      "company_settings.general",
      "company_settings.appearance",
      "company_settings.security_access",
      "company_settings.hiring",
      "company_settings.invites",
      "company_settings.secrets",
      "company_settings.packages",
    ],
  },
];

type HumanPermissionsPanelProps = {
  idPrefix: string;
  enabledKeys: PermissionKey[];
  onKeysChange: (keys: PermissionKey[]) => void;
  disabled?: boolean;
  intro?: ReactNode;
};

function HumanPermissionsPanel({
  idPrefix,
  enabledKeys,
  onKeysChange,
  disabled,
  intro,
}: HumanPermissionsPanelProps) {
  const enabledSet = useMemo(() => new Set(enabledKeys), [enabledKeys]);
  const reverseReadDependencies = useMemo(() => {
    const byReadPermission = new Map<PermissionKey, PermissionKey[]>();
    for (const [actionPermission, readPermission] of Object.entries(
      READ_DEPENDENCIES,
    ) as Array<[PermissionKey, PermissionKey]>) {
      const existing = byReadPermission.get(readPermission) ?? [];
      existing.push(actionPermission);
      byReadPermission.set(readPermission, existing);
    }
    return byReadPermission;
  }, []);

  const toggle = (key: PermissionKey, on: boolean) => {
    if (!on) {
      const blockingPermissions = (reverseReadDependencies.get(key) ?? []).filter((permission) =>
        enabledSet.has(permission),
      );
      if (blockingPermissions.length > 0) {
        return;
      }
    }
    const next = new Set(enabledKeys);
    if (on) next.add(key);
    else next.delete(key);
    onKeysChange(normalizePermissionSelection(ALL_PERMISSION_KEYS.filter((k) => next.has(k))));
  };

  const categoryIcon = (categoryId: string) => {
    switch (categoryId) {
      case "team":
        return { icon: Users, iconClassName: azureSidebarIcon.team };
      case "agents":
        return { icon: Bot, iconClassName: azureSidebarIcon.agents };
      case "work":
        return { icon: FolderKanban, iconClassName: azureSidebarIcon.tasks };
      case "command_center":
        return { icon: LayoutDashboard, iconClassName: azureSidebarIcon.dashboard };
      case "hybrid_org":
        return { icon: Network, iconClassName: azureSidebarIcon.org };
      case "skills":
        return { icon: Boxes, iconClassName: azureSidebarIcon.skills };
      case "goals":
        return { icon: Target, iconClassName: azureSidebarIcon.goals };
      case "costs":
        return { icon: DollarSign, iconClassName: azureSidebarIcon.costs };
      case "attention_queue":
        return { icon: Inbox, iconClassName: azureSidebarIcon.inbox };
      case "audit_logs":
        return { icon: History, iconClassName: azureSidebarIcon.audit };
      case "company":
        return { icon: Users, iconClassName: azureSidebarIcon.team };
      case "company_settings":
        return { icon: Settings2, iconClassName: azureSidebarIcon.settings };
      default:
        return { icon: Shield, iconClassName: "text-muted-foreground" };
    }
  };

  return (
    <div className="space-y-2">
      {intro ? (
        <div className="rounded-lg border border-border/40 bg-muted/20 px-2.5 py-2 ring-1 ring-border/25">
          <div className="min-w-0 space-y-1">{intro}</div>
        </div>
      ) : null}

      <div className="space-y-2">
        {PERMISSION_CATEGORY_DEFS.map((cat) => (
          <section key={cat.id} className="rounded-lg border border-border/50 bg-background/80 px-2.5 py-2">
            <header className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {(() => {
                    const { icon: Icon, iconClassName } = categoryIcon(cat.id);
                    return <Icon className={cn("size-3.5", iconClassName)} aria-hidden />;
                  })()}
                  {cat.title}
                </h3>
              </div>
              <span className="rounded-full border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {cat.keys.length}
              </span>
            </header>
            <ul className="ml-1 mt-2 space-y-1 border-l border-border/70 pl-2.5">
              {cat.keys.map((key) => {
                const checked = enabledSet.has(key);
                const ui = PERMISSION_UI[key];
                const sid = `${idPrefix}-${key}`;
                const isReadPermissionLocked =
                  checked &&
                  (reverseReadDependencies.get(key) ?? []).some((permission) => enabledSet.has(permission));
                return (
                  <li
                    key={key}
                    className="group flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/35"
                  >
                    <span className="h-px w-2 shrink-0 bg-border/80" aria-hidden />
                    <Checkbox
                      id={sid}
                      checked={checked}
                      disabled={disabled || isReadPermissionLocked}
                      onCheckedChange={(on) => toggle(key, on === true)}
                      aria-label={ui.title}
                      className="h-3.5 w-3.5 border-border/90 bg-background data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=unchecked]:border-muted-foreground/70"
                    />
                    <Label
                      htmlFor={sid}
                      className="min-w-0 flex-1 cursor-pointer truncate text-xs font-medium leading-tight text-foreground"
                    >
                        {ui.title}
                    </Label>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function normalizeRoleLabel(input: string) {
  const normalized = input.trim().replace(/\s+/g, " ");
  if (normalized.toLowerCase() === "owner") return "owner";
  return normalized;
}

function roleDisplayLabel(role: string | null | undefined) {
  const normalized = normalizeRoleLabel(role ?? "");
  if (!normalized) return "";
  return normalized === "owner" ? "Owner" : normalized;
}

function normalizeTitleLabel(input: string) {
  return input.trim().replace(/\s+/g, " ");
}

function readCompanyRolePrefs(companyId: string) {
  try {
    const raw = window.localStorage.getItem(`${COMPANY_ROLE_STORAGE_PREFIX}:${companyId}`);
    if (!raw) return { human: [] as string[], agent: [] as string[] };
    const parsed = JSON.parse(raw) as { human?: unknown; agent?: unknown };
    const human = Array.isArray(parsed.human) ? parsed.human.filter((v): v is string => typeof v === "string") : [];
    const agent = Array.isArray(parsed.agent) ? parsed.agent.filter((v): v is string => typeof v === "string") : [];
    return { human, agent };
  } catch {
    return { human: [] as string[], agent: [] as string[] };
  }
}

function writeCompanyRolePrefs(companyId: string, roles: { human: string[]; agent: string[] }) {
  try {
    window.localStorage.setItem(`${COMPANY_ROLE_STORAGE_PREFIX}:${companyId}`, JSON.stringify(roles));
  } catch {
    // ignore storage failures (private mode, etc.)
  }
}

function readCompanyTitlePrefs(companyId: string) {
  try {
    const raw = window.localStorage.getItem(`${COMPANY_TITLE_STORAGE_PREFIX}:${companyId}`);
    if (!raw) return [] as string[];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [] as string[];
    return parsed
      .filter((value): value is string => typeof value === "string")
      .map((value) => normalizeTitleLabel(value))
      .filter((value) => value.length > 0);
  } catch {
    return [] as string[];
  }
}

function writeCompanyTitlePrefs(companyId: string, titles: string[]) {
  try {
    window.localStorage.setItem(`${COMPANY_TITLE_STORAGE_PREFIX}:${companyId}`, JSON.stringify(titles));
  } catch {
    // ignore storage failures (private mode, etc.)
  }
}

function readHumanRolePermissions(companyId: string) {
  try {
    const raw = window.localStorage.getItem(
      `${COMPANY_HUMAN_ROLE_PERMISSIONS_STORAGE_PREFIX}:${companyId}`,
    );
    if (!raw) return {} as Record<string, PermissionKey[]>;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: Record<string, PermissionKey[]> = {};
    for (const [role, keys] of Object.entries(parsed)) {
      if (!Array.isArray(keys)) continue;
      const valid = keys.filter((k): k is PermissionKey =>
        typeof k === "string" && (PERMISSION_KEYS as readonly string[]).includes(k),
      );
      if (valid.length > 0) next[role] = valid;
    }
    return next;
  } catch {
    return {} as Record<string, PermissionKey[]>;
  }
}

function writeHumanRolePermissions(companyId: string, rolePermissions: Record<string, PermissionKey[]>) {
  try {
    window.localStorage.setItem(
      `${COMPANY_HUMAN_ROLE_PERMISSIONS_STORAGE_PREFIX}:${companyId}`,
      JSON.stringify(rolePermissions),
    );
  } catch {
    // ignore storage failures (private mode, etc.)
  }
}

function memberDisplayName(member: CompanyMember) {
  return member.principalType === "user"
    ? member.user?.name || member.user?.email || member.principalId
    : member.agent?.name || member.principalId;
}

function memberSecondaryLine(member: CompanyMember) {
  if (member.principalType === "user") return member.user?.email ?? "unknown email";
  return member.agent?.role ?? "agent";
}

function initialsFromLabel(label: string) {
  const name = label.trim();
  if (!name) return "U";
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase() || "U";
  }
  return name.slice(0, 2).toUpperCase();
}

function boardAvatarColorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  // Match board avatar palette.
  return `hsl(${hue}, 48%, 44%)`;
}

function nameToAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue}, 65%, 42%)`;
}

function memberAvatarInitials(member: CompanyMember): string {
  if (member.principalType === "user" && member.user) {
    const name = member.user.name?.trim();
    if (name) {
      const parts = name.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        const a = parts[0]![0];
        const b = parts[1]![0];
        if (a && b) return (a + b).toUpperCase();
      }
      return name.slice(0, 2).toUpperCase();
    }
    const email = member.user.email;
    if (email.length >= 2) return email.slice(0, 2).toUpperCase();
    return "?";
  }
  const raw = member.agent?.name ?? member.principalId;
  return raw.slice(0, 2).toUpperCase();
}

type DirectoryAvatarSize = "xs" | "sm" | "default" | "lg";

function DirectoryMemberAvatar({
  member,
  size = "default",
  className,
}: {
  member: CompanyMember;
  size?: DirectoryAvatarSize;
  className?: string;
}) {
  if (member.principalType === "agent") {
    return (
      <Avatar size={size} className={cn("ring-1 ring-border", className)}>
        <AvatarFallback className="bg-muted text-foreground">
          {size === "xs" ? (
            <span className="text-[10px] font-bold">{memberAvatarInitials(member)}</span>
          ) : (
            <Bot className="size-[55%] opacity-95" aria-hidden />
          )}
        </AvatarFallback>
      </Avatar>
    );
  }
  return (
    <Avatar size={size} className={className}>
      <AvatarFallback
        className={cn(
          "font-bold tracking-tight text-white ring-1 ring-black/20",
          size === "xs" ? "text-[10px]" : size === "sm" ? "text-xs" : "text-sm",
        )}
        style={{ backgroundColor: nameToAvatarColor(memberDisplayName(member)) }}
      >
        {memberAvatarInitials(member)}
      </AvatarFallback>
    </Avatar>
  );
}

function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Failed to save changes.";
}

function buildChildrenIndex(parentById: Record<string, string>) {
  const childrenById = new Map<string, string[]>();
  for (const [childId, parentId] of Object.entries(parentById)) {
    if (!parentId) continue;
    const list = childrenById.get(parentId) ?? [];
    list.push(childId);
    childrenById.set(parentId, list);
  }
  return childrenById;
}

function descendantsOf(rootId: string, childrenById: Map<string, string[]>) {
  const result = new Set<string>();
  const stack = [...(childrenById.get(rootId) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (result.has(next)) continue;
    result.add(next);
    const kids = childrenById.get(next);
    if (kids) stack.push(...kids);
  }
  return result;
}

export function CompanyDirectory() {
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const requestedHumanMemberId = searchParams.get("memberId")?.trim() || null;
  const [search, setSearch] = useState("");
  const [teamSortKey, setTeamSortKey] = useState<TeamSortKey>("displayName");
  const [teamSortDirection, setTeamSortDirection] = useState<"asc" | "desc">("asc");
  const [teamTypeFilter, setTeamTypeFilter] = useState<TeamTypeFilter>("human");
  const [selectedHumanMemberId, setSelectedHumanMemberId] = useState<string | null>(
    requestedHumanMemberId,
  );
  const [memberRoleDrafts, setMemberRoleDrafts] = useState<Record<string, string>>({});
  const [memberTitleDrafts, setMemberTitleDrafts] = useState<Record<string, string>>({});
  const [memberManagerDrafts, setMemberManagerDrafts] = useState<Record<string, string>>({});
  const [agentReportsDrafts, setAgentReportsDrafts] = useState<Record<string, string>>({});
  const [memberSaveStates, setMemberSaveStates] = useState<Record<string, SaveState>>({});
  const [memberSaveErrors, setMemberSaveErrors] = useState<Record<string, string>>({});
  const [customHumanRoles, setCustomHumanRoles] = useState<string[]>([]);
  const [customAgentRoles, setCustomAgentRoles] = useState<string[]>([]);
  const [customTitles, setCustomTitles] = useState<string[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [newHumanRole, setNewHumanRole] = useState("");
  const [newAgentRole, setNewAgentRole] = useState("");
  const [selectedManageHumanRole, setSelectedManageHumanRole] = useState<string>(HUMAN_ROLE_OPTIONS[0] ?? "owner");
  const [humanRolePermissions, setHumanRolePermissions] = useState<Record<string, PermissionKey[]>>({});
  const [rolesDialogOpen, setRolesDialogOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [humanDetailsDialogOpen, setHumanDetailsDialogOpen] = useState(false);
  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [offboardingIssueReassignDrafts, setOffboardingIssueReassignDrafts] = useState<Record<string, string>>({});
  const [offboardingSubmitPending, setOffboardingSubmitPending] = useState(false);
  const [humanInviteName, setHumanInviteName] = useState("");
  const [humanInviteEmail, setHumanInviteEmail] = useState("");
  const [humanInviteSubmitAttempted, setHumanInviteSubmitAttempted] = useState(false);
  const [humanInviteRole, setHumanInviteRole] = useState<string>(DEFAULT_INVITE_ROLE);
  const [humanInviteError, setHumanInviteError] = useState<string | null>(null);
  const [humanInvitePermissionKeys, setHumanInvitePermissionKeys] = useState<PermissionKey[]>([]);
  const [humanInviteCredentials, setHumanInviteCredentials] = useState<{
    name: string;
    email: string;
    temporaryUsername: string;
    temporaryPassword: string;
  } | null>(null);
  const [humanInviteCredentialsCopied, setHumanInviteCredentialsCopied] = useState(false);
  const normalizedManagerRoleByCompanyRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    if (!requestedHumanMemberId) return;
    setSelectedHumanMemberId(requestedHumanMemberId);
  }, [requestedHumanMemberId]);

  const {
    data: companyMembers,
    isLoading: membersLoading,
    error: membersError,
  } = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.access.members(selectedCompanyId)
      : ["access", "members", "none"],
    queryFn: () => accessApi.listMembers(selectedCompanyId!),
    enabled: !!selectedCompanyId
  });
  const { data: sidebarBadges } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.sidebarBadges(selectedCompanyId) : ["sidebar-badges", "none"],
    queryFn: () => sidebarBadgesApi.get(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    staleTime: 10_000,
  });
  const canReadTeams = sidebarBadges?.canReadTeams ?? true;
  const canEditTeams = sidebarBadges?.canEditTeams ?? true;
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: authApi.getSession,
    staleTime: 10_000,
  });
  const membersPermissionDenied = isPermissionDeniedError(membersError);

  const { data: agentsList } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.agents.list(selectedCompanyId) : ["agents", "none"],
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId
  });

  useEffect(() => {
    if (!selectedCompanyId) return;
    const prefs = readCompanyRolePrefs(selectedCompanyId);
    setCustomHumanRoles([]);
    setCustomAgentRoles(prefs.agent);
    setCustomTitles(readCompanyTitlePrefs(selectedCompanyId));
    setHumanRolePermissions(readHumanRolePermissions(selectedCompanyId));
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    writeCompanyRolePrefs(selectedCompanyId, { human: customHumanRoles, agent: customAgentRoles });
  }, [selectedCompanyId, customHumanRoles, customAgentRoles]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    writeCompanyTitlePrefs(selectedCompanyId, customTitles);
  }, [selectedCompanyId, customTitles]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    writeHumanRolePermissions(selectedCompanyId, humanRolePermissions);
  }, [selectedCompanyId, humanRolePermissions]);

  // Include both active + suspended users in the panel; only exclude deleted
  const activeHumanMembers = useMemo(
    () =>
      (companyMembers ?? []).filter(
        (member: CompanyMember) =>
          member.principalType === "user" &&
          (member.status === "active" || member.status === "suspended")
      ),
    [companyMembers]
  );
  const activeAgentMembers = useMemo(
    () =>
      (companyMembers ?? []).filter(
        (member: CompanyMember) => member.principalType === "agent" && member.status === "active"
      ),
    [companyMembers]
  );
  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;
  const currentUserMember = useMemo(
    () =>
      currentUserId
        ? activeHumanMembers.find((member) => member.principalId === currentUserId) ?? null
        : null,
    [activeHumanMembers, currentUserId],
  );
  const currentUserPermissionSet = useMemo(
    () => new Set((currentUserMember?.grants ?? []).map((grant) => grant.permissionKey as PermissionKey)),
    [currentUserMember?.grants],
  );
  const canCreateTitles = currentUserPermissionSet.has("teams.title_create");
  const canAssignTitles = currentUserPermissionSet.has("teams.title_assign");
  const canManageTitles = currentUserPermissionSet.has("teams.title_manage");
  const hasTitleAccess = canCreateTitles || canAssignTitles || canManageTitles;
  const canOpenRolesAndTitlesDialog = canEditTeams || canCreateTitles || canAssignTitles || canManageTitles;

  const filteredHumanMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activeHumanMembers;
    return activeHumanMembers.filter((m) => {
      const name = memberDisplayName(m).toLowerCase();
      const email = (m.user?.email ?? "").toLowerCase();
      const role = (m.membershipRole ?? "").toLowerCase();
      const title = (m.title ?? "").toLowerCase();
      return name.includes(q) || email.includes(q) || role.includes(q) || title.includes(q);
    });
  }, [activeHumanMembers, search]);

  const filteredAgentMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activeAgentMembers;
    return activeAgentMembers.filter((m) => {
      const name = memberDisplayName(m).toLowerCase();
      const agentRole = (m.agent?.role ?? "").toLowerCase();
      const orgRole = (m.membershipRole ?? "").toLowerCase();
      const title = (m.title ?? "").toLowerCase();
      return name.includes(q) || agentRole.includes(q) || orgRole.includes(q) || title.includes(q);
    });
  }, [activeAgentMembers, search]);

  function compareText(a: string, b: string) {
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  }

  function getHumanSortValue(member: CompanyMember, key: TeamSortKey): string {
    if (key === "displayName") return memberDisplayName(member);
    if (key === "principal") return member.user?.email ?? member.principalId;
    if (key === "type") return "Human";
    if (key === "role") return member.membershipRole ?? "";
    if (key === "title") return memberTitleDrafts[member.id] ?? member.title ?? "";
    if (key === "reportsTo") return memberManagerDrafts[member.id] ?? member.reportsToMembershipId ?? "";
    return member.status ?? "";
  }

  function getAgentSortValue(member: CompanyMember, key: TeamSortKey): string {
    if (key === "displayName") return memberDisplayName(member);
    if (key === "principal") return member.user?.email ?? "";
    if (key === "type") return "Agent";
    if (key === "role") return memberRoleDrafts[member.id] ?? member.membershipRole ?? "";
    if (key === "title") return memberTitleDrafts[member.id] ?? member.title ?? "";
    if (key === "reportsTo") return agentReportsDrafts[member.id] ?? "";
    return member.status ?? "active";
  }

  const sortedHumanMembers = useMemo(() => {
    const direction = teamSortDirection === "asc" ? 1 : -1;
    return [...filteredHumanMembers].sort((a, b) =>
      compareText(getHumanSortValue(a, teamSortKey), getHumanSortValue(b, teamSortKey)) * direction,
    );
  }, [filteredHumanMembers, teamSortDirection, teamSortKey, memberManagerDrafts, memberTitleDrafts]);

  const sortedAgentMembers = useMemo(() => {
    const direction = teamSortDirection === "asc" ? 1 : -1;
    return [...filteredAgentMembers].sort((a, b) =>
      compareText(getAgentSortValue(a, teamSortKey), getAgentSortValue(b, teamSortKey)) * direction,
    );
  }, [filteredAgentMembers, teamSortDirection, teamSortKey, memberRoleDrafts, agentReportsDrafts, memberTitleDrafts]);

  const toggleTeamSort = (key: TeamSortKey) => {
    if (teamSortKey === key) {
      setTeamSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setTeamSortKey(key);
    setTeamSortDirection("asc");
  };

  const hasActiveTeamFilters =
    search.trim().length > 0 ||
    teamSortKey !== "displayName" ||
    teamSortDirection !== "asc";

  const visibleTeamRows = useMemo(
    () =>
      teamTypeFilter === "human"
        ? sortedHumanMembers.map((member) => ({ kind: "human" as const, member }))
        : sortedAgentMembers.map((member) => ({ kind: "agent" as const, member })),
    [teamTypeFilter, sortedHumanMembers, sortedAgentMembers],
  );

  const persistedHumanRoles = useMemo(
    () =>
      Array.from(
        new Set(
          (companyMembers ?? [])
            .map((member) => normalizeRoleLabel(member.membershipRole ?? ""))
            .filter((role) => role.length > 0),
        ),
      ),
    [companyMembers],
  );

  const persistedAgentRoles = useMemo(
    () =>
      Array.from(
        new Set(
          (agentsList ?? [])
            .map((agent) => normalizeRoleLabel(agent.role ?? ""))
            .filter((role) => role.length > 0),
        ),
      ),
    [agentsList],
  );

  const manageHumanRoleOptions = useMemo(
    () => [...HUMAN_ROLE_OPTIONS] as string[],
    [],
  );
  const inviteHumanRoleOptions = useMemo(
    () => manageHumanRoleOptions.filter((role) => role.toLowerCase() !== "owner"),
    [manageHumanRoleOptions],
  );
  const assignableAgentRoleOptions = useMemo(
    () => Array.from(new Set([...AGENT_ROLE_OPTIONS, ...persistedAgentRoles, ...customAgentRoles])),
    [customAgentRoles, persistedAgentRoles],
  );
  const availableTitleOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...DEFAULT_TITLE_OPTIONS.map((title) => normalizeTitleLabel(title)),
          ...customTitles.map((title) => normalizeTitleLabel(title)),
          ...(companyMembers ?? []).map((member) => normalizeTitleLabel(member.title ?? "")),
        ].filter((title) => title.length > 0)),
      ),
    [companyMembers, customTitles],
  );

  useEffect(() => {
    if (manageHumanRoleOptions.length === 0) {
      setSelectedManageHumanRole("");
      return;
    }
    if (!selectedManageHumanRole || !manageHumanRoleOptions.includes(selectedManageHumanRole)) {
      setSelectedManageHumanRole(manageHumanRoleOptions[0] ?? "");
    }
  }, [manageHumanRoleOptions, selectedManageHumanRole]);

  const permissionsForRole = (role: string | null | undefined): PermissionKey[] => {
    if (!role) return [];
    const override = humanRolePermissions[role];
    if (override && override.length > 0) return normalizePermissionSelection(override);
    return defaultPermissionsForRole(role);
  };

  const selectedHumanMember =
    selectedHumanMemberId ? activeHumanMembers.find((m) => m.id === selectedHumanMemberId) ?? null : null;
  const selectedHumanPrincipalId = selectedHumanMember?.principalId ?? null;

  const offboardingReassignOptions = useMemo(
    () =>
      activeHumanMembers
        .filter((candidate) => candidate.id !== selectedHumanMember?.id)
        .map((candidate) => ({
          id: candidate.principalId,
          label: memberDisplayName(candidate),
        })),
    [activeHumanMembers, selectedHumanMember?.id],
  );

  const { data: assignedIssuesForSelectedHuman } = useQuery({
    queryKey: selectedCompanyId && selectedHumanPrincipalId
      ? [...queryKeys.issues.list(selectedCompanyId), "offboarding-preview", selectedHumanPrincipalId]
      : ["issues", "offboarding-preview", "none"],
    queryFn: () => issuesApi.list(selectedCompanyId!, { assigneeUserId: selectedHumanPrincipalId! }),
    enabled: Boolean(selectedCompanyId && selectedHumanPrincipalId && (deactivateDialogOpen || deleteDialogOpen)),
  });

  useEffect(() => {
    if (deactivateDialogOpen || deleteDialogOpen) return;
    setOffboardingIssueReassignDrafts({});
    setOffboardingSubmitPending(false);
  }, [deactivateDialogOpen, deleteDialogOpen]);

  async function applyOffboardingIssueReassignments() {
    if (!selectedCompanyId) return 0;
    const issueRows = assignedIssuesForSelectedHuman ?? [];
    const issueById = new Map(issueRows.map((issue) => [issue.id, issue]));
    const updates = Object.entries(offboardingIssueReassignDrafts)
      .map(([issueId, assigneeUserId]) => ({
        issueId,
        assigneeUserId: assigneeUserId.trim(),
      }))
      .filter((entry) => entry.assigneeUserId.length > 0 && issueById.has(entry.issueId));
    if (updates.length === 0) return 0;

    await Promise.all(
      updates.map((entry) =>
        issuesApi.update(entry.issueId, {
          assigneeUserId: entry.assigneeUserId,
          assigneeAgentId: null,
        }),
      ),
    );

    await queryClient.invalidateQueries({
      queryKey: queryKeys.issues.list(selectedCompanyId),
    });
    await queryClient.invalidateQueries({
      queryKey: [...queryKeys.issues.list(selectedCompanyId), "offboarding-preview", selectedHumanPrincipalId],
    });
    return updates.length;
  }

  function renderOffboardingIssuesPanel() {
    const issues = assignedIssuesForSelectedHuman ?? [];
    if (issues.length === 0) return null;
    return (
      <div className="mt-3 rounded-xl border border-border/60 bg-muted/30 p-3">
        <p className="text-xs font-medium text-foreground">
          This user is currently assigned to {issues.length} ticket(s).
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Optionally choose a replacement assignee for each ticket before you continue.
        </p>
        <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
          {issues.map((issue) => (
            <div key={issue.id} className="grid gap-2 rounded-md border border-border/50 bg-background p-2 md:grid-cols-[1fr_220px]">
              <Link
                to={`/issues/${issue.id}`}
                className="block rounded px-1 py-1 text-xs hover:bg-accent"
              >
                <span className="font-medium text-foreground">{issue.identifier}</span>{" "}
                <span className="text-muted-foreground">- {issue.title}</span>
              </Link>
              <InlineEntitySelector
                value={offboardingIssueReassignDrafts[issue.id] ?? ""}
                options={offboardingReassignOptions}
                placeholder="Reassign to"
                noneLabel="Keep auto-assignee"
                searchPlaceholder="Search humans..."
                emptyMessage="No humans found."
                openOnFocus={false}
                renderTriggerValue={(option) =>
                  option ? (
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                        style={{ backgroundColor: boardAvatarColorFromName(option.label) }}
                      >
                        {initialsFromLabel(option.label)}
                      </span>
                      <span className="truncate">{option.label}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Keep auto-assignee</span>
                  )
                }
                renderOption={(option) =>
                  option.id ? (
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                        style={{ backgroundColor: boardAvatarColorFromName(option.label) }}
                      >
                        {initialsFromLabel(option.label)}
                      </span>
                      <span className="truncate">{option.label}</span>
                    </span>
                  ) : (
                    <span className="truncate text-muted-foreground">{option.label}</span>
                  )
                }
                onChange={(next) =>
                  setOffboardingIssueReassignDrafts((prev) => ({
                    ...prev,
                    [issue.id]: next,
                  }))
                }
                className="h-9 w-full justify-between rounded-md border-border/60 bg-background text-xs"
                triggerAriaLabel={`Reassign ${issue.identifier}`}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const memberById = useMemo(() => {
    const map = new Map<string, CompanyMember>();
    for (const m of companyMembers ?? []) map.set(m.id, m);
    return map;
  }, [companyMembers]);

  const memberByPrincipalId = useMemo(() => {
    const map = new Map<string, CompanyMember>();
    for (const m of companyMembers ?? []) map.set(m.principalId, m);
    return map;
  }, [companyMembers]);

  const memberPrincipalTypeById = useMemo(() => {
    const map = new Map<string, CompanyMember["principalType"]>();
    for (const m of companyMembers ?? []) map.set(m.id, m.principalType);
    return map;
  }, [companyMembers]);

  const agentByPrincipalId = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agentsList ?? []) map.set(a.id, a);
    return map;
  }, [agentsList]);

  const childrenByMemberId = useMemo(() => {
    const parentById: Record<string, string> = {};
    for (const member of activeHumanMembers) {
      parentById[member.id] = (memberManagerDrafts[member.id] ?? member.reportsToMembershipId ?? "").trim();
    }
    return buildChildrenIndex(parentById);
  }, [activeHumanMembers, memberManagerDrafts]);

  const agentChildrenByPrincipalId = useMemo(() => {
    const parentById: Record<string, string> = {};
    for (const member of activeAgentMembers) {
      const draft = agentReportsDrafts[member.id];
      const fromServer = agentByPrincipalId.get(member.principalId)?.reportsTo ?? "";
      parentById[member.principalId] = (draft !== undefined ? draft : fromServer).trim();
    }
    return buildChildrenIndex(parentById);
  }, [activeAgentMembers, agentReportsDrafts, agentByPrincipalId]);

  const invalidManagersForSelectedHuman = useMemo(() => {
    if (!selectedHumanMember) return new Set<string>();
    const invalid = descendantsOf(selectedHumanMember.id, childrenByMemberId);
    invalid.add(selectedHumanMember.id);
    return invalid;
  }, [selectedHumanMember?.id, childrenByMemberId]);

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Teams" }
    ]);
  }, [setBreadcrumbs, selectedCompany?.name]);

  useEffect(() => {
    if (activeHumanMembers.length === 0) {
      setSelectedHumanMemberId(null);
    } else if (selectedHumanMemberId && !activeHumanMembers.some((m) => m.id === selectedHumanMemberId)) {
      setSelectedHumanMemberId(null);
    }
  }, [activeHumanMembers, selectedHumanMemberId]);

  useEffect(() => {
    const nextRoleDrafts: Record<string, string> = {};
    const nextTitleDrafts: Record<string, string> = {};
    const nextManagerDrafts: Record<string, string> = {};
    const nextAgentReportsDrafts: Record<string, string> = {};
    for (const member of activeHumanMembers) {
      nextRoleDrafts[member.id] = member.membershipRole ?? "";
      nextTitleDrafts[member.id] = member.title ?? "";
      nextManagerDrafts[member.id] = member.reportsToMembershipId ?? "";
    }
    for (const member of activeAgentMembers) {
      nextRoleDrafts[member.id] = member.membershipRole ?? "";
      nextTitleDrafts[member.id] = member.title ?? "";
      nextAgentReportsDrafts[member.id] = agentByPrincipalId.get(member.principalId)?.reportsTo ?? "";
    }
    setMemberRoleDrafts(nextRoleDrafts);
    setMemberTitleDrafts(nextTitleDrafts);
    setMemberManagerDrafts(nextManagerDrafts);
    setAgentReportsDrafts(nextAgentReportsDrafts);
  }, [activeHumanMembers, activeAgentMembers, agentByPrincipalId]);

  const invalidateMembers = async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.access.members(selectedCompanyId!)
    });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.sidebarBadges(selectedCompanyId!)
    });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.dashboard(selectedCompanyId!)
    });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.org(selectedCompanyId!)
    });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.agents.list(selectedCompanyId!)
    });
  };

  useEffect(() => {
    if (!selectedCompanyId) return;
    if (normalizedManagerRoleByCompanyRef.current[selectedCompanyId]) return;

    const membersToConvert = activeHumanMembers.filter((member) => {
      const role = normalizeRoleLabel(member.membershipRole ?? "");
      return role.toLowerCase() !== "owner" && role.toLowerCase() !== "manager";
    });

    if (membersToConvert.length === 0) {
      normalizedManagerRoleByCompanyRef.current[selectedCompanyId] = true;
      return;
    }

    let cancelled = false;
    const managerGrants = permissionsForRole("Manager").map((permissionKey) => ({
      permissionKey,
      scope: null as Record<string, unknown> | null,
    }));

    (async () => {
      try {
        await Promise.all(
          membersToConvert.map((member) =>
            accessApi.updateMemberOrgConfig(selectedCompanyId, member.id, {
              membershipRole: "Manager",
              reportsToMembershipId: member.reportsToMembershipId ?? null,
            }),
          ),
        );
        await Promise.all(
          membersToConvert.map((member) =>
            accessApi.updateMemberPermissions(selectedCompanyId, member.id, managerGrants),
          ),
        );
        if (!cancelled) {
          await invalidateMembers();
          pushToast({
            title: "Roles updated",
            body: "All non-owner users were converted to Manager.",
            tone: "success",
          });
        }
      } catch (error) {
        if (!cancelled) {
          pushToast({
            title: "Role update failed",
            body: apiErrorMessage(error),
            tone: "error",
          });
        }
      } finally {
        normalizedManagerRoleByCompanyRef.current[selectedCompanyId] = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId, activeHumanMembers]);

  const humanInviteMutation = useMutation({
    mutationFn: () =>
      accessApi.createHumanInvite(selectedCompanyId!, {
        email: humanInviteEmail.trim(),
        name: humanInviteName.trim() || undefined,
        grants: humanInvitePermissionKeys.map((permissionKey) => ({
          permissionKey,
          scope: null,
        })),
      }),
    onSuccess: async (created) => {
      const invitedMembershipRole =
        humanInviteRole.trim().length > 0 ? humanInviteRole.trim() : DEFAULT_INVITE_ROLE;
      setHumanInviteError(null);
      setHumanInviteSubmitAttempted(false);
      setHumanInviteCredentialsCopied(false);
      setHumanInviteCredentials({
        name: created.name,
        email: created.email,
        temporaryUsername: created.temporaryUsername,
        temporaryPassword: created.temporaryPassword,
      });
      setHumanInviteName("");
      setHumanInviteEmail("");
      setHumanInviteRole(DEFAULT_INVITE_ROLE);
      setHumanInvitePermissionKeys(defaultPermissionsForRole(DEFAULT_INVITE_ROLE));
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sidebarBadges(selectedCompanyId!),
      });
      try {
        const members = await accessApi.listMembers(selectedCompanyId!);
        const createdMember =
          members.find(
            (member) =>
              member.principalType === "user" &&
              member.principalId === created.userId &&
              member.status === "active",
          ) ?? null;
        if (createdMember) {
          const firstHumanMemberId = pickFirstCreatedHumanMemberId(members);
          const firstOwnerMemberId = pickFirstCreatedOwnerMemberId(members);
          const reportsToMembershipId = firstOwnerMemberId ?? firstHumanMemberId;

          await accessApi.updateMemberOrgConfig(selectedCompanyId!, createdMember.id, {
            membershipRole: invitedMembershipRole,
            reportsToMembershipId: reportsToMembershipId && reportsToMembershipId !== createdMember.id
              ? reportsToMembershipId
              : null,
          });
        }
      } catch {
        // Invite succeeded; keep UX resilient if default assignment fails.
      }
      await invalidateMembers();
    },
    onError: (err) => {
      setHumanInviteCredentialsCopied(false);
      setHumanInviteCredentials(null);
      setHumanInviteError(err instanceof Error ? err.message : "Failed to create human invite");
    },
  });

  useEffect(() => {
    setHumanInvitePermissionKeys(permissionsForRole(humanInviteRole));
  }, [humanInviteRole]);

  useEffect(() => {
    if (inviteDialogOpen) return;
    setHumanInviteCredentials(null);
    setHumanInviteCredentialsCopied(false);
    setHumanInviteSubmitAttempted(false);
    setHumanInviteError(null);
  }, [inviteDialogOpen]);

  const humanSaveMutation = useMutation({
    mutationFn: (input: {
      memberId: string;
      membershipRole?: string | null;
      title?: string | null;
      reportsToMembershipId?: string | null;
    }) =>
      accessApi.updateMemberOrgConfig(selectedCompanyId!, input.memberId, {
        membershipRole: input.membershipRole,
        title: input.title,
        reportsToMembershipId: input.reportsToMembershipId
      }),
    onSuccess: invalidateMembers
  });

  const deactivateHumanMutation = useMutation({
    mutationFn: (memberId: string) =>
      accessApi.updateMemberStatus(selectedCompanyId!, memberId, "suspended"),
    onSuccess: invalidateMembers,
  });

  const reactivateHumanMutation = useMutation({
    mutationFn: (memberId: string) =>
      accessApi.updateMemberStatus(selectedCompanyId!, memberId, "active"),
    onSuccess: invalidateMembers,
  });

  const removeHumanMutation = useMutation({
    mutationFn: (memberId: string) => accessApi.removeMember(selectedCompanyId!, memberId),
    onSuccess: () => {
      setSelectedHumanMemberId(null);
      invalidateMembers();
    },
  });
  const humanPermissionMutation = useMutation({
    mutationFn: (input: { memberId: string; grants: Array<{ permissionKey: PermissionKey; scope: Record<string, unknown> | null }> }) =>
      accessApi.updateMemberPermissions(selectedCompanyId!, input.memberId, input.grants),
    onSuccess: invalidateMembers
  });

  const agentSaveMutation = useMutation({
    mutationFn: (input: { memberId: string; principalId: string; membershipRole: string | null; reportsTo: string | null }) =>
      agentsApi.update(input.principalId, { reportsTo: input.reportsTo }, selectedCompanyId ?? undefined),
    onSuccess: invalidateMembers
  });

  function setMemberSaveState(memberId: string, state: SaveState) {
    setMemberSaveStates((prev) => {
      if (prev[memberId] === state) return prev;
      return { ...prev, [memberId]: state };
    });
  }

  function getMemberSaveState(memberId: string | null) {
    if (!memberId) return "idle" as const;
    return memberSaveStates[memberId] ?? "idle";
  }

  function computeDirty(member: CompanyMember | null) {
    if (!member) return false;
    const roleDraft = (memberRoleDrafts[member.id] ?? "").trim();
    const titleDraft = (memberTitleDrafts[member.id] ?? "").trim();
    const mgrDraft = (memberManagerDrafts[member.id] ?? "").trim();
    const roleNow = (member.membershipRole ?? "").trim();
    const titleNow = (member.title ?? "").trim();
    const mgrNow = (member.reportsToMembershipId ?? "").trim();
    return roleDraft !== roleNow || titleDraft !== titleNow || mgrDraft !== mgrNow;
  }

  const humanIsDirty = computeDirty(selectedHumanMember);
  const selectedHumanManagerId = selectedHumanMember
    ? (memberManagerDrafts[selectedHumanMember.id] ?? "").trim()
    : "";
  const selectedHumanRoleDraft = selectedHumanMember
    ? (memberRoleDrafts[selectedHumanMember.id] ?? "").trim()
    : "";
  const selectedHumanManagerIsAgent =
    !!selectedHumanManagerId && memberPrincipalTypeById.get(selectedHumanManagerId) === "agent";

  function revertDraftsToServer(memberId: string) {
    const serverMember = memberById.get(memberId) ?? null;
    if (!serverMember) return;
    setMemberRoleDrafts((prev) => ({ ...prev, [memberId]: serverMember.membershipRole ?? "" }));
    setMemberTitleDrafts((prev) => ({ ...prev, [memberId]: serverMember.title ?? "" }));
    setMemberManagerDrafts((prev) => ({ ...prev, [memberId]: serverMember.reportsToMembershipId ?? "" }));
  }

  function saveHumanRowEdits(member: CompanyMember, nextRole: string, nextTitle: string, nextManagerId: string) {
    if (!selectedCompanyId) return;
    const managerPrincipalType = nextManagerId ? memberPrincipalTypeById.get(nextManagerId) : null;
    if (nextManagerId && managerPrincipalType === "agent") {
      setMemberSaveState(member.id, "error");
      setMemberSaveErrors((prev) => ({
        ...prev,
        [member.id]: "Humans can only report to another human.",
      }));
      return;
    }

    setMemberSaveState(member.id, "saving");
    humanSaveMutation.mutate(
      {
        memberId: member.id,
        membershipRole: nextRole.trim() || null,
        title: normalizeTitleLabel(nextTitle) || null,
        reportsToMembershipId: nextManagerId.trim() || null,
      },
      {
        onSuccess: () => {
          setMemberSaveState(member.id, "saved");
          setMemberSaveErrors((prev) => {
            if (!prev[member.id]) return prev;
            const { [member.id]: _drop, ...rest } = prev;
            return rest;
          });
          humanPermissionMutation.mutate({
            memberId: member.id,
            grants: permissionsForRole(nextRole).map((permissionKey) => ({
              permissionKey,
              scope: null,
            })),
          });
          window.setTimeout(() => setMemberSaveState(member.id, "idle"), 800);
        },
        onError: (err) => {
          setMemberSaveState(member.id, "error");
          setMemberSaveErrors((prev) => ({ ...prev, [member.id]: apiErrorMessage(err) }));
          revertDraftsToServer(member.id);
        },
      },
    );
  }

  function saveHumanTitleEdit(member: CompanyMember, nextTitle: string) {
    if (!selectedCompanyId) return;
    setMemberSaveState(member.id, "saving");
    humanSaveMutation.mutate(
      {
        memberId: member.id,
        title: normalizeTitleLabel(nextTitle) || null,
      },
      {
        onSuccess: () => {
          setMemberSaveState(member.id, "saved");
          setMemberSaveErrors((prev) => {
            if (!prev[member.id]) return prev;
            const { [member.id]: _drop, ...rest } = prev;
            return rest;
          });
          window.setTimeout(() => setMemberSaveState(member.id, "idle"), 800);
        },
        onError: (err) => {
          setMemberSaveState(member.id, "error");
          setMemberSaveErrors((prev) => ({ ...prev, [member.id]: apiErrorMessage(err) }));
          setMemberTitleDrafts((prev) => ({ ...prev, [member.id]: member.title ?? "" }));
        },
      },
    );
  }

  function saveAgentRowEdits(member: CompanyMember, nextRole: string, nextReportsTo: string) {
    if (!selectedCompanyId) return;
    setMemberSaveState(member.id, "saving");
    agentSaveMutation.mutate(
      {
        memberId: member.id,
        principalId: member.principalId,
        membershipRole: nextRole.trim() || null,
        reportsTo: nextReportsTo.trim() || null,
      },
      {
        onSuccess: () => {
          setMemberSaveState(member.id, "saved");
          setMemberSaveErrors((prev) => {
            if (!prev[member.id]) return prev;
            const { [member.id]: _drop, ...rest } = prev;
            return rest;
          });
          window.setTimeout(() => setMemberSaveState(member.id, "idle"), 800);
        },
        onError: (err) => {
          setMemberSaveState(member.id, "error");
          setMemberSaveErrors((prev) => ({ ...prev, [member.id]: apiErrorMessage(err) }));
          const serverMember = memberById.get(member.id) ?? null;
          setMemberRoleDrafts((prev) => ({ ...prev, [member.id]: serverMember?.membershipRole ?? "" }));
          setAgentReportsDrafts((prev) => ({
            ...prev,
            [member.id]: agentByPrincipalId.get(member.principalId)?.reportsTo ?? "",
          }));
        },
      },
    );
  }

  // Autosave (debounced) for selected human
  useEffect(() => {
    if (!selectedCompanyId || !selectedHumanMember) return;
    if (!canEditTeams) return;
    if (selectedHumanManagerIsAgent) {
      setMemberSaveState(selectedHumanMember.id, "error");
      setMemberSaveErrors((prev) => ({
        ...prev,
        [selectedHumanMember.id]: "Humans can only report to another human.",
      }));
      return;
    }
    if (!humanIsDirty) {
      if (getMemberSaveState(selectedHumanMember.id) !== "saving") setMemberSaveState(selectedHumanMember.id, "idle");
      return;
    }

    setMemberSaveState(selectedHumanMember.id, humanSaveMutation.isPending ? "saving" : "dirty");

    const handle = window.setTimeout(() => {
      setMemberSaveState(selectedHumanMember.id, "saving");
      humanSaveMutation.mutate(
        {
          memberId: selectedHumanMember.id,
          membershipRole: (memberRoleDrafts[selectedHumanMember.id] ?? "").trim() || null,
          title: normalizeTitleLabel(memberTitleDrafts[selectedHumanMember.id] ?? "") || null,
          reportsToMembershipId: (memberManagerDrafts[selectedHumanMember.id] ?? "").trim() || null
        },
        {
          onSuccess: () => {
            setMemberSaveState(selectedHumanMember.id, "saved");
            setMemberSaveErrors((prev) => {
              if (!prev[selectedHumanMember.id]) return prev;
              const { [selectedHumanMember.id]: _drop, ...rest } = prev;
              return rest;
            });
            window.setTimeout(() => {
              if (!computeDirty(selectedHumanMember)) setMemberSaveState(selectedHumanMember.id, "idle");
            }, 900);
          },
          onError: (err) => {
            setMemberSaveState(selectedHumanMember.id, "error");
            setMemberSaveErrors((prev) => ({ ...prev, [selectedHumanMember.id]: apiErrorMessage(err) }));
            revertDraftsToServer(selectedHumanMember.id);
          }
        }
      );
    }, 650);

    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedCompanyId,
    canEditTeams,
    selectedHumanMember?.id,
    memberRoleDrafts[selectedHumanMember?.id ?? ""],
    memberTitleDrafts[selectedHumanMember?.id ?? ""],
    memberManagerDrafts[selectedHumanMember?.id ?? ""],
    selectedHumanManagerIsAgent,
  ]);

  // Keep user permissions in sync with selected role on Teams page.
  useEffect(() => {
    if (!selectedCompanyId || !selectedHumanMember) return;
    if (!selectedHumanRoleDraft) return;
    const currentRole = (selectedHumanMember.membershipRole ?? "").trim();
    if (selectedHumanRoleDraft === currentRole) return;
    humanPermissionMutation.mutate({
      memberId: selectedHumanMember.id,
      grants: permissionsForRole(selectedHumanRoleDraft).map((permissionKey) => ({
        permissionKey,
        scope: null,
      })),
    });
  }, [selectedCompanyId, selectedHumanMember?.id, selectedHumanRoleDraft]);

  function SaveStatusPill({ state }: { state: SaveState }) {
    if (state === "idle") return null;
    const label =
      state === "dirty"
        ? "Unsaved"
        : state === "saving"
          ? "Saving…"
          : state === "saved"
            ? "Saved"
            : "Error";
    const tone =
      state === "error"
        ? "text-destructive"
        : state === "saved"
          ? "text-green-600"
          : "text-muted-foreground";
    return (
      <div className={`flex items-center gap-1.5 text-[11px] ${tone}`}>
        {state === "saving" && <Loader2 className="h-3 w-3 animate-spin" />}
        <span>{label}</span>
      </div>
    );
  }

  function RolePicker({
    member,
    label,
    options,
    customOptions,
    onAddCustomOption
  }: {
    member: CompanyMember;
    label: string;
    options: readonly string[];
    customOptions?: readonly string[];
    onAddCustomOption?: (role: string) => void;
  }) {
    const roleDraft = memberRoleDrafts[member.id] ?? "";
    const normalized = roleDraft.trim();
    const merged = useMemo(() => {
      const base = [...options];
      for (const r of customOptions ?? []) {
        if (!base.includes(r)) base.push(r);
      }
      return base;
    }, [options, customOptions]);
    const roleOptions: InlineEntityOption[] = merged.map((role) => ({
      id: normalizeRoleLabel(role),
      label: roleDisplayLabel(role),
    }));
    return (
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <InlineEntitySelector
          value={normalized}
          options={roleOptions}
          placeholder="Role"
          noneLabel="None"
          searchPlaceholder="Search roles..."
          emptyMessage="No roles found."
          onChange={(next) => setMemberRoleDrafts((prev) => ({ ...prev, [member.id]: next }))}
          className="h-10 w-full justify-between rounded-lg border-border/60 bg-background"
        />
      </div>
    );
  }

  if (!selectedCompany) {
    return <div className="text-sm text-muted-foreground">No company selected.</div>;
  }

  return (
    <div className="space-y-6">
      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
            <DialogContent className="flex max-h-[min(92dvh,44rem)] w-full max-w-2xl flex-col gap-0 overflow-hidden rounded-3xl border-border/60 p-0 shadow-xl">
              <div className="shrink-0 space-y-2 px-6 pt-6 pr-14">
                <DialogHeader>
                  <DialogTitle>Invite Human</DialogTitle>
                  <DialogDescription>
                    Send a human invite and get temporary credentials for a new teammate.
                  </DialogDescription>
                </DialogHeader>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
                <div className="mx-auto flex max-w-2xl flex-col gap-6">
                  <section className="min-w-0 space-y-4">
                    <h3 className="text-sm font-semibold tracking-tight text-foreground">Human details</h3>
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="invite-name" className="text-xs text-muted-foreground">
                          Name
                        </Label>
                        <Input
                          id="invite-name"
                          className="h-11 rounded-2xl border-border/60"
                          type="text"
                          placeholder="Full name"
                          value={humanInviteName}
                          onChange={(e) => setHumanInviteName(e.target.value)}
                        />
                        {humanInviteSubmitAttempted && !humanInviteName.trim() ? (
                          <p className="text-xs text-destructive">Required field</p>
                        ) : null}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="invite-email" className="text-xs text-muted-foreground">
                          Email
                        </Label>
                        <Input
                          id="invite-email"
                          className="h-11 rounded-2xl border-border/60"
                          type="email"
                          placeholder="name@company.com"
                          value={humanInviteEmail}
                          onChange={(e) => setHumanInviteEmail(e.target.value)}
                          autoComplete="email"
                        />
                        {humanInviteSubmitAttempted && !humanInviteEmail.trim() ? (
                          <p className="text-xs text-destructive">Required field</p>
                        ) : null}
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Role</Label>
                        <InlineEntitySelector
                          value={humanInviteRole}
                          options={inviteHumanRoleOptions.map((role) => ({
                            id: normalizeRoleLabel(role),
                            label: roleDisplayLabel(role),
                          }))}
                          placeholder="Role"
                          noneLabel="None"
                          includeNoneOption={false}
                          searchPlaceholder="Search roles..."
                          emptyMessage="No roles found."
                          onChange={setHumanInviteRole}
                          disablePortal
                          className="h-10 w-full justify-between rounded-lg border-border/60 bg-background"
                        />
                      </div>
                    </div>
                    {humanInviteCredentials && (
                      <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/25 px-4 py-3 text-xs ring-1 ring-border/30">
                        <p className="font-medium text-foreground">Temporary credentials (share securely)</p>
                        <p>
                          Name: <span className="font-mono">{humanInviteCredentials.name}</span>
                        </p>
                        <p>
                          Email: <span className="font-mono">{humanInviteCredentials.email}</span>
                        </p>
                        <p>
                          Username:{" "}
                          <span className="font-mono">
                            {humanInviteCredentials.temporaryUsername}
                          </span>
                        </p>
                        <p>
                          Password:{" "}
                          <span className="font-mono">
                            {humanInviteCredentials.temporaryPassword}
                          </span>
                        </p>
                        <div className="pt-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="rounded-full px-5 shadow-sm"
                            onClick={async () => {
                              const credentialsText = [
                                `Name: ${humanInviteCredentials.name}`,
                                `Email: ${humanInviteCredentials.email}`,
                                `Username: ${humanInviteCredentials.temporaryUsername}`,
                                `Password: ${humanInviteCredentials.temporaryPassword}`,
                              ].join("\n");
                              try {
                                await navigator.clipboard.writeText(credentialsText);
                                setHumanInviteCredentialsCopied(true);
                                window.setTimeout(() => setHumanInviteCredentialsCopied(false), 2000);
                                pushToast({
                                  title: "Credentials copied",
                                  body: "Temporary login details were copied to clipboard.",
                                  tone: "success",
                                });
                              } catch {
                                pushToast({
                                  title: "Copy failed",
                                  body: "Clipboard is unavailable. Copy the details manually.",
                                  tone: "error",
                                });
                              }
                            }}
                          >
                            {humanInviteCredentialsCopied ? (
                              <span className="inline-flex items-center gap-1.5">
                                <Check className="h-4 w-4" />
                                Copied
                              </span>
                            ) : (
                              "Copy credentials"
                            )}
                          </Button>
                        </div>
                      </div>
                    )}
                  </section>
                  <section className="min-w-0 space-y-3">
                    <h3 className="text-sm font-semibold tracking-tight text-foreground">Role permissions</h3>
                    <div className="rounded-2xl border border-border/50 bg-muted/15 p-4 ring-1 ring-border/30">
                      <HumanPermissionsPanel
                        idPrefix="invite"
                        enabledKeys={humanInvitePermissionKeys}
                        onKeysChange={setHumanInvitePermissionKeys}
                        intro={
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            Optional grants after they accept. Use a preset or adjust switches—nothing is enabled until you choose.
                          </p>
                        }
                      />
                    </div>
                  </section>
                </div>
              </div>
              <div className="shrink-0 space-y-2 rounded-b-3xl border-t border-border/50 bg-muted/15 px-6 py-4">
                {humanInviteError ? (
                  <p className="text-xs text-destructive">{humanInviteError}</p>
                ) : null}
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <Button
                    type="button"
                    size="default"
                    className="rounded-full px-8 shadow-sm text-white hover:brightness-105 active:brightness-95 disabled:opacity-100"
                    style={{ backgroundColor: "#6569E1" }}
                    onClick={() => {
                      if (!canEditTeams) return;
                      setHumanInviteSubmitAttempted(true);
                      if (!humanInviteName.trim() || !humanInviteEmail.trim()) return;
                      humanInviteMutation.mutate();
                    }}
                    disabled={
                      humanInviteMutation.isPending || !selectedCompanyId || !canEditTeams
                    }
                  >
                    {humanInviteMutation.isPending ? "Creating..." : "Create invite"}
                  </Button>
                </div>
              </div>
            </DialogContent>
      </Dialog>

      {rolesDialogOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
          <div
            className="absolute inset-0"
            onClick={() => setRolesDialogOpen(false)}
            aria-hidden
          />
          <div className="relative z-[81] flex h-[84vh] w-[78vw] max-h-[84vh] max-w-[1100px] flex-col overflow-hidden rounded-2xl border border-border/60 bg-background shadow-2xl">
            <div className="shrink-0 border-b border-border/60 px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold text-foreground">Manage roles</h2>
                  <p className="text-sm text-muted-foreground">
                    Add reusable roles for your org. These appear in human and agent role dropdowns.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setRolesDialogOpen(false)}
                >
                  Close
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 px-6 pb-6 pt-4">
              <Tabs defaultValue="humans" className="min-h-0 h-full">
                <TabsList variant="line" className="px-0">
                  <TabsTrigger value="humans">Humans</TabsTrigger>
                  <TabsTrigger value="agents">Agents</TabsTrigger>
                </TabsList>

                <TabsContent value="humans" className="mt-4 h-[calc(88vh-12rem)] min-h-0">
                  <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(20rem,26rem)_1fr]">
                    <section className="space-y-3 overflow-y-auto rounded-2xl border border-border/60 bg-muted/15 p-4">
                      <div className="text-sm font-medium text-foreground">Create role</div>
                      <div className="flex items-center gap-2">
                        <Input
                          value={newHumanRole}
                          onChange={(e) => setNewHumanRole(e.target.value)}
                          placeholder="Add a role (e.g. Sales Lead)"
                          className="h-10 rounded-lg border-border/60"
                        />
                        <Button
                          type="button"
                          className="rounded-full"
                          onClick={() => {
                            if (!selectedCompanyId) return;
                            const next = normalizeRoleLabel(newHumanRole);
                            if (!next) return;
                            setNewHumanRole("");
                            setCustomHumanRoles((prev) => (prev.includes(next) ? prev : [...prev, next]));
                            setSelectedManageHumanRole(next);
                            setHumanRolePermissions((prev) => {
                              if (prev[next]) return prev;
                              return { ...prev, [next]: permissionsForRole(next) };
                            });
                          }}
                          disabled={!normalizeRoleLabel(newHumanRole)}
                        >
                          Add
                        </Button>
                      </div>
                      <div className="space-y-1.5">
                        <div className="text-xs text-muted-foreground">Select role to manage</div>
                        <InlineEntitySelector
                          value={selectedManageHumanRole}
                          options={manageHumanRoleOptions.map((role) => ({
                            id: normalizeRoleLabel(role),
                            label: roleDisplayLabel(role),
                          }))}
                          placeholder="Select role"
                          noneLabel="None"
                          includeNoneOption={false}
                          searchPlaceholder="Search roles..."
                          emptyMessage="No roles found."
                          onChange={setSelectedManageHumanRole}
                          className="h-10 w-full justify-between rounded-lg border-border/60 bg-background"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {manageHumanRoleOptions.map((role) => {
                          const selected = role === selectedManageHumanRole;
                          return (
                            <button
                              key={role}
                              type="button"
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                                selected
                                  ? "border-primary/40 bg-primary/10 text-foreground"
                                  : "border-border bg-background text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                              )}
                              onClick={() => setSelectedManageHumanRole(role)}
                            >
                              {roleDisplayLabel(role)}
                            </button>
                          );
                        })}
                      </div>
                      {selectedManageHumanRole &&
                      !(HUMAN_ROLE_OPTIONS as readonly string[]).includes(selectedManageHumanRole) ? (
                        <div className="pt-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            className="rounded-full"
                            onClick={() => {
                              const roleToRemove = selectedManageHumanRole;
                              setCustomHumanRoles((prev) => prev.filter((r) => r !== roleToRemove));
                              setHumanRolePermissions((prev) => {
                                const next = { ...prev };
                                delete next[roleToRemove];
                                return next;
                              });
                              const fallback = manageHumanRoleOptions.find((r) => r !== roleToRemove) ?? "";
                              setSelectedManageHumanRole(fallback);
                            }}
                          >
                            Delete role
                          </Button>
                        </div>
                      ) : null}

                      {canCreateTitles || canManageTitles ? (
                        <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
                          <div className="text-sm font-medium text-foreground">Manage titles</div>
                          <div className="flex items-center gap-2">
                            <Input
                              value={newTitle}
                              onChange={(e) => setNewTitle(e.target.value)}
                              placeholder="Add a title (e.g. Team Lead)"
                              className="h-10 rounded-lg border-border/60"
                            />
                            <Button
                              type="button"
                              className="rounded-full"
                              onClick={() => {
                                if (!canCreateTitles) return;
                                const next = normalizeTitleLabel(newTitle);
                                if (!next) return;
                                setNewTitle("");
                                setCustomTitles((prev) => (prev.includes(next) ? prev : [...prev, next]));
                              }}
                              disabled={!canCreateTitles || !normalizeTitleLabel(newTitle)}
                            >
                              Add
                            </Button>
                          </div>
                          {availableTitleOptions.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {availableTitleOptions.map((title) => (
                                <span
                                  key={title}
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
                                    customTitles.includes(title)
                                      ? "border-primary/40 bg-primary/10 text-foreground"
                                      : "border-border bg-background text-muted-foreground",
                                  )}
                                >
                                  {title}
                                  {customTitles.includes(title) ? (
                                    <button
                                      type="button"
                                      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/15 hover:text-foreground"
                                      aria-label={`Remove ${title}`}
                                      onClick={() => {
                                        if (!canManageTitles) return;
                                        setCustomTitles((prev) => prev.filter((candidate) => candidate !== title));
                                      }}
                                      disabled={!canManageTitles}
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  ) : null}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <p className="text-[11px] text-muted-foreground">
                            Use Add to create title suggestions and x to remove custom ones.
                          </p>
                        </div>
                      ) : null}
                    </section>
                    <section className="space-y-2 overflow-y-auto rounded-xl border border-border/60 bg-muted/10 p-3">
                      <div className="text-sm font-medium text-foreground">
                        Role permissions{selectedManageHumanRole ? `: ${selectedManageHumanRole}` : ""}
                      </div>
                      <div className="rounded-lg border border-border/50 bg-background/60 p-2.5">
                        <HumanPermissionsPanel
                          idPrefix={`human-role-${selectedManageHumanRole || "none"}`}
                          enabledKeys={permissionsForRole(selectedManageHumanRole)}
                          onKeysChange={(keys) => {
                            if (!selectedManageHumanRole) return;
                            setHumanRolePermissions((prev) => ({
                              ...prev,
                              [selectedManageHumanRole]: keys,
                            }));
                          }}
                          intro={null}
                        />
                      </div>
                    </section>
                  </div>
                </TabsContent>

                <TabsContent value="agents" className="mt-4 overflow-y-auto">
                  <div className="space-y-3">
                    <div className="text-sm font-medium text-foreground">Custom agent role labels</div>
                    <div className="flex items-center gap-2">
                      <Input
                        value={newAgentRole}
                        onChange={(e) => setNewAgentRole(e.target.value)}
                        placeholder="Add a role label (e.g. SalesOpsAgent)"
                      />
                      <Button
                        type="button"
                        onClick={() => {
                          if (!selectedCompanyId) return;
                          const next = normalizeRoleLabel(newAgentRole);
                          if (!next) return;
                          setNewAgentRole("");
                          setCustomAgentRoles((prev) => (prev.includes(next) ? prev : [...prev, next]));
                        }}
                        disabled={!normalizeRoleLabel(newAgentRole)}
                      >
                        Add
                      </Button>
                    </div>
                    {customAgentRoles.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {customAgentRoles.map((role) => (
                          <button
                            key={role}
                            type="button"
                            className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                            title="Remove"
                            onClick={() => setCustomAgentRoles((prev) => prev.filter((r) => r !== role))}
                          >
                            {role}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">No custom role labels yet.</div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-4">
        {!canReadTeams ? (
          <div className="rounded-2xl border border-border/60 bg-card px-5 py-6 text-sm text-muted-foreground shadow-sm ring-1 ring-border/30">
            <div className="font-medium text-foreground">You do not have permission to view Teams.</div>
            <div className="mt-2">
              Ask a company admin for the <code>teams.read</code> permission.
            </div>
          </div>
        ) : null}
        {canReadTeams && membersPermissionDenied ? (
          <div className="rounded-2xl border border-border/60 bg-card px-5 py-6 text-sm text-muted-foreground shadow-sm ring-1 ring-border/30">
            <div className="font-medium text-foreground">You do not have permission to view Teams members.</div>
            <div className="mt-2">
              Ask a company admin for the <code>teams.read</code> permission.
            </div>
          </div>
        ) : null}
        {canReadTeams && !membersPermissionDenied && membersError ? (
          <div className="rounded-2xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive ring-1 ring-destructive/15">
            {apiErrorMessage(membersError)}
          </div>
        ) : null}
        {canReadTeams && !membersPermissionDenied && !membersError ? (
          <>
        <div className="mt-4">
          <div className="grid items-stretch gap-4">
            <div className="flex h-[72vh] min-h-[36rem] flex-col overflow-hidden rounded-md border border-border/70 bg-background shadow-sm">
              <div className="z-30 border-b border-border/70 bg-muted/35 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Users className="size-4 text-muted-foreground" aria-hidden />
                      Teams
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Manage humans and AI agents in one place. Edits save automatically.
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setTeamTypeFilter("human")}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                          teamTypeFilter === "human"
                            ? "border-primary/50 bg-primary/10 text-primary"
                            : "border-border bg-background text-foreground hover:bg-muted",
                        )}
                      >
                        <UserRound className="size-3.5 text-muted-foreground" aria-hidden />
                        {activeHumanMembers.length} humans
                      </button>
                      <button
                        type="button"
                        onClick={() => setTeamTypeFilter("agent")}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                          teamTypeFilter === "agent"
                            ? "border-primary/50 bg-primary/10 text-primary"
                            : "border-border bg-background text-foreground hover:bg-muted",
                        )}
                      >
                        <Bot className="size-3.5 text-muted-foreground" aria-hidden />
                        {activeAgentMembers.length} agent{activeAgentMembers.length === 1 ? "" : "s"}
                      </button>
                    </div>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                    <div className="w-full min-w-0 sm:w-64">
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search name, email, role, title..."
                        className="h-9 rounded-lg border-border/60 bg-background"
                      />
                    </div>
                    {canEditTeams ? (
                      <Button
                        type="button"
                        className="h-9 rounded-md border border-indigo-500 bg-indigo-500 px-4 text-white hover:border-indigo-600 hover:bg-indigo-600"
                        variant="default"
                        onClick={() => setInviteDialogOpen(true)}
                      >
                        Invite Human
                      </Button>
                    ) : null}
                    {canOpenRolesAndTitlesDialog ? (
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-9 rounded-md border border-border/70 bg-background px-4 text-foreground hover:bg-muted"
                        onClick={() => setRolesDialogOpen(true)}
                      >
                        {hasTitleAccess ? "Manage roles & titles" : "Manage roles"}
                      </Button>
                    ) : null}
                    {hasActiveTeamFilters ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-9 rounded-full px-3 text-xs"
                        onClick={() => {
                          setSearch("");
                          setTeamSortKey("displayName");
                          setTeamSortDirection("asc");
                          setTeamTypeFilter("human");
                        }}
                      >
                        Clear filters
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                <div
                  className={cn(
                    "sticky top-0 z-20 grid gap-2 border-b border-border/70 bg-background px-3 py-2 text-xs font-bold text-foreground/90",
                    teamTypeFilter === "agent"
                      ? "grid-cols-[minmax(12rem,1.2fr)_minmax(10rem,1fr)_minmax(10rem,1fr)]"
                      : "grid-cols-[minmax(9rem,1fr)_minmax(8rem,0.9fr)_minmax(9rem,1fr)_minmax(8rem,0.9fr)_minmax(8rem,0.9fr)_minmax(7rem,0.7fr)]",
                  )}
                >
                <button
                  type="button"
                  onClick={() => toggleTeamSort("displayName")}
                  className={cn(
                    "inline-flex w-full justify-self-start items-center justify-start gap-1 rounded-md py-1 text-left transition-colors hover:text-foreground",
                    teamSortKey === "displayName" && "text-primary",
                  )}
                >
                  Name <ArrowUpDown className="size-3" aria-hidden />
                </button>
                {teamTypeFilter === "agent" ? null : (
                  <button
                    type="button"
                    onClick={() => toggleTeamSort("title")}
                    className={cn(
                      "inline-flex w-full justify-self-start items-center justify-start gap-1 rounded-md py-1 text-left transition-colors hover:text-foreground",
                      teamSortKey === "title" && "text-primary",
                    )}
                  >
                    Title <ArrowUpDown className="size-3" aria-hidden />
                  </button>
                )}
                {teamTypeFilter === "agent" ? null : (
                  <button
                    type="button"
                    onClick={() => toggleTeamSort("principal")}
                    className={cn(
                      "inline-flex w-full justify-self-start items-center justify-start gap-1 rounded-md py-1 text-left transition-colors hover:text-foreground",
                      teamSortKey === "principal" && "text-primary",
                    )}
                  >
                    Email <ArrowUpDown className="size-3" aria-hidden />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => toggleTeamSort("role")}
                  className={cn(
                    "inline-flex w-full justify-self-start items-center justify-start gap-1 rounded-md py-1 text-left transition-colors hover:text-foreground",
                    teamSortKey === "role" && "text-primary",
                  )}
                >
                  Role <ArrowUpDown className="size-3" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => toggleTeamSort("reportsTo")}
                  className={cn(
                    "inline-flex w-full justify-self-start items-center justify-start gap-1 rounded-md py-1 text-left transition-colors hover:text-foreground",
                    teamSortKey === "reportsTo" && "text-primary",
                  )}
                >
                  Reports to <ArrowUpDown className="size-3" aria-hidden />
                </button>
                {teamTypeFilter === "agent" ? null : (
                  <>
                    <button
                      type="button"
                      onClick={() => toggleTeamSort("status")}
                      className={cn(
                        "inline-flex w-full justify-self-start items-center justify-start gap-1 rounded-md py-1 text-left transition-colors hover:text-foreground",
                        teamSortKey === "status" && "text-primary",
                      )}
                    >
                      Status <ArrowUpDown className="size-3" aria-hidden />
                    </button>
                  </>
                )}
                </div>
                {!membersLoading && visibleTeamRows.length === 0 && (
                  <div className="flex flex-col items-center justify-center gap-2 border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
                    <UserRound className="size-9 text-muted-foreground" aria-hidden />
                    <p className="text-sm text-muted-foreground">No matching members.</p>
                  </div>
                )}
                {visibleTeamRows.map((row) => {
                  const member = row.member;
                  if (row.kind === "human") {
                    const selected = selectedHumanMember?.id === member.id;
                    const isSuspended = member.status === "suspended";
                    const roleValue = (memberRoleDrafts[member.id] ?? member.membershipRole ?? "").trim();
                    const reportsToValue = (memberManagerDrafts[member.id] ?? member.reportsToMembershipId ?? "").trim();
                    const rowInvalidManagers = descendantsOf(member.id, childrenByMemberId);
                    rowInvalidManagers.add(member.id);
                    return (
                      <div
                        key={member.id}
                        onClick={() => {
                          setSelectedHumanMemberId(member.id);
                          setHumanDetailsDialogOpen(true);
                        }}
                        className={cn(
                          "grid w-full cursor-pointer grid-cols-[minmax(9rem,1fr)_minmax(8rem,0.9fr)_minmax(9rem,1fr)_minmax(8rem,0.9fr)_minmax(8rem,0.9fr)_minmax(7rem,0.7fr)] items-center gap-2 border-b border-border/60 px-3 py-2 text-left transition-colors",
                          selected ? "bg-[#e5f1fb] text-foreground dark:bg-accent/45" : "hover:bg-muted/40",
                          isSuspended && "opacity-70",
                        )}
                      >
                        <span className="min-w-0 inline-flex items-center gap-2">
                          <DirectoryMemberAvatar member={member} size="xs" className="shrink-0" />
                          <span className="truncate text-sm font-medium">{memberDisplayName(member)}</span>
                        </span>
                        <span onClick={(event) => event.stopPropagation()} className="min-w-0">
                          {canAssignTitles ? (
                            <InlineEntitySelector
                              value={(memberTitleDrafts[member.id] ?? member.title ?? "").trim()}
                              options={availableTitleOptions.map((title) => ({
                                id: title,
                                label: title,
                              }))}
                              placeholder="Title"
                              noneLabel="None"
                              searchPlaceholder="Search titles..."
                              emptyMessage="No titles found."
                              onChange={(next) => {
                                setSelectedHumanMemberId(member.id);
                                const nextTitle = normalizeTitleLabel(next);
                                setMemberTitleDrafts((prev) => ({ ...prev, [member.id]: nextTitle }));
                                saveHumanTitleEdit(member, nextTitle);
                              }}
                              className="h-8 w-[150px] max-w-full justify-between rounded-md border-border/60 bg-background text-xs"
                            />
                          ) : (
                            <span className="truncate text-xs text-muted-foreground">
                              {(memberTitleDrafts[member.id] ?? member.title ?? "").trim() || "None"}
                            </span>
                          )}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {member.user?.email ?? member.principalId}
                        </span>
                        <span onClick={(event) => event.stopPropagation()} className="min-w-0">
                          <InlineEntitySelector
                            value={roleValue}
                            options={manageHumanRoleOptions.map((role) => ({
                              id: normalizeRoleLabel(role),
                              label: roleDisplayLabel(role),
                            }))}
                            placeholder="Role"
                            noneLabel="None"
                            searchPlaceholder="Search roles..."
                            emptyMessage="No roles found."
                            onChange={(next) => {
                              setSelectedHumanMemberId(member.id);
                              const nextRole = next.trim();
                              setMemberRoleDrafts((prev) => ({ ...prev, [member.id]: nextRole }));
                              saveHumanRowEdits(member, nextRole, memberTitleDrafts[member.id] ?? member.title ?? "", reportsToValue);
                            }}
                            className="h-8 w-[150px] max-w-full justify-between rounded-md border-border/60 bg-background text-xs"
                          />
                        </span>
                        <span onClick={(event) => event.stopPropagation()} className="min-w-0">
                          <InlineEntitySelector
                            value={reportsToValue}
                            options={activeHumanMembers
                              .filter((candidate) => candidate.id !== member.id && !rowInvalidManagers.has(candidate.id))
                              .map((candidate) => ({
                                id: candidate.id,
                                label: memberDisplayName(candidate),
                              searchText: `${memberDisplayName(candidate)} ${candidate.user?.email ?? ""}`,
                              }))}
                            placeholder="Reports to"
                            noneLabel="None"
                            searchPlaceholder="Search humans..."
                            emptyMessage="No humans found."
                            onChange={(next) => {
                              setSelectedHumanMemberId(member.id);
                              const nextManager = next.trim();
                              setMemberManagerDrafts((prev) => ({ ...prev, [member.id]: nextManager }));
                              saveHumanRowEdits(member, roleValue, memberTitleDrafts[member.id] ?? member.title ?? "", nextManager);
                            }}
                            className="h-8 w-[140px] max-w-full justify-between rounded-md border-border/60 bg-background text-xs"
                          />
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center justify-start text-xs",
                            isSuspended ? "font-medium text-orange-700 dark:text-orange-300" : "text-muted-foreground",
                          )}
                        >
                          {isSuspended ? "Deactivated" : "Active"}
                        </span>
                      </div>
                    );
                  }

                  const roleValue = (memberRoleDrafts[member.id] ?? member.membershipRole ?? "").trim();
                  const reportsToValue = (agentReportsDrafts[member.id] ?? agentByPrincipalId.get(member.principalId)?.reportsTo ?? "").trim();
                  const rowInvalidManagers = descendantsOf(member.principalId, agentChildrenByPrincipalId);
                  rowInvalidManagers.add(member.principalId);
                  return (
                    <div
                      key={member.id}
                      className="grid w-full grid-cols-[minmax(12rem,1.2fr)_minmax(10rem,1fr)_minmax(10rem,1fr)] items-center gap-2 border-b border-border/60 px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
                    >
                      <span className="min-w-0 inline-flex items-center gap-2">
                        <DirectoryMemberAvatar member={member} size="xs" className="shrink-0" />
                        <span className="truncate text-sm font-medium">{memberDisplayName(member)}</span>
                      </span>
                      <span onClick={(event) => event.stopPropagation()} className="min-w-0">
                        <InlineEntitySelector
                          value={roleValue}
                          options={assignableAgentRoleOptions.map((role) => ({
                            id: normalizeRoleLabel(role),
                            label: roleDisplayLabel(role),
                          }))}
                          placeholder="Role"
                          noneLabel="None"
                          searchPlaceholder="Search roles..."
                          emptyMessage="No roles found."
                          onChange={(next) => {
                            const nextRole = next.trim();
                            setMemberRoleDrafts((prev) => ({ ...prev, [member.id]: nextRole }));
                            saveAgentRowEdits(member, nextRole, reportsToValue);
                          }}
                          className="h-8 w-[150px] max-w-full justify-between rounded-md border-border/60 bg-background text-xs"
                        />
                      </span>
                      <span onClick={(event) => event.stopPropagation()} className="min-w-0">
                        <InlineEntitySelector
                          value={reportsToValue}
                          options={activeAgentMembers
                            .filter((candidate) =>
                              candidate.id !== member.id &&
                              !rowInvalidManagers.has(candidate.principalId),
                            )
                            .map((candidate) => ({
                              id: candidate.principalId,
                              label: memberDisplayName(candidate),
                              searchText: `${memberDisplayName(candidate)} ${candidate.user?.email ?? ""}`,
                            }))}
                          placeholder="Reports to"
                          noneLabel="None"
                          searchPlaceholder="Search agents..."
                          emptyMessage="No agents found."
                          onChange={(next) => {
                            const nextManager = next.trim();
                            setAgentReportsDrafts((prev) => ({ ...prev, [member.id]: nextManager }));
                            saveAgentRowEdits(member, roleValue, nextManager);
                          }}
                          className="h-8 w-[140px] max-w-full justify-between rounded-md border-border/60 bg-background text-xs"
                        />
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        </div>
          </>
        ) : null}
      </div>

      {humanDetailsDialogOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
          <div
            className="absolute inset-0"
            onClick={() => setHumanDetailsDialogOpen(false)}
            aria-hidden
          />
          <div className="relative z-[81] flex h-[88vh] w-[46vw] max-h-[88vh] max-w-[46vw] flex-col overflow-hidden rounded-2xl border border-border/60 bg-background shadow-2xl">
            {selectedHumanMember ? (
              <>
                <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
                  <h2 className="text-base font-semibold text-foreground">Manage Permissions</h2>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setHumanDetailsDialogOpen(false)}
                  >
                    Close
                  </Button>
                </div>
                <div className="grid min-h-0 flex-1 gap-0 md:grid-cols-[260px_1fr]">
                  <aside className="border-r border-border/60 bg-muted/25 p-4">
                    <div className="rounded-xl border border-border/60 bg-background p-3">
                      <div className="flex flex-col items-center text-center">
                        <DirectoryMemberAvatar member={selectedHumanMember} size="lg" className="mb-2" />
                        <div className="text-sm font-semibold text-foreground">{memberDisplayName(selectedHumanMember)}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {selectedHumanMember.user?.email ?? selectedHumanMember.principalId}
                        </div>
                      </div>
                      <div className="mt-3 space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Role</span>
                          <span className="font-medium text-foreground">
                            {roleDisplayLabel(selectedHumanMember.membershipRole) || "member"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Title</span>
                          <span className="font-medium text-foreground">
                            {(selectedHumanMember.title ?? "").trim() || "None"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Status</span>
                          <span className="font-medium text-foreground">
                            {selectedHumanMember.status === "suspended" ? "Deactivated" : "Active"}
                          </span>
                        </div>
                      </div>
                      <div className="pt-2 space-y-2">
                        {selectedHumanMember.status === "suspended" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 w-full justify-start rounded-md border-border/70 bg-background px-2 text-xs font-medium text-foreground hover:bg-muted"
                            disabled={!selectedCompanyId || reactivateHumanMutation.isPending || removeHumanMutation.isPending}
                            onClick={() =>
                              reactivateHumanMutation.mutate(selectedHumanMember.id, {
                                onError: (err) => {
                                  pushToast({
                                    title: "Action failed",
                                    body: apiErrorMessage(err),
                                    tone: "error",
                                  });
                                },
                              })
                            }
                          >
                            Activate user
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 w-full justify-start rounded-md border-border/70 bg-background px-2 text-xs font-medium text-foreground hover:bg-muted"
                            disabled={!selectedCompanyId || deactivateHumanMutation.isPending || removeHumanMutation.isPending}
                            onClick={() => {
                              setHumanDetailsDialogOpen(false);
                              setDeactivateDialogOpen(true);
                            }}
                          >
                            Deactivate user
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 w-full justify-start rounded-md border-destructive/40 bg-background px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                          disabled={!selectedCompanyId || deactivateHumanMutation.isPending || reactivateHumanMutation.isPending || removeHumanMutation.isPending}
                          onClick={() => {
                            setHumanDetailsDialogOpen(false);
                            setDeleteDialogOpen(true);
                          }}
                        >
                          Delete user
                        </Button>
                      </div>
                    </div>
                  </aside>
                  <section className="min-h-0 overflow-y-auto p-4">
                    <HumanPermissionsPanel
                      idPrefix={`member-${selectedHumanMember.id}`}
                      enabledKeys={
                        humanPermissionMutation.isPending &&
                        humanPermissionMutation.variables?.memberId === selectedHumanMember.id
                          ? normalizePermissionSelection(
                              humanPermissionMutation.variables.grants.map((grant) => grant.permissionKey),
                            )
                          : normalizePermissionSelection(
                              selectedHumanMember.grants.map((grant) => grant.permissionKey as PermissionKey),
                            )
                      }
                      disabled={!selectedCompanyId}
                      onKeysChange={(keys) => {
                        if (!selectedCompanyId) return;
                        const nextGrants = keys.map((permissionKey) => ({
                          permissionKey,
                          scope: null,
                        }));
                        humanPermissionMutation.mutate({
                          memberId: selectedHumanMember.id,
                          grants: nextGrants,
                        });
                      }}
                      intro={null}
                    />
                    {humanPermissionMutation.isError ? (
                      <div className="mt-3 text-xs text-destructive">
                        {apiErrorMessage(humanPermissionMutation.error)}
                      </div>
                    ) : null}
                  </section>
                </div>
                <div className="border-t border-border/60 px-5 py-3" />
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                <div className="flex size-16 items-center justify-center rounded-2xl border border-border bg-muted">
                  <UserRound className="size-8 text-muted-foreground" aria-hidden />
                </div>
                <p className="text-sm font-medium text-foreground">No human selected</p>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Deactivate confirmation dialog */}
      <Dialog open={deactivateDialogOpen} onOpenChange={setDeactivateDialogOpen}>
        <DialogContent className="max-w-3xl rounded-2xl border-border/60">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                </svg>
              </span>
              Deactivate {selectedHumanMember ? memberDisplayName(selectedHumanMember) : "user"}
            </DialogTitle>
            <DialogDescription className="pt-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {selectedHumanMember ? memberDisplayName(selectedHumanMember) : "This human"}
              </span>{" "}
              will lose active access to this company. You can reactivate them at any time.
            </DialogDescription>
          </DialogHeader>
          {renderOffboardingIssuesPanel()}
          <DialogFooter className="mt-4 flex gap-2 justify-end">
            <DialogClose asChild>
              <Button variant="outline" size="sm">Cancel</Button>
            </DialogClose>
            <Button
              size="sm"
              variant="outline"
              className="rounded-md border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
              disabled={deactivateHumanMutation.isPending || offboardingSubmitPending}
              onClick={async () => {
                if (!selectedHumanMember) return;
                setOffboardingSubmitPending(true);
                try {
                  const reassignedCount = await applyOffboardingIssueReassignments();
                  await deactivateHumanMutation.mutateAsync(selectedHumanMember.id);
                  setDeactivateDialogOpen(false);
                  setOffboardingIssueReassignDrafts({});
                  if (reassignedCount > 0) {
                    pushToast({
                      title: "Tickets reassigned",
                      body: `${reassignedCount} ticket(s) were reassigned before deactivation.`,
                      tone: "success",
                    });
                  }
                } catch (err) {
                  pushToast({
                    title: "Action failed",
                    body: apiErrorMessage(err),
                    tone: "error",
                  });
                } finally {
                  setOffboardingSubmitPending(false);
                }
              }}
            >
              {deactivateHumanMutation.isPending || offboardingSubmitPending ? "Deactivating…" : "Deactivate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-3xl rounded-2xl border-border/60">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                </svg>
              </span>
              Delete {selectedHumanMember ? memberDisplayName(selectedHumanMember) : "user"}
            </DialogTitle>
            <DialogDescription className="pt-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {selectedHumanMember ? memberDisplayName(selectedHumanMember) : "This human"}
              </span>{" "}
              will be removed from this company. This action cannot be undone from the UI.
            </DialogDescription>
          </DialogHeader>
          {renderOffboardingIssuesPanel()}
          <DialogFooter className="mt-4 flex gap-2 justify-end">
            <DialogClose asChild>
              <Button variant="outline" size="sm">Cancel</Button>
            </DialogClose>
            <Button
              size="sm"
              variant="destructive"
              disabled={removeHumanMutation.isPending || offboardingSubmitPending}
              onClick={async () => {
                if (!selectedHumanMember) return;
                setOffboardingSubmitPending(true);
                try {
                  const reassignedCount = await applyOffboardingIssueReassignments();
                  await removeHumanMutation.mutateAsync(selectedHumanMember.id);
                  setDeleteDialogOpen(false);
                  setOffboardingIssueReassignDrafts({});
                  if (reassignedCount > 0) {
                    pushToast({
                      title: "Tickets reassigned",
                      body: `${reassignedCount} ticket(s) were reassigned before deletion.`,
                      tone: "success",
                    });
                  }
                } catch (err) {
                  pushToast({
                    title: "Action failed",
                    body: apiErrorMessage(err),
                    tone: "error",
                  });
                } finally {
                  setOffboardingSubmitPending(false);
                }
              }}
            >
              {removeHumanMutation.isPending || offboardingSubmitPending ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
