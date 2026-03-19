import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Users } from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { accessApi, type CompanyMember } from "../api/access";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "../api/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const HUMAN_ROLE_OPTIONS = [
  "Owner",
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

function normalizeRoleLabel(input: string) {
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

function memberDisplayName(member: CompanyMember) {
  return member.principalType === "user"
    ? member.user?.name || member.user?.email || member.principalId
    : member.agent?.name || member.principalId;
}

function memberSecondaryLine(member: CompanyMember) {
  if (member.principalType === "user") return member.user?.email ?? "unknown email";
  return member.agent?.role ?? "agent";
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
  const [memberSaveStates, setMemberSaveStates] = useState<Record<string, SaveState>>({});
  const [memberSaveErrors, setMemberSaveErrors] = useState<Record<string, string>>({});
  const [customHumanRoles, setCustomHumanRoles] = useState<string[]>([]);
  const [customAgentRoles, setCustomAgentRoles] = useState<string[]>([]);
  const [newHumanRole, setNewHumanRole] = useState("");
  const [newAgentRole, setNewAgentRole] = useState("");
  const [rolesDialogOpen, setRolesDialogOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [humanInviteName, setHumanInviteName] = useState("");
  const [humanInviteEmail, setHumanInviteEmail] = useState("");
  const [humanInviteError, setHumanInviteError] = useState<string | null>(null);
  const [humanInviteCredentials, setHumanInviteCredentials] = useState<{
    name: string;
    email: string;
    temporaryUsername: string;
    temporaryPassword: string;
  } | null>(null);

  const { data: companyMembers, isLoading: membersLoading } = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.access.members(selectedCompanyId)
      : ["access", "members", "none"],
    queryFn: () => accessApi.listMembers(selectedCompanyId!),
    enabled: !!selectedCompanyId
  });

  useEffect(() => {
    if (!selectedCompanyId) return;
    const prefs = readCompanyRolePrefs(selectedCompanyId);
    setCustomHumanRoles(prefs.human);
    setCustomAgentRoles(prefs.agent);
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    writeCompanyRolePrefs(selectedCompanyId, { human: customHumanRoles, agent: customAgentRoles });
  }, [selectedCompanyId, customHumanRoles, customAgentRoles]);

  const activeHumanMembers = useMemo(
    () =>
      (companyMembers ?? []).filter(
        (member: CompanyMember) => member.principalType === "user" && member.status === "active"
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
    activeHumanMembers.find((m) => m.id === selectedHumanMemberId) ?? activeHumanMembers[0] ?? null;
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

  const childrenByMemberId = useMemo(() => {
    const parentById: Record<string, string> = {};
    for (const member of [...activeHumanMembers, ...activeAgentMembers]) {
      parentById[member.id] = (memberManagerDrafts[member.id] ?? member.reportsToMembershipId ?? "").trim();
    }
    return buildChildrenIndex(parentById);
  }, [activeHumanMembers, activeAgentMembers, memberManagerDrafts]);

  const invalidManagersForSelectedHuman = useMemo(() => {
    if (!selectedHumanMember) return new Set<string>();
    const invalid = descendantsOf(selectedHumanMember.id, childrenByMemberId);
    invalid.add(selectedHumanMember.id);
    return invalid;
  }, [selectedHumanMember?.id, childrenByMemberId]);

  const invalidManagersForSelectedAgent = useMemo(() => {
    if (!selectedAgentMember) return new Set<string>();
    const invalid = descendantsOf(selectedAgentMember.id, childrenByMemberId);
    invalid.add(selectedAgentMember.id);
    return invalid;
  }, [selectedAgentMember?.id, childrenByMemberId]);

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
    for (const member of activeHumanMembers) {
      nextRoleDrafts[member.id] = member.membershipRole ?? "";
      nextManagerDrafts[member.id] = member.reportsToMembershipId ?? "";
    }
    for (const member of activeAgentMembers) {
      nextRoleDrafts[member.id] = member.membershipRole ?? "";
      nextManagerDrafts[member.id] = member.reportsToMembershipId ?? "";
    }
    setMemberRoleDrafts(nextRoleDrafts);
    setMemberManagerDrafts(nextManagerDrafts);
  }, [activeHumanMembers, activeAgentMembers]);

  const invalidateMembers = async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.access.members(selectedCompanyId!)
    });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.org(selectedCompanyId!)
    });
  };

  const humanInviteMutation = useMutation({
    mutationFn: () =>
      accessApi.createHumanInvite(selectedCompanyId!, {
        email: humanInviteEmail.trim(),
        name: humanInviteName.trim() || undefined,
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
    onSuccess: invalidateMembers
  });

  const removeHumanMutation = useMutation({
    mutationFn: (memberId: string) => accessApi.removeMember(selectedCompanyId!, memberId),
    onSuccess: invalidateMembers
  });

  const agentSaveMutation = useMutation({
    mutationFn: (input: { memberId: string; membershipRole: string | null; reportsToMembershipId: string | null }) =>
      accessApi.updateMemberOrgConfig(selectedCompanyId!, input.memberId, {
        membershipRole: input.membershipRole,
        reportsToMembershipId: input.reportsToMembershipId
      }),
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

  const humanIsDirty = computeDirty(selectedHumanMember);
  const agentIsDirty = computeDirty(selectedAgentMember);
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
          membershipRole: (memberRoleDrafts[selectedAgentMember.id] ?? "").trim() || null,
          reportsToMembershipId: (memberManagerDrafts[selectedAgentMember.id] ?? "").trim() || null
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
              if (!computeDirty(selectedAgentMember)) setMemberSaveState(selectedAgentMember.id, "idle");
            }, 900);
          },
          onError: (err) => {
            setMemberSaveState(selectedAgentMember.id, "error");
            setMemberSaveErrors((prev) => ({ ...prev, [selectedAgentMember.id]: apiErrorMessage(err) }));
            revertDraftsToServer(selectedAgentMember.id);
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
    memberManagerDrafts[selectedAgentMember?.id ?? ""]
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
    const canAdd = (() => {
      const next = normalizeRoleLabel(roleDraft);
      return !!next && !merged.includes(next);
    })();

    return (
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <select
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
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
        {selectValue === CUSTOM_ROLE_VALUE && (
          <div className="space-y-2">
            <Input
              value={roleDraft}
              onChange={(e) => setMemberRoleDrafts((prev) => ({ ...prev, [member.id]: e.target.value }))}
              placeholder="Custom role…"
            />
            {onAddCustomOption && (
              <div className="flex items-center justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={!canAdd}
                  onClick={() => {
                    const next = normalizeRoleLabel(roleDraft);
                    if (!next) return;
                    onAddCustomOption(next);
                    setMemberRoleDrafts((prev) => ({ ...prev, [member.id]: next }));
                  }}
                >
                  Add to role list
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (!selectedCompany) {
    return <div className="text-sm text-muted-foreground">No company selected.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-bold text-foreground">Teams</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage human users and agents. Changes auto-save.
          </p>
        </div>
        <div className="flex w-full max-w-xl items-center justify-end gap-2">
          <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
            <DialogTrigger asChild>
              <Button type="button" variant="secondary">
                Invite users
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Invite human user</DialogTitle>
                <DialogDescription>
                  Send a human invite and get temporary credentials for a new teammate.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 space-y-3">
                <div className="grid gap-2 md:grid-cols-2">
                  <Input
                    className="h-9"
                    type="text"
                    placeholder="Name (optional)"
                    value={humanInviteName}
                    onChange={(e) => setHumanInviteName(e.target.value)}
                  />
                  <Input
                    className="h-9"
                    type="email"
                    placeholder="Email"
                    value={humanInviteEmail}
                    onChange={(e) => setHumanInviteEmail(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => humanInviteMutation.mutate()}
                    disabled={
                      humanInviteMutation.isPending || !humanInviteEmail.trim() || !selectedCompanyId
                    }
                  >
                    {humanInviteMutation.isPending ? "Creating..." : "Create invite"}
                  </Button>
                  {humanInviteError && (
                    <span className="text-xs text-destructive">{humanInviteError}</span>
                  )}
                </div>
                {humanInviteCredentials && (
                  <div className="space-y-1 rounded-md border border-border bg-background px-2.5 py-2 text-xs">
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
                        size="sm"
                        variant="ghost"
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
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={rolesDialogOpen} onOpenChange={setRolesDialogOpen}>
            <DialogTrigger asChild>
              <Button type="button" variant="secondary">
                Manage roles
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Manage roles</DialogTitle>
                <DialogDescription>
                  Add reusable roles for your org. These appear in the dropdowns across People.
                </DialogDescription>
              </DialogHeader>

              <Tabs defaultValue="humans">
                <TabsList variant="line" className="px-0">
                  <TabsTrigger value="humans">Humans</TabsTrigger>
                  <TabsTrigger value="agents">Agents</TabsTrigger>
                </TabsList>

                <TabsContent value="humans">
                  <div className="space-y-3">
                    <div className="text-sm font-medium text-foreground">Custom human roles</div>
                    <div className="flex items-center gap-2">
                      <Input
                        value={newHumanRole}
                        onChange={(e) => setNewHumanRole(e.target.value)}
                        placeholder="Add a role (e.g. Sales Lead)"
                      />
                      <Button
                        type="button"
                        onClick={() => {
                          if (!selectedCompanyId) return;
                          const next = normalizeRoleLabel(newHumanRole);
                          if (!next) return;
                          setNewHumanRole("");
                          setCustomHumanRoles((prev) => (prev.includes(next) ? prev : [...prev, next]));
                        }}
                        disabled={!normalizeRoleLabel(newHumanRole)}
                      >
                        Add
                      </Button>
                    </div>
                    {customHumanRoles.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {customHumanRoles.map((role) => (
                          <button
                            key={role}
                            type="button"
                            className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
                            title="Remove"
                            onClick={() => setCustomHumanRoles((prev) => prev.filter((r) => r !== role))}
                          >
                            {role}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        No custom roles yet.
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="agents">
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
                            className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
                            title="Remove"
                            onClick={() => setCustomAgentRoles((prev) => prev.filter((r) => r !== role))}
                          >
                            {role}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        No custom role labels yet.
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </DialogContent>
          </Dialog>

          <div className="w-full max-w-sm">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, role…" />
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "users" | "agents")}>
        <TabsList variant="line" className="px-0">
          <TabsTrigger value="users">
            Users <span className="text-xs text-muted-foreground">{membersLoading ? "" : `(${activeHumanMembers.length})`}</span>
          </TabsTrigger>
          <TabsTrigger value="agents">
            Agents <span className="text-xs text-muted-foreground">{membersLoading ? "" : `(${activeAgentMembers.length})`}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <div className="grid gap-3 lg:grid-cols-[20rem_1fr]">
            <div className="rounded-lg border border-border bg-card">
              <div className="border-b border-border/60 px-3 py-2">
                <div className="text-xs font-semibold text-foreground">Active users</div>
                <div className="text-xs text-muted-foreground">
                  {membersLoading ? "Loading…" : `${filteredHumanMembers.length} shown`}
                </div>
              </div>
              <div className="max-h-112 overflow-y-auto p-1">
                {!membersLoading && filteredHumanMembers.length === 0 && (
                  <div className="px-3 py-3 text-sm text-muted-foreground">No matching users.</div>
                )}
                {filteredHumanMembers.map((member) => {
                  const selected = selectedHumanMember?.id === member.id;
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => setSelectedHumanMemberId(member.id)}
                      className={`w-full rounded-md px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 ${
                        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{memberDisplayName(member)}</div>
                          <div className="truncate text-xs text-muted-foreground">{memberSecondaryLine(member)}</div>
                        </div>
                        <SaveStatusPill state={getMemberSaveState(member.id)} />
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {member.membershipRole ?? "member"}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card">
              {selectedHumanMember ? (
                <>
                  <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-foreground">{memberDisplayName(selectedHumanMember)}</div>
                      <div className="truncate text-xs text-muted-foreground">{memberSecondaryLine(selectedHumanMember)}</div>
                    </div>
                    <SaveStatusPill state={getMemberSaveState(selectedHumanMember.id)} />
                  </div>

                  <div className="space-y-4 px-4 py-4">
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
                          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
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

                    <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                      <div className="text-xs font-medium text-foreground">Notes</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Assigning which agents a human manages is done by setting each agent’s “Reports to”.
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-border/60 px-4 py-3">
                    <div className="text-xs text-muted-foreground">Autosave is on.</div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
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
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          !selectedHumanMember ||
                          !selectedCompanyId ||
                          deactivateHumanMutation.isPending ||
                          removeHumanMutation.isPending
                        }
                        onClick={() => {
                          if (!selectedHumanMember) return;
                          const confirmed = window.confirm(
                            `Deactivate ${memberDisplayName(selectedHumanMember)}? They will lose active access to this company.`
                          );
                          if (!confirmed) return;
                          deactivateHumanMutation.mutate(selectedHumanMember.id);
                        }}
                      >
                        Deactivate
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={
                          !selectedHumanMember ||
                          !selectedCompanyId ||
                          deactivateHumanMutation.isPending ||
                          removeHumanMutation.isPending
                        }
                        onClick={() => {
                          if (!selectedHumanMember) return;
                          const confirmed = window.confirm(
                            `Remove ${memberDisplayName(selectedHumanMember)} from this company? This removes their membership from Teams.`
                          );
                          if (!confirmed) return;
                          removeHumanMutation.mutate(selectedHumanMember.id);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  No active users.
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="agents">
          <div className="grid gap-3 lg:grid-cols-[20rem_1fr]">
            <div className="rounded-lg border border-border bg-card">
              <div className="border-b border-border/60 px-3 py-2">
                <div className="text-xs font-semibold text-foreground">Active agents</div>
                <div className="text-xs text-muted-foreground">
                  {membersLoading ? "Loading…" : `${filteredAgentMembers.length} shown`}
                </div>
              </div>
              <div className="max-h-112 overflow-y-auto p-1">
                {!membersLoading && filteredAgentMembers.length === 0 && (
                  <div className="px-3 py-3 text-sm text-muted-foreground">No matching agents.</div>
                )}
                {filteredAgentMembers.map((member) => {
                  const selected = selectedAgentMember?.id === member.id;
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => setSelectedAgentMemberId(member.id)}
                      className={`w-full rounded-md px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 ${
                        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{memberDisplayName(member)}</div>
                          <div className="truncate text-xs text-muted-foreground">{memberSecondaryLine(member)}</div>
                        </div>
                        <SaveStatusPill state={getMemberSaveState(member.id)} />
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {member.membershipRole ?? "agent"}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card">
              {selectedAgentMember ? (
                <>
                  <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-foreground">{memberDisplayName(selectedAgentMember)}</div>
                      <div className="truncate text-xs text-muted-foreground">{memberSecondaryLine(selectedAgentMember)}</div>
                    </div>
                    <SaveStatusPill state={getMemberSaveState(selectedAgentMember.id)} />
                  </div>

                  <div className="space-y-4 px-4 py-4">
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
                          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
                          value={memberManagerDrafts[selectedAgentMember.id] ?? ""}
                          onChange={(e) => {
                            const next = e.target.value;
                            setMemberSaveErrors((prev) => {
                              if (!prev[selectedAgentMember.id]) return prev;
                              const { [selectedAgentMember.id]: _drop, ...rest } = prev;
                              return rest;
                            });
                            setMemberManagerDrafts((prev) => ({ ...prev, [selectedAgentMember.id]: next }));
                          }}
                        >
                          <option value="">None</option>
                          <optgroup label="Humans">
                            {activeHumanMembers.map((candidate) => (
                              <option
                                key={candidate.id}
                                value={candidate.id}
                                disabled={invalidManagersForSelectedAgent.has(candidate.id)}
                              >
                                {memberDisplayName(candidate)}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label="Agents">
                            {activeAgentMembers
                              .filter((candidate) => candidate.id !== selectedAgentMember.id)
                              .map((candidate) => (
                                <option
                                  key={candidate.id}
                                  value={candidate.id}
                                  disabled={invalidManagersForSelectedAgent.has(candidate.id)}
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

                  <div className="flex items-center justify-between border-t border-border/60 px-4 py-3">
                    <div className="text-xs text-muted-foreground">Autosave is on.</div>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!agentIsDirty || agentSaveMutation.isPending || !selectedCompanyId}
                      onClick={() => {
                        if (!selectedAgentMember) return;
                        agentSaveMutation.mutate({
                          memberId: selectedAgentMember.id,
                          membershipRole: (memberRoleDrafts[selectedAgentMember.id] ?? "").trim() || null,
                          reportsToMembershipId: (memberManagerDrafts[selectedAgentMember.id] ?? "").trim() || null
                        });
                      }}
                    >
                      Save now
                    </Button>
                  </div>
                </>
              ) : (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  No active agents.
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

