import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2, UserRound, Users } from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { accessApi, type CompanyMember } from "../api/access";
import { agentsApi } from "../api/agents";
import { PERMISSION_KEYS, type Agent, type PermissionKey } from "@paperclipai/shared";
import { queryKeys } from "../lib/queryKeys";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "../api/client";
import { isPermissionDeniedError } from "../lib/permission-feedback";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const HUMAN_ROLE_OPTIONS = [
  "Owner",
  "Director",
  "CEO",
  "COO",
  "CTO",
  "CFO",
  "Chief of Staff",
  "VP Sales",
  "Sales",
  "VP Marketing",
  "Marketing",
  "Growth",
  "Partnerships",
  "Customer Success",
  "Account Management",
  "Recruiting",
  "HR",
  "Legal",
  "Finance",
  "IT",
  "Procurement",
  "VP Engineering",
  "Head of Engineering",
  "Engineering Manager",
  "Product Manager",
  "Product Ops",
  "Designer",
  "Operations",
  "SRE",
  "DevOps",
  "QA",
  "Security",
  "Data",
  "Support"
] as const;

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

const CUSTOM_ROLE_VALUE = "__custom__";
const COMPANY_ROLE_STORAGE_PREFIX = "paperclip.companyRoles";
const ALL_PERMISSION_KEYS = [...PERMISSION_KEYS] as PermissionKey[];

const PERMISSION_UI: Record<PermissionKey, { title: string; description: string }> = {
  "agents:create": {
    title: "Create agents",
    description: "Bring new AI agents onboard and configure them for this company.",
  },
  "users:invite": {
    title: "Invite teammates",
    description: "Send email invites so new people can join the company.",
  },
  "users:manage_permissions": {
    title: "Manage roles & access",
    description: "Change what other members are allowed to do, including their permissions.",
  },
  "tasks:assign": {
    title: "Assign work",
    description: "Assign or hand off tasks between people and agents.",
  },
  "tasks:assign_scope": {
    title: "Control assignment scope",
    description: "Decide which tasks an agent is allowed to be assigned to.",
  },
  "joins:approve": {
    title: "Approve join requests",
    description: "Review and approve requests from people who want to join.",
  },
  "companies:create": {
    title: "Create companies",
    description: "Create new companies on this instance.",
  },
};

const PERMISSION_CATEGORY_ACCENTS: Record<string, string> = {
  team: "from-muted-foreground/60 to-muted-foreground/30",
  agents: "from-muted-foreground/60 to-muted-foreground/30",
  work: "from-muted-foreground/60 to-muted-foreground/30",
};

const PERMISSION_CATEGORY_DEFS: {
  id: string;
  title: string;
  subtitle: string;
  keys: readonly PermissionKey[];
}[] = [
  {
    id: "team",
    title: "Team & access",
    subtitle: "Invitations, join requests, and who can change roles.",
    keys: ["users:invite", "joins:approve", "users:manage_permissions"],
  },
  {
    id: "agents",
    title: "Agents",
    subtitle: "Creating AI teammates.",
    keys: ["agents:create"],
  },
  {
    id: "work",
    title: "Tasks & workflow",
    subtitle: "How work is routed on the board.",
    keys: ["tasks:assign", "tasks:assign_scope"],
  },
    {
    id: "company",
    title: "Company Management",
    subtitle: "Company Access Control",
    keys: ["companies:create"],
  },
];

const PERMISSION_PRESETS = {
  Member: [] as const,
  Manager: [
    "agents:create",
    "users:invite",
    "tasks:assign",
    "tasks:assign_scope",
    "joins:approve",
  ] as const,
  Admin: [...PERMISSION_KEYS],
} satisfies Record<string, readonly PermissionKey[]>;

type PermissionPresetName = keyof typeof PERMISSION_PRESETS;

const PERMISSION_PRESET_HINTS: Record<PermissionPresetName, string> = {
  Member: "No optional access — baseline teammate.",
  Manager: "Run day-to-day work and invites; cannot change others permissions.",
  Admin: "Everything on, including who can manage roles and access.",
};

type HumanPermissionsPanelProps = {
  idPrefix: string;
  enabledKeys: PermissionKey[];
  onKeysChange: (keys: PermissionKey[]) => void;
  disabled?: boolean;
  intro?: ReactNode;
  showPresets?: boolean;
};

function HumanPermissionsPanel({
  idPrefix,
  enabledKeys,
  onKeysChange,
  disabled,
  intro,
  showPresets = true,
}: HumanPermissionsPanelProps) {
  const enabledSet = useMemo(() => new Set(enabledKeys), [enabledKeys]);
  const enabledCount = enabledKeys.length;
  const total = ALL_PERMISSION_KEYS.length;
  const pct = total === 0 ? 0 : Math.round((enabledCount / total) * 100);

  const toggle = (key: PermissionKey, on: boolean) => {
    const next = new Set(enabledKeys);
    if (on) next.add(key);
    else next.delete(key);
    onKeysChange(ALL_PERMISSION_KEYS.filter((k) => next.has(k)));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-border/40 bg-muted/20 p-3 ring-1 ring-border/25 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          {intro}
          {showPresets ? (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Quick presets
              </span>
              {(Object.keys(PERMISSION_PRESETS) as PermissionPresetName[]).map((name) => (
                <Button
                  key={name}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  title={PERMISSION_PRESET_HINTS[name]}
                  className="h-8 rounded-full px-4 text-xs font-medium shadow-xs"
                  onClick={() => onKeysChange([...PERMISSION_PRESETS[name]])}
                >
                  {name}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          <div
            className="inline-flex min-w-[7.5rem] flex-col gap-0.5 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 to-violet-500/5 px-3 py-2 text-right shadow-xs ring-1 ring-primary/15"
            title={`${enabledCount} of ${total} optional access rights are on`}
          >
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Access enabled
            </span>
            <div className="flex items-baseline justify-end gap-1">
              <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                {enabledCount}
              </span>
              <span className="text-sm font-medium text-muted-foreground">/ {total}</span>
            </div>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted sm:w-36">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      <div className="space-y-5">
        {PERMISSION_CATEGORY_DEFS.map((cat) => (
          <section key={cat.id} className="space-y-2">
            <header className="flex gap-3 border-b border-border/60 pb-2">
              <span
                className={cn(
                  "mt-0.5 h-9 w-1 shrink-0 rounded-full bg-gradient-to-b",
                  PERMISSION_CATEGORY_ACCENTS[cat.id] ?? "from-muted-foreground/70 to-muted-foreground/30",
                )}
                aria-hidden
              />
              <div className="min-w-0 space-y-0.5">
                <h3 className="text-sm font-semibold text-foreground">{cat.title}</h3>
                <p className="text-xs text-muted-foreground">{cat.subtitle}</p>
              </div>
            </header>
            <ul className="space-y-2">
              {cat.keys.map((key) => {
                const checked = enabledSet.has(key);
                const ui = PERMISSION_UI[key];
                const sid = `${idPrefix}-${key}`;
                return (
                  <li
                    key={key}
                    className="flex items-center gap-3 rounded-2xl border border-border/50 bg-background/80 px-3 py-2.5 shadow-xs transition-colors hover:border-primary/20 hover:bg-muted/30"
                  >
                    <div className="min-w-0 flex-1">
                      <Label htmlFor={sid} className="cursor-pointer text-sm font-medium leading-tight text-foreground">
                        {ui.title}
                      </Label>
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{ui.description}</p>
                    </div>
                    <Switch
                      id={sid}
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={(on) => toggle(key, on)}
                      aria-label={ui.title}
                    />
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
  return input.trim().replace(/\s+/g, " ");
}

function readCompanyRolePrefs(companyId: string) {
  try {
    const raw = window.localStorage.getItem(`${COMPANY_ROLE_STORAGE_PREFIX}:${companyId}`);
    if (!raw) {
      return {
        human: [] as string[],
        agent: [] as string[],
        humanRolePermissions: {} as Record<string, PermissionKey[]>,
      };
    }
    const parsed = JSON.parse(raw) as {
      human?: unknown;
      agent?: unknown;
      humanRolePermissions?: unknown;
    };
    const human = Array.isArray(parsed.human) ? parsed.human.filter((v): v is string => typeof v === "string") : [];
    const agent = Array.isArray(parsed.agent) ? parsed.agent.filter((v): v is string => typeof v === "string") : [];
    const humanRolePermissionsRaw =
      parsed.humanRolePermissions && typeof parsed.humanRolePermissions === "object"
        ? (parsed.humanRolePermissions as Record<string, unknown>)
        : {};
    const humanRolePermissions: Record<string, PermissionKey[]> = {};
    for (const [role, keys] of Object.entries(humanRolePermissionsRaw)) {
      if (!Array.isArray(keys)) continue;
      const permissionKeys = keys.filter((k): k is PermissionKey =>
        typeof k === "string" && ALL_PERMISSION_KEYS.includes(k as PermissionKey),
      );
      humanRolePermissions[role] = permissionKeys;
    }
    return { human, agent, humanRolePermissions };
  } catch {
    return {
      human: [] as string[],
      agent: [] as string[],
      humanRolePermissions: {} as Record<string, PermissionKey[]>,
    };
  }
}

function writeCompanyRolePrefs(
  companyId: string,
  roles: {
    human: string[];
    agent: string[];
    humanRolePermissions: Record<string, PermissionKey[]>;
  },
) {
  try {
    window.localStorage.setItem(`${COMPANY_ROLE_STORAGE_PREFIX}:${companyId}`, JSON.stringify(roles));
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

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h === 0 ? 0 : Math.abs(h);
}

const HUMAN_AVATAR_THEMES = [
  "bg-muted text-foreground ring-1 ring-border",
  "bg-muted text-foreground ring-1 ring-border",
  "bg-muted text-foreground ring-1 ring-border",
  "bg-muted text-foreground ring-1 ring-border",
  "bg-muted text-foreground ring-1 ring-border",
] as const;

function humanAvatarThemeClass(member: CompanyMember): string {
  const id = member.user?.id ?? member.principalId;
  return HUMAN_AVATAR_THEMES[hashString(id) % HUMAN_AVATAR_THEMES.length]!;
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
          "font-bold tracking-tight",
          size === "xs" ? "text-[10px]" : size === "sm" ? "text-xs" : "text-sm",
          humanAvatarThemeClass(member),
        )}
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
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"users" | "agents">("users");
  const [search, setSearch] = useState("");
  const [selectedHumanMemberId, setSelectedHumanMemberId] = useState<string | null>(null);
  const [selectedAgentMemberId, setSelectedAgentMemberId] = useState<string | null>(null);
  const [memberRoleDrafts, setMemberRoleDrafts] = useState<Record<string, string>>({});
  const [memberManagerDrafts, setMemberManagerDrafts] = useState<Record<string, string>>({});
  const [agentReportsDrafts, setAgentReportsDrafts] = useState<Record<string, string>>({});
  const [memberSaveStates, setMemberSaveStates] = useState<Record<string, SaveState>>({});
  const [memberSaveErrors, setMemberSaveErrors] = useState<Record<string, string>>({});
  const [customHumanRoles, setCustomHumanRoles] = useState<string[]>([]);
  const [customAgentRoles, setCustomAgentRoles] = useState<string[]>([]);
  const [humanRolePermissions, setHumanRolePermissions] = useState<Record<string, PermissionKey[]>>({});
  const [newHumanRole, setNewHumanRole] = useState("");
  const [selectedHumanRoleForManage, setSelectedHumanRoleForManage] = useState("");
  const [editingHumanRolePermissions, setEditingHumanRolePermissions] = useState<PermissionKey[]>([]);
  const [rolesDialogOpen, setRolesDialogOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [humanInviteName, setHumanInviteName] = useState("");
  const [humanInviteEmail, setHumanInviteEmail] = useState("");
  const [humanInviteError, setHumanInviteError] = useState<string | null>(null);
  const [humanInvitePermissionKeys, setHumanInvitePermissionKeys] = useState<PermissionKey[]>([]);
  const [humanInviteCredentials, setHumanInviteCredentials] = useState<{
    name: string;
    email: string;
    temporaryUsername: string;
    temporaryPassword: string;
  } | null>(null);

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
  const membersPermissionDenied = isPermissionDeniedError(membersError);

  const { data: agentsList } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.agents.list(selectedCompanyId) : ["agents", "none"],
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId
  });

  useEffect(() => {
    if (!selectedCompanyId) return;
    const prefs = readCompanyRolePrefs(selectedCompanyId);
    setCustomHumanRoles(prefs.human);
    setCustomAgentRoles(prefs.agent);
    setHumanRolePermissions(prefs.humanRolePermissions);
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    writeCompanyRolePrefs(selectedCompanyId, {
      human: customHumanRoles,
      agent: customAgentRoles,
      humanRolePermissions,
    });
  }, [selectedCompanyId, customHumanRoles, customAgentRoles, humanRolePermissions]);

  useEffect(() => {
    if (customHumanRoles.length === 0) {
      setSelectedHumanRoleForManage("");
      setEditingHumanRolePermissions([]);
      return;
    }
    if (!selectedHumanRoleForManage || !customHumanRoles.includes(selectedHumanRoleForManage)) {
      const firstRole = customHumanRoles[0] ?? "";
      setSelectedHumanRoleForManage(firstRole);
      setEditingHumanRolePermissions(humanRolePermissions[firstRole] ?? []);
    }
  }, [customHumanRoles, selectedHumanRoleForManage, humanRolePermissions]);

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

  const filteredHumanMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activeHumanMembers;
    return activeHumanMembers.filter((m) => {
      const name = memberDisplayName(m).toLowerCase();
      const email = (m.user?.email ?? "").toLowerCase();
      const role = (m.membershipRole ?? "").toLowerCase();
      return name.includes(q) || email.includes(q) || role.includes(q);
    });
  }, [activeHumanMembers, search]);

  const filteredAgentMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activeAgentMembers;
    return activeAgentMembers.filter((m) => {
      const name = memberDisplayName(m).toLowerCase();
      const agentRole = (m.agent?.role ?? "").toLowerCase();
      const orgRole = (m.membershipRole ?? "").toLowerCase();
      return name.includes(q) || agentRole.includes(q) || orgRole.includes(q);
    });
  }, [activeAgentMembers, search]);

  const selectedHumanMember =
    activeHumanMembers.find((m) => m.id === selectedHumanMemberId) ??
    activeHumanMembers.find((m) => m.status === "active") ??
    activeHumanMembers[0] ??
    null;
  const selectedAgentMember =
    activeAgentMembers.find((m) => m.id === selectedAgentMemberId) ?? activeAgentMembers[0] ?? null;

  const memberById = useMemo(() => {
    const map = new Map<string, CompanyMember>();
    for (const m of companyMembers ?? []) map.set(m.id, m);
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

  const invalidManagersForSelectedAgent = useMemo(() => {
    if (!selectedAgentMember) return new Set<string>();
    const invalid = descendantsOf(selectedAgentMember.principalId, agentChildrenByPrincipalId);
    invalid.add(selectedAgentMember.principalId);
    return invalid;
  }, [selectedAgentMember?.principalId, agentChildrenByPrincipalId]);

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Teams" }
    ]);
  }, [setBreadcrumbs, selectedCompany?.name]);

  useEffect(() => {
    if (activeHumanMembers.length === 0) {
      setSelectedHumanMemberId(null);
    } else if (!selectedHumanMemberId || !activeHumanMembers.some((m) => m.id === selectedHumanMemberId)) {
      setSelectedHumanMemberId(activeHumanMembers[0]!.id);
    }
  }, [activeHumanMembers, selectedHumanMemberId]);

  useEffect(() => {
    if (activeAgentMembers.length === 0) {
      setSelectedAgentMemberId(null);
    } else if (!selectedAgentMemberId || !activeAgentMembers.some((m) => m.id === selectedAgentMemberId)) {
      setSelectedAgentMemberId(activeAgentMembers[0]!.id);
    }
  }, [activeAgentMembers, selectedAgentMemberId]);

  useEffect(() => {
    const nextRoleDrafts: Record<string, string> = {};
    const nextManagerDrafts: Record<string, string> = {};
    const nextAgentReportsDrafts: Record<string, string> = {};
    for (const member of activeHumanMembers) {
      nextRoleDrafts[member.id] = member.membershipRole ?? "";
      nextManagerDrafts[member.id] = member.reportsToMembershipId ?? "";
    }
    for (const member of activeAgentMembers) {
      nextRoleDrafts[member.id] = member.membershipRole ?? "";
      nextAgentReportsDrafts[member.id] = agentByPrincipalId.get(member.principalId)?.reportsTo ?? "";
    }
    setMemberRoleDrafts(nextRoleDrafts);
    setMemberManagerDrafts(nextManagerDrafts);
    setAgentReportsDrafts(nextAgentReportsDrafts);
  }, [activeHumanMembers, activeAgentMembers, agentByPrincipalId]);

  const invalidateMembers = async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.access.members(selectedCompanyId!)
    });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.org(selectedCompanyId!)
    });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.agents.list(selectedCompanyId!)
    });
  };

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
      setHumanInviteError(null);
      setHumanInviteCredentials({
        name: created.name,
        email: created.email,
        temporaryUsername: created.temporaryUsername,
        temporaryPassword: created.temporaryPassword,
      });
      setHumanInviteName("");
      setHumanInviteEmail("");
      setHumanInvitePermissionKeys([]);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sidebarBadges(selectedCompanyId!),
      });
      await invalidateMembers();
    },
    onError: (err) => {
      setHumanInviteCredentials(null);
      setHumanInviteError(err instanceof Error ? err.message : "Failed to create human invite");
    },
  });

  const humanSaveMutation = useMutation({
    mutationFn: (input: { memberId: string; membershipRole: string | null; reportsToMembershipId: string | null }) =>
      accessApi.updateMemberOrgConfig(selectedCompanyId!, input.memberId, {
        membershipRole: input.membershipRole,
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
    const mgrDraft = (memberManagerDrafts[member.id] ?? "").trim();
    const roleNow = (member.membershipRole ?? "").trim();
    const mgrNow = (member.reportsToMembershipId ?? "").trim();
    return roleDraft !== roleNow || mgrDraft !== mgrNow;
  }

  function computeAgentDirty(member: CompanyMember | null) {
    if (!member) return false;
    const roleDraft = (memberRoleDrafts[member.id] ?? "").trim();
    const reportsDraft = (agentReportsDrafts[member.id] ?? "").trim();
    const roleNow = (member.membershipRole ?? "").trim();
    const reportsNow = (agentByPrincipalId.get(member.principalId)?.reportsTo ?? "").trim();
    return roleDraft !== roleNow || reportsDraft !== reportsNow;
  }

  const humanIsDirty = computeDirty(selectedHumanMember);
  const agentIsDirty = computeAgentDirty(selectedAgentMember);
  const selectedHumanManagerId = selectedHumanMember
    ? (memberManagerDrafts[selectedHumanMember.id] ?? "").trim()
    : "";
  const selectedHumanManagerIsAgent =
    !!selectedHumanManagerId && memberPrincipalTypeById.get(selectedHumanManagerId) === "agent";

  function revertDraftsToServer(memberId: string) {
    const serverMember = memberById.get(memberId) ?? null;
    if (!serverMember) return;
    setMemberRoleDrafts((prev) => ({ ...prev, [memberId]: serverMember.membershipRole ?? "" }));
    setMemberManagerDrafts((prev) => ({ ...prev, [memberId]: serverMember.reportsToMembershipId ?? "" }));
  }

  // Autosave (debounced) for selected human
  useEffect(() => {
    if (!selectedCompanyId || !selectedHumanMember) return;
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
    selectedHumanMember?.id,
    memberRoleDrafts[selectedHumanMember?.id ?? ""],
    memberManagerDrafts[selectedHumanMember?.id ?? ""],
    selectedHumanManagerIsAgent,
  ]);

  // Autosave (debounced) for selected agent
  useEffect(() => {
    if (!selectedCompanyId || !selectedAgentMember) return;
    if (!agentIsDirty) {
      if (getMemberSaveState(selectedAgentMember.id) !== "saving") setMemberSaveState(selectedAgentMember.id, "idle");
      return;
    }

    setMemberSaveState(selectedAgentMember.id, agentSaveMutation.isPending ? "saving" : "dirty");

    const handle = window.setTimeout(() => {
      setMemberSaveState(selectedAgentMember.id, "saving");
      agentSaveMutation.mutate(
        {
          memberId: selectedAgentMember.id,
          principalId: selectedAgentMember.principalId,
          membershipRole: (memberRoleDrafts[selectedAgentMember.id] ?? "").trim() || null,
          reportsTo: (agentReportsDrafts[selectedAgentMember.id] ?? "").trim() || null
        },
        {
          onSuccess: () => {
            setMemberSaveState(selectedAgentMember.id, "saved");
            setMemberSaveErrors((prev) => {
              if (!prev[selectedAgentMember.id]) return prev;
              const { [selectedAgentMember.id]: _drop, ...rest } = prev;
              return rest;
            });
            window.setTimeout(() => {
              if (!computeAgentDirty(selectedAgentMember)) setMemberSaveState(selectedAgentMember.id, "idle");
            }, 900);
          },
          onError: (err) => {
            setMemberSaveState(selectedAgentMember.id, "error");
            setMemberSaveErrors((prev) => ({ ...prev, [selectedAgentMember.id]: apiErrorMessage(err) }));
            const serverMember = memberById.get(selectedAgentMember.id) ?? null;
            setMemberRoleDrafts((prev) => ({ ...prev, [selectedAgentMember.id]: serverMember?.membershipRole ?? "" }));
            setAgentReportsDrafts((prev) => ({
              ...prev,
              [selectedAgentMember.id]: agentByPrincipalId.get(selectedAgentMember.principalId)?.reportsTo ?? ""
            }));
          }
        }
      );
    }, 650);

    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedCompanyId,
    selectedAgentMember?.id,
    memberRoleDrafts[selectedAgentMember?.id ?? ""],
    agentReportsDrafts[selectedAgentMember?.id ?? ""]
  ]);

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
    const isPreset = merged.includes(normalized);
    const selectValue = normalized === "" ? "" : isPreset ? normalized : CUSTOM_ROLE_VALUE;
    return (
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <select
          className="h-10 w-full rounded-xl border border-border/60 bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
          value={selectValue}
          onChange={(e) => {
            const next = e.target.value;
            if (next === CUSTOM_ROLE_VALUE) return;
            setMemberRoleDrafts((prev) => ({ ...prev, [member.id]: next }));
          }}
        >
          <option value="">None</option>
          {merged.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
          <option value={CUSTOM_ROLE_VALUE}>Other…</option>
        </select>
      </div>
    );
  }

  if (!selectedCompany) {
    return <div className="text-sm text-muted-foreground">No company selected.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl border border-sidebar-border/80 bg-sidebar/55 px-6 pb-6 pt-8 shadow-sm">
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted">
              <Users className="size-7 text-muted-foreground" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Teams</h1>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
                Manage humans and AI agents in one place. Edits save automatically.
              </p>
              {!membersPermissionDenied && !membersLoading ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground">
                    <UserRound className="size-3.5 opacity-90" aria-hidden />
                    {activeHumanMembers.length} humans
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground">
                    <Bot className="size-3.5 opacity-90" aria-hidden />
                    {activeAgentMembers.length} agents
                  </span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end lg:max-w-md xl:max-w-xl">
          <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
            <DialogTrigger asChild>
              <Button type="button" className="rounded-xl shadow-sm" variant="default">
                Invite Human
              </Button>
            </DialogTrigger>
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
                          Name <span className="font-normal">(optional)</span>
                        </Label>
                        <Input
                          id="invite-name"
                          className="h-11 rounded-2xl border-border/60"
                          type="text"
                          placeholder="Full name"
                          value={humanInviteName}
                          onChange={(e) => setHumanInviteName(e.target.value)}
                        />
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
                              } catch {
                                /* clipboard may not be available */
                              }
                            }}
                          >
                            Copy credentials
                          </Button>
                        </div>
                      </div>
                    )}
                  </section>
                  <section className="min-w-0 space-y-3">
                    <h3 className="text-sm font-semibold tracking-tight text-foreground">Initial access</h3>
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
                    className="rounded-full px-8 shadow-sm"
                    onClick={() => humanInviteMutation.mutate()}
                    disabled={
                      humanInviteMutation.isPending || !humanInviteEmail.trim() || !selectedCompanyId
                    }
                  >
                    {humanInviteMutation.isPending ? "Creating..." : "Create invite"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={rolesDialogOpen} onOpenChange={setRolesDialogOpen}>
            <DialogTrigger asChild>
              <Button type="button" variant="secondary" className="rounded-xl border-border/60">
                Manage roles
              </Button>
            </DialogTrigger>
            <DialogContent className="w-full max-w-7xl rounded-2xl border-border/70 bg-card p-6 shadow-sm">
              <div className="pr-14 border-b border-border/60 pb-4">
                <DialogHeader>
                  <DialogTitle>Manage roles</DialogTitle>
                  <DialogDescription>
                    Define role templates and assign existing system permissions.
                  </DialogDescription>
                </DialogHeader>
              </div>

              <div className="pt-4 grid gap-4 lg:grid-cols-[20rem_1fr]">
                  <div className="rounded-xl border border-border/60 bg-muted/10 p-4 space-y-4">
                    <div className="text-sm font-semibold text-foreground">Role Library</div>
                    <div className="flex items-center gap-2">
                      <Input
                        value={newHumanRole}
                        onChange={(e) => setNewHumanRole(e.target.value)}
                        placeholder="Create role (e.g. Sales Lead)"
                        className="h-10"
                      />
                      <Button
                        type="button"
                        onClick={() => {
                          if (!selectedCompanyId) return;
                          const next = normalizeRoleLabel(newHumanRole);
                          if (!next) return;
                          setNewHumanRole("");
                          setCustomHumanRoles((prev) => (prev.includes(next) ? prev : [...prev, next]));
                          setSelectedHumanRoleForManage(next);
                          setEditingHumanRolePermissions(humanRolePermissions[next] ?? []);
                        }}
                        disabled={!normalizeRoleLabel(newHumanRole)}
                      >
                        Add role
                      </Button>
                    </div>
                    {customHumanRoles.length > 0 ? (
                      <div className="space-y-1.5">
                        {customHumanRoles.map((role) => (
                          <button
                            key={role}
                            type="button"
                            className={cn(
                              "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                              selectedHumanRoleForManage === role
                                ? "border-sidebar-border bg-sidebar-accent/80 text-sidebar-accent-foreground shadow-xs"
                                : "border-border bg-background text-foreground hover:bg-accent/50",
                            )}
                            title="Select role"
                            onClick={() => {
                              setSelectedHumanRoleForManage(role);
                              setEditingHumanRolePermissions(humanRolePermissions[role] ?? []);
                            }}
                          >
                            {role}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed border-border/70 bg-background/40 px-3 py-6 text-center text-sm text-muted-foreground">
                        No custom roles yet.
                      </div>
                    )}
                  </div>
                  {selectedHumanRoleForManage ? (
                      <div className="space-y-3 rounded-xl border border-border/60 bg-muted/10 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-foreground">
                              Manage role: {selectedHumanRoleForManage}
                            </div>
                            <div className="text-xs text-muted-foreground">Grant or revoke existing permissions only.</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setHumanRolePermissions((prev) => ({
                                  ...prev,
                                  [selectedHumanRoleForManage]: editingHumanRolePermissions,
                                }));
                              }}
                            >
                              Save role
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={() => {
                                const roleToDelete = selectedHumanRoleForManage;
                                setCustomHumanRoles((prev) => prev.filter((r) => r !== roleToDelete));
                                setHumanRolePermissions((prev) => {
                                  const next = { ...prev };
                                  delete next[roleToDelete];
                                  return next;
                                });
                              }}
                            >
                              Remove role
                            </Button>
                          </div>
                        </div>
                        <HumanPermissionsPanel
                          idPrefix={`manage-role-${selectedHumanRoleForManage}`}
                          enabledKeys={editingHumanRolePermissions}
                          onKeysChange={setEditingHumanRolePermissions}
                          showPresets={false}
                          intro={
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              Configure access for team, agents, tasks/workflow, and company management.
                            </p>
                          }
                        />
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border/70 bg-muted/10 px-4 py-16 text-center text-sm text-muted-foreground">
                        Select a role to configure permissions.
                      </div>
                    )}
              </div>
            </DialogContent>
          </Dialog>

          <div className="w-full min-w-0 sm:max-w-xs sm:flex-1 lg:max-w-sm">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, role…"
              className="h-10 rounded-2xl border-border/60 bg-background/80 shadow-inner"
            />
          </div>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "users" | "agents")} className="gap-4">
        {membersPermissionDenied ? (
          <div className="rounded-2xl border border-border/60 bg-card px-5 py-6 text-sm text-muted-foreground shadow-sm ring-1 ring-border/30">
            <div className="font-medium text-foreground">You do not have permission to view Teams members.</div>
            <div className="mt-2">
              Ask a company admin for the <code>users:manage_permissions</code> permission.
            </div>
          </div>
        ) : null}
        {!membersPermissionDenied && membersError ? (
          <div className="rounded-2xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive ring-1 ring-destructive/15">
            {apiErrorMessage(membersError)}
          </div>
        ) : null}
        {!membersPermissionDenied && !membersError ? (
          <>
        <TabsList className="h-auto w-full justify-start gap-1 rounded-full border border-sidebar-border bg-sidebar/85 p-1.5 sm:w-auto">
          <TabsTrigger value="users" className="gap-2 rounded-full px-4 py-2 font-medium data-[state=active]:bg-sidebar-accent data-[state=active]:text-sidebar-accent-foreground data-[state=active]:shadow-sm">
            <UserRound className="size-4 text-muted-foreground opacity-90" aria-hidden />
            Humans{" "}
            <span className="text-xs text-muted-foreground">{membersLoading ? "" : `(${activeHumanMembers.length})`}</span>
          </TabsTrigger>
          <TabsTrigger value="agents" className="gap-2 rounded-full px-4 py-2 font-medium data-[state=active]:bg-sidebar-accent data-[state=active]:text-sidebar-accent-foreground data-[state=active]:shadow-sm">
            <Bot className="size-4 text-muted-foreground opacity-90" aria-hidden />
            Agents{" "}
            <span className="text-xs text-muted-foreground">{membersLoading ? "" : `(${activeAgentMembers.length})`}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
            <div className="flex h-full min-h-[36rem] flex-col overflow-hidden rounded-2xl border border-sidebar-border/70 bg-sidebar/45 shadow-sm">
              <div className="border-b border-sidebar-border/70 bg-sidebar/40 px-4 py-3">
                <div className="text-sm font-semibold text-foreground">Humans</div>
                <div className="text-xs text-muted-foreground">
                  {membersLoading ? "Loading…" : `${filteredHumanMembers.length} shown`}
                </div>
              </div>
              <div className="flex-1 space-y-1 overflow-y-auto p-2">
                {!membersLoading && filteredHumanMembers.length === 0 && (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
                    <UserRound className="size-9 text-muted-foreground" aria-hidden />
                    <p className="text-sm text-muted-foreground">No matching humans.</p>
                  </div>
                )}
                {filteredHumanMembers.map((member) => {
                  const selected = selectedHumanMember?.id === member.id;
                  const isSuspended = member.status === "suspended";
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => setSelectedHumanMemberId(member.id)}
                      className={cn(
                        "w-full rounded-2xl px-3 py-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60",
                        selected
                          ? "bg-sidebar-accent/70 text-sidebar-accent-foreground shadow-sm ring-1 ring-sidebar-border"
                          : "hover:bg-muted/55",
                        isSuspended && "opacity-60",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <DirectoryMemberAvatar member={member} size="sm" className="mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-sm font-medium text-foreground">{memberDisplayName(member)}</span>
                            {isSuspended && (
                              <span className="shrink-0 inline-flex items-center rounded-full border border-orange-200 bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300">
                                Deactivated
                              </span>
                            )}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{memberSecondaryLine(member)}</div>
                          <div className="mt-1 text-[11px] font-medium text-muted-foreground">
                            {member.membershipRole ?? "member"}
                          </div>
                        </div>
                        <SaveStatusPill state={getMemberSaveState(member.id)} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex h-full min-h-[36rem] flex-col overflow-hidden rounded-2xl border border-sidebar-border/70 bg-sidebar/35 shadow-sm">
              {selectedHumanMember ? (
                <>
                  <div className="border-b border-sidebar-border/70 bg-sidebar/45 px-5 py-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                      <DirectoryMemberAvatar member={selectedHumanMember} size="lg" className="shrink-0 shadow-md" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-lg font-semibold text-foreground">
                            {memberDisplayName(selectedHumanMember)}
                          </span>
                          {selectedHumanMember.status === "suspended" && (
                            <span className="shrink-0 inline-flex items-center rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300">
                              Deactivated
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-sm text-muted-foreground">
                          {memberSecondaryLine(selectedHumanMember)}
                        </div>
                      </div>
                      <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 sm:w-auto">
                        <SaveStatusPill state={getMemberSaveState(selectedHumanMember.id)} />
                        {selectedHumanMember.status === "suspended" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-xl"
                            disabled={
                              !selectedHumanMember ||
                              !selectedCompanyId ||
                              reactivateHumanMutation.isPending ||
                              removeHumanMutation.isPending
                            }
                            onClick={() => {
                              if (!selectedHumanMember) return;
                              reactivateHumanMutation.mutate(selectedHumanMember.id);
                            }}
                          >
                            {reactivateHumanMutation.isPending ? "Reactivating…" : "Reactivate"}
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-xl"
                            disabled={
                              !selectedHumanMember ||
                              !selectedCompanyId ||
                              deactivateHumanMutation.isPending ||
                              removeHumanMutation.isPending
                            }
                            onClick={() => {
                              if (!selectedHumanMember) return;
                              setDeactivateDialogOpen(true);
                            }}
                          >
                            {deactivateHumanMutation.isPending ? "Deactivating…" : "Deactivate"}
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          className="rounded-xl"
                          disabled={
                            !selectedHumanMember ||
                            !selectedCompanyId ||
                            deactivateHumanMutation.isPending ||
                            reactivateHumanMutation.isPending ||
                            removeHumanMutation.isPending
                          }
                          onClick={() => {
                            if (!selectedHumanMember) return;
                            setDeleteDialogOpen(true);
                          }}
                        >
                          {removeHumanMutation.isPending ? "Deleting…" : "Delete"}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 px-5 py-5">
                    <div className="grid gap-3 md:grid-cols-2">
                      <RolePicker
                        member={selectedHumanMember}
                        label="Role"
                        options={HUMAN_ROLE_OPTIONS}
                        customOptions={customHumanRoles}
                        onAddCustomOption={(role) =>
                          setCustomHumanRoles((prev) => (prev.includes(role) ? prev : [...prev, role]))
                        }
                      />
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Reports to</div>
                        <select
                          className="h-10 w-full rounded-xl border border-border/60 bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
                          value={memberManagerDrafts[selectedHumanMember.id] ?? ""}
                          onChange={(e) => {
                            const next = e.target.value;
                            setMemberSaveErrors((prev) => {
                              if (!prev[selectedHumanMember.id]) return prev;
                              const { [selectedHumanMember.id]: _drop, ...rest } = prev;
                              return rest;
                            });
                            setMemberManagerDrafts((prev) => ({ ...prev, [selectedHumanMember.id]: next }));
                          }}
                        >
                          <option value="">None</option>
                          <optgroup label="Humans">
                            {activeHumanMembers
                              .filter((candidate) => candidate.id !== selectedHumanMember.id)
                              .map((candidate) => (
                                <option
                                  key={candidate.id}
                                  value={candidate.id}
                                  disabled={invalidManagersForSelectedHuman.has(candidate.id)}
                                >
                                  {memberDisplayName(candidate)}
                                </option>
                              ))}
                          </optgroup>
                        </select>
                        {memberSaveErrors[selectedHumanMember.id] && (
                          <div className="text-[11px] text-destructive">
                            {memberSaveErrors[selectedHumanMember.id]}
                          </div>
                        )}
                        <div className="text-[11px] text-muted-foreground">
                          Humans can only report to humans. Options that would create a cycle are disabled.
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border/50 bg-muted/20 px-4 py-3 ring-1 ring-border/30">
                      <div className="text-xs font-semibold text-foreground">Notes</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Assigning which agents a human manages is done by setting each agent’s “Reports to”.
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border/50 bg-muted/10 px-4 py-4 ring-1 ring-border/30">
                      <div className="text-sm font-semibold text-foreground">Access & permissions</div>
                      <div className="mt-3">
                        <HumanPermissionsPanel
                          idPrefix={`member-${selectedHumanMember.id}`}
                          enabledKeys={ALL_PERMISSION_KEYS.filter((k) =>
                            selectedHumanMember.grants.some((g) => g.permissionKey === k),
                          )}
                          disabled={humanPermissionMutation.isPending || !selectedCompanyId}
                          onKeysChange={(keys) => {
                            if (!selectedHumanMember || !selectedCompanyId) return;
                            const nextGrants = keys.map((permissionKey) => ({
                              permissionKey,
                              scope: null,
                            }));
                            humanPermissionMutation.mutate({
                              memberId: selectedHumanMember.id,
                              grants: nextGrants,
                            });
                          }}
                          intro={
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              Changes save as soon as you flip a switch. Presets replace the current selection.
                            </p>
                          }
                        />
                      </div>
                      {humanPermissionMutation.isError ? (
                        <div className="mt-3 text-xs text-destructive">
                          {apiErrorMessage(humanPermissionMutation.error)}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sidebar-border/70 bg-sidebar/35 px-5 py-3">
                    <div className="text-xs text-muted-foreground">Autosave is on.</div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="rounded-xl"
                      disabled={
                        !humanIsDirty ||
                        humanSaveMutation.isPending ||
                        !selectedCompanyId ||
                        selectedHumanManagerIsAgent
                      }
                      onClick={() => {
                        if (!selectedHumanMember) return;
                        if (selectedHumanManagerIsAgent) return;
                        humanSaveMutation.mutate({
                          memberId: selectedHumanMember.id,
                          membershipRole: (memberRoleDrafts[selectedHumanMember.id] ?? "").trim() || null,
                          reportsToMembershipId: (memberManagerDrafts[selectedHumanMember.id] ?? "").trim() || null
                        });
                      }}
                    >
                      Save now
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                  <div className="flex size-16 items-center justify-center rounded-2xl border border-border bg-muted">
                    <UserRound className="size-8 text-muted-foreground" aria-hidden />
                  </div>
                  <p className="text-sm font-medium text-foreground">No human selected</p>
                  <p className="max-w-xs text-xs text-muted-foreground">Choose someone from the list to edit their role, reporting line, and access.</p>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="agents" className="mt-4">
          <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
            <div className="flex h-full min-h-[36rem] flex-col overflow-hidden rounded-2xl border border-sidebar-border/70 bg-sidebar/45 shadow-sm">
              <div className="border-b border-sidebar-border/70 bg-sidebar/40 px-4 py-3">
                <div className="text-sm font-semibold text-foreground">Agents</div>
                <div className="text-xs text-muted-foreground">
                  {membersLoading ? "Loading…" : `${filteredAgentMembers.length} shown`}
                </div>
              </div>
              <div className="flex-1 space-y-1 overflow-y-auto p-2">
                {!membersLoading && filteredAgentMembers.length === 0 && (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
                    <Bot className="size-9 text-muted-foreground" aria-hidden />
                    <p className="text-sm text-muted-foreground">No matching agents.</p>
                  </div>
                )}
                {filteredAgentMembers.map((member) => {
                  const selected = selectedAgentMember?.id === member.id;
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => setSelectedAgentMemberId(member.id)}
                      className={cn(
                        "w-full rounded-2xl px-3 py-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60",
                        selected
                          ? "bg-sidebar-accent/70 text-sidebar-accent-foreground shadow-sm ring-1 ring-sidebar-border"
                          : "hover:bg-muted/55",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <DirectoryMemberAvatar member={member} size="sm" className="mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-foreground">{memberDisplayName(member)}</div>
                          <div className="truncate text-xs text-muted-foreground">{memberSecondaryLine(member)}</div>
                          <div className="mt-1 text-[11px] font-medium text-muted-foreground">
                            {member.membershipRole ?? "agent"}
                          </div>
                        </div>
                        <SaveStatusPill state={getMemberSaveState(member.id)} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex h-full min-h-[36rem] flex-col overflow-hidden rounded-2xl border border-sidebar-border/70 bg-sidebar/35 shadow-sm">
              {selectedAgentMember ? (
                <>
                  <div className="border-b border-sidebar-border/70 bg-sidebar/45 px-5 py-5">
                    <div className="flex flex-wrap items-start gap-4">
                      <DirectoryMemberAvatar member={selectedAgentMember} size="lg" className="shrink-0 shadow-md" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-lg font-semibold text-foreground">{memberDisplayName(selectedAgentMember)}</div>
                        <div className="mt-0.5 truncate text-sm text-muted-foreground">{memberSecondaryLine(selectedAgentMember)}</div>
                      </div>
                      <SaveStatusPill state={getMemberSaveState(selectedAgentMember.id)} />
                    </div>
                  </div>

                  <div className="space-y-4 px-5 py-5">
                    <div className="grid gap-3 md:grid-cols-2">
                      <RolePicker
                        member={selectedAgentMember}
                        label="Role label"
                        options={AGENT_ROLE_OPTIONS}
                        customOptions={customAgentRoles}
                        onAddCustomOption={(role) =>
                          setCustomAgentRoles((prev) => (prev.includes(role) ? prev : [...prev, role]))
                        }
                      />
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Reports to</div>
                        <select
                          className="h-10 w-full rounded-xl border border-border/60 bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
                          value={agentReportsDrafts[selectedAgentMember.id] ?? ""}
                          onChange={(e) => {
                            const next = e.target.value;
                            setMemberSaveErrors((prev) => {
                              if (!prev[selectedAgentMember.id]) return prev;
                              const { [selectedAgentMember.id]: _drop, ...rest } = prev;
                              return rest;
                            });
                            setAgentReportsDrafts((prev) => ({ ...prev, [selectedAgentMember.id]: next }));
                          }}
                        >
                          <option value="">None</option>
                          <optgroup label="Agents">
                            {activeAgentMembers
                              .filter((candidate) => candidate.id !== selectedAgentMember.id)
                              .map((candidate) => (
                                <option
                                  key={candidate.id}
                                  value={candidate.principalId}
                                  disabled={invalidManagersForSelectedAgent.has(candidate.principalId)}
                                >
                                  {memberDisplayName(candidate)}
                                </option>
                              ))}
                          </optgroup>
                        </select>
                        {memberSaveErrors[selectedAgentMember.id] && (
                          <div className="text-[11px] text-destructive">
                            {memberSaveErrors[selectedAgentMember.id]}
                          </div>
                        )}
                        <div className="text-[11px] text-muted-foreground">
                          Options that would create a cycle are disabled.
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sidebar-border/70 bg-sidebar/35 px-5 py-3">
                    <div className="text-xs text-muted-foreground">Autosave is on.</div>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="rounded-xl"
                      disabled={!agentIsDirty || agentSaveMutation.isPending || !selectedCompanyId}
                      onClick={() => {
                        if (!selectedAgentMember) return;
                        agentSaveMutation.mutate({
                          memberId: selectedAgentMember.id,
                          principalId: selectedAgentMember.principalId,
                          membershipRole: (memberRoleDrafts[selectedAgentMember.id] ?? "").trim() || null,
                          reportsTo: (agentReportsDrafts[selectedAgentMember.id] ?? "").trim() || null
                        });
                      }}
                    >
                      Save now
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                  <div className="flex size-16 items-center justify-center rounded-2xl border border-border bg-muted">
                    <Bot className="size-8 text-muted-foreground" aria-hidden />
                  </div>
                  <p className="text-sm font-medium text-foreground">No agent selected</p>
                  <p className="max-w-xs text-xs text-muted-foreground">Pick an agent from the list to edit their role label and reporting line.</p>
                </div>
              )}
            </div>
          </div>
        </TabsContent>
          </>
        ) : null}
      </Tabs>

      {/* Deactivate confirmation dialog */}
      <Dialog open={deactivateDialogOpen} onOpenChange={setDeactivateDialogOpen}>
        <DialogContent className="max-w-md rounded-2xl border-border/60">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                </svg>
              </span>
              Deactivate human
            </DialogTitle>
            <DialogDescription className="pt-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {selectedHumanMember ? memberDisplayName(selectedHumanMember) : "This human"}
              </span>{" "}
              will lose active access to this company. You can reactivate them at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex gap-2 justify-end">
            <DialogClose asChild>
              <Button variant="outline" size="sm">Cancel</Button>
            </DialogClose>
            <Button
              size="sm"
              className="bg-amber-500 hover:bg-amber-600 text-white border-0"
              disabled={deactivateHumanMutation.isPending}
              onClick={() => {
                if (!selectedHumanMember) return;
                deactivateHumanMutation.mutate(selectedHumanMember.id, {
                  onSuccess: () => setDeactivateDialogOpen(false),
                });
              }}
            >
              {deactivateHumanMutation.isPending ? "Deactivating…" : "Deactivate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md rounded-2xl border-border/60">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                </svg>
              </span>
              Remove human
            </DialogTitle>
            <DialogDescription className="pt-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {selectedHumanMember ? memberDisplayName(selectedHumanMember) : "This human"}
              </span>{" "}
              will be removed from this company. This action cannot be undone from the UI.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex gap-2 justify-end">
            <DialogClose asChild>
              <Button variant="outline" size="sm">Cancel</Button>
            </DialogClose>
            <Button
              size="sm"
              variant="destructive"
              disabled={removeHumanMutation.isPending}
              onClick={() => {
                if (!selectedHumanMember) return;
                removeHumanMutation.mutate(selectedHumanMember.id, {
                  onSuccess: () => setDeleteDialogOpen(false),
                });
              }}
            >
              {removeHumanMutation.isPending ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
