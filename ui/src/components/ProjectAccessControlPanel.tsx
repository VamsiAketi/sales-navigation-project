import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CompanyProjectAccessMode, ProjectPermissionKey, ProjectPrincipalGrant, Project } from "@paperclipai/shared";
import { PROJECT_PERMISSION_KEYS } from "@paperclipai/shared";
import { accessApi, type CompanyMember } from "../api/access";
import { authApi } from "../api/auth";
import { InlineEntitySelector, type InlineEntityOption } from "./InlineEntitySelector";
import { queryKeys } from "../lib/queryKeys";
import { useToast } from "../context/ToastContext";
import { ApiError } from "../api/client";
import {
  PROJECT_ACCESS_PRESETS,
  PROJECT_PERMISSION_UI_GROUPS,
  projectPermissionLabel,
} from "../lib/project-permission-ui";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Bot, Loader2, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

type PrincipalRef = { principalType: "user" | "agent"; principalId: string };

function principalKey(ref: PrincipalRef): string {
  return `${ref.principalType}:${ref.principalId}`;
}

function grantsForPrincipal(rows: ProjectPrincipalGrant[] | undefined, ref: PrincipalRef): Set<ProjectPermissionKey> {
  const set = new Set<ProjectPermissionKey>();
  if (!rows) return set;
  for (const row of rows) {
    if (row.principalType === ref.principalType && row.principalId === ref.principalId) {
      set.add(row.permissionKey);
    }
  }
  return set;
}

function displayNameForMember(m: CompanyMember): string {
  if (m.principalType === "user" && m.user) {
    return m.user.name?.trim() || m.user.email || m.principalId;
  }
  if (m.principalType === "agent" && m.agent) {
    return m.agent.name?.trim() || m.agent.role || m.principalId;
  }
  return m.principalId;
}

function searchTextForMember(m: CompanyMember): string {
  if (m.principalType === "user") {
    return [m.user?.name, m.user?.email, m.membershipRole, m.principalType]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(" ");
  }
  return [m.agent?.name, m.agent?.role, m.membershipRole, m.principalType]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ");
}

function memberAvatarInitials(member: CompanyMember): string {
  if (member.principalType === "user" && member.user) {
    const name = member.user.name?.trim();
    if (name) {
      const parts = name.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        const a = parts[0]?.[0];
        const b = parts[1]?.[0];
        if (a && b) return `${a}${b}`.toUpperCase();
      }
      return name.slice(0, 2).toUpperCase();
    }
    const email = member.user.email ?? "";
    return email.slice(0, 2).toUpperCase() || "U";
  }
  const raw = member.agent?.name ?? member.principalId;
  return raw.slice(0, 2).toUpperCase() || "A";
}

function nameToAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue}, 65%, 42%)`;
}

function pickPresetIdForKeys(keys: Set<ProjectPermissionKey>): string {
  const sorted = [...keys].sort().join(",");
  for (const preset of PROJECT_ACCESS_PRESETS) {
    const p = [...preset.keys].sort().join(",");
    if (p === sorted) return preset.id;
  }
  return "custom";
}

const PROJECT_READ_DEPENDENCIES: Partial<Record<ProjectPermissionKey, ProjectPermissionKey>> = {
  "project:edit tickets": "project:read",
  "project:hide tickets": "project:read",
  "project:edit configuration": "project:read",
  "project:edit Workflow": "project:read",
  "project:edit Budget": "project:read",
  "project:archive": "project:read",
  "members:manage": "project:read",
};

function normalizeProjectPermissionSelection(
  keys: Iterable<ProjectPermissionKey>,
): Set<ProjectPermissionKey> {
  const next = new Set<ProjectPermissionKey>(keys);
  for (const [actionKey, readKey] of Object.entries(PROJECT_READ_DEPENDENCIES) as Array<
    [ProjectPermissionKey, ProjectPermissionKey]
  >) {
    if (next.has(actionKey)) next.add(readKey);
  }
  return next;
}

export function ProjectAccessControlPanel({
  companyId,
  projectId,
  projectAccessMode,
}: {
  companyId: string;
  projectId: string;
  projectAccessMode: CompanyProjectAccessMode;
}) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<PrincipalRef | null>(null);
  const [draftKeys, setDraftKeys] = useState<Set<ProjectPermissionKey>>(new Set());

  const membersQuery = useQuery({
    queryKey: queryKeys.access.members(companyId),
    queryFn: () => accessApi.listMembers(companyId),
    enabled: !!companyId && projectAccessMode === "restricted",
  });

  const grantsQuery = useQuery({
    queryKey: queryKeys.projects.principalGrants(companyId, projectId),
    queryFn: () => accessApi.listProjectPrincipalGrants(companyId, projectId),
    enabled: !!companyId && !!projectId && projectAccessMode === "restricted",
    retry: false,
  });
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;

  const activeMembers = useMemo(() => {
    const rows = membersQuery.data ?? [];
    return rows.filter((m) => m.status === "active");
  }, [membersQuery.data]);
  const principalOptions = useMemo<InlineEntityOption[]>(
    () =>
      activeMembers.map((m) => ({
        id: principalKey({ principalType: m.principalType, principalId: m.principalId }),
        label: `${displayNameForMember(m)} (${m.principalType})`,
        searchText: searchTextForMember(m),
      })),
    [activeMembers],
  );
  const selectedMember = useMemo(
    () =>
      selected
        ? activeMembers.find(
            (m) => m.principalType === selected.principalType && m.principalId === selected.principalId,
          ) ?? null
        : null,
    [activeMembers, selected],
  );
  const ownerSelected =
    selectedMember?.principalType === "user" &&
    (selectedMember.membershipRole ?? "").trim().toLowerCase() === "owner";
  const presetOptions = useMemo<InlineEntityOption[]>(
    () => [
      ...PROJECT_ACCESS_PRESETS.map((preset) => ({
        id: preset.id,
        label: preset.label,
        searchText: `${preset.label} ${preset.description}`,
      })),
      { id: "custom", label: "Custom", searchText: "custom manual edited" },
    ],
    [],
  );
  const memberByPrincipalKey = useMemo(
    () =>
      new Map(
        activeMembers.map((m) => [
          principalKey({ principalType: m.principalType, principalId: m.principalId }),
          m,
        ]),
      ),
    [activeMembers],
  );

  useEffect(() => {
    if (projectAccessMode !== "restricted") return;
    if (selected) return;
    const firstHuman = activeMembers.find((m) => m.principalType === "user");
    const first = firstHuman ?? activeMembers[0];
    if (first) {
      setSelected({ principalType: first.principalType, principalId: first.principalId });
    }
  }, [activeMembers, projectAccessMode, selected]);

  useEffect(() => {
    if (!selected || !grantsQuery.data) return;
    if (
      selectedMember?.principalType === "user" &&
      (selectedMember.membershipRole ?? "").trim().toLowerCase() === "owner"
    ) {
      setDraftKeys(new Set(PROJECT_PERMISSION_KEYS));
      return;
    }
    setDraftKeys(grantsForPrincipal(grantsQuery.data, selected));
  }, [selected, grantsQuery.data, selectedMember]);

  const saveMutation = useMutation({
    mutationFn: async (input: {
      selected: PrincipalRef;
      permissionKeys: ProjectPermissionKey[];
    }) => {
      await accessApi.updateProjectPrincipalGrants(companyId, projectId, {
        principalType: input.selected.principalType,
        principalId: input.selected.principalId,
        permissionKeys: input.permissionKeys,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.principalGrants(companyId, projectId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.list(companyId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(projectId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sidebarBadges(companyId),
      });
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Failed to save";
      pushToast({ title: msg, tone: "error" });
    },
  });

  const savePermissions = useCallback(
    (nextKeys: Set<ProjectPermissionKey>) => {
      if (!selected || ownerSelected) return;
      const isSelfSelection =
        selected.principalType === "user" &&
        !!currentUserId &&
        selected.principalId === currentUserId;
      const hasReadAfterChange = nextKeys.has("project:read");

      // Reflect view-access revoke immediately for the current logged-in user.
      if (isSelfSelection && !hasReadAfterChange) {
        queryClient.setQueryData(queryKeys.projects.list(companyId), (prev: Project[] | undefined) =>
          (prev ?? []).filter((project) => project.id !== projectId),
        );
      }

      saveMutation.mutate({
        selected,
        permissionKeys: [...nextKeys],
      });
    },
    [companyId, currentUserId, ownerSelected, projectId, queryClient, saveMutation, selected],
  );

  const toggleKey = useCallback((key: ProjectPermissionKey, enabled: boolean) => {
    setDraftKeys((prev) => {
      if (!enabled && key === "project:read") {
        const blocking = Array.from(prev).find(
          (perm) => perm !== "project:read" && PROJECT_READ_DEPENDENCIES[perm] === "project:read",
        );
        if (blocking) {
          pushToast({
            title: "Cannot remove project view access",
            body: `"${projectPermissionLabel(blocking)}" requires "${projectPermissionLabel("project:read")}". Disable dependent access first.`,
            tone: "warn",
          });
          return prev;
        }
      }
      const next = new Set(prev);
      if (enabled) next.add(key);
      else next.delete(key);
      const normalized = normalizeProjectPermissionSelection(next);
      savePermissions(normalized);
      return normalized;
    });
  }, [pushToast, savePermissions]);

  const applyPreset = useCallback((presetId: string) => {
    const preset = PROJECT_ACCESS_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const next = normalizeProjectPermissionSelection(new Set(preset.keys));
    setDraftKeys(next);
    savePermissions(next);
  }, [savePermissions]);

  if (projectAccessMode === "open") {
    return (
      <div className="rounded-xl border border-border/80 bg-card/40 p-5 ring-1 ring-border/40">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
            <Shield className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Project access control</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              This company uses <span className="font-medium text-foreground">open</span> project access: every active
              company member can reach all projects. To assign per-project roles, switch the company to{" "}
              <span className="font-medium text-foreground">restricted</span> mode under{" "}
              <Link to="/company/settings" className="font-medium text-primary underline-offset-4 hover:underline">
                Company settings → Security &amp; access
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (membersQuery.isLoading || grantsQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading access data…
      </div>
    );
  }

  if (grantsQuery.isError) {
    const status = grantsQuery.error instanceof ApiError ? grantsQuery.error.status : 0;
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5 text-sm">
        <p className="font-medium text-destructive">Unable to load project permissions</p>
        <p className="mt-2 text-muted-foreground">
          {status === 403
            ? "You need company permission “Manage permissions” or project permission “Manage project access” to view this screen."
            : grantsQuery.error instanceof Error
              ? grantsQuery.error.message
              : "Unknown error"}
        </p>
      </div>
    );
  }

  if (activeMembers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No active members in this company. Add people under{" "}
        <span className="font-medium text-foreground">Company → People</span> before assigning project roles.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border/80 bg-linear-to-b from-card to-card/60 p-5 ring-1 ring-border/30">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-1">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">Principal access</h3>
            <p className="max-w-xl text-sm text-muted-foreground">
              Grants apply only to this project. Changes save automatically.
            </p>
          </div>
          <div className="flex w-full shrink-0 flex-col gap-2 sm:max-w-xs lg:w-72">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Principal</Label>
            <InlineEntitySelector
              value={selected ? principalKey(selected) : ""}
              options={principalOptions}
              placeholder="Select a principal"
              noneLabel="No principal"
              includeNoneOption={false}
              searchPlaceholder="Search principal..."
              emptyMessage="No matching principals found."
              className="h-9 w-full justify-between rounded-md border border-border bg-background px-2.5 py-2 text-sm font-normal"
              renderTriggerValue={(option) => {
                if (!option) return <span className="text-muted-foreground">Select a principal</span>;
                const member = memberByPrincipalKey.get(option.id);
                if (!member) return option.label;
                const label = displayNameForMember(member);
                return (
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <Avatar size="sm">
                      {member.principalType === "agent" ? (
                        <AvatarFallback className="bg-muted text-foreground ring-1 ring-border">
                          <Bot className="size-[55%] opacity-95" aria-hidden />
                        </AvatarFallback>
                      ) : (
                        <AvatarFallback
                          className="text-xs font-bold tracking-tight text-white ring-1 ring-black/20"
                          style={{ backgroundColor: nameToAvatarColor(label) }}
                        >
                          {memberAvatarInitials(member)}
                        </AvatarFallback>
                      )}
                    </Avatar>
                    <span className="truncate">{label}</span>
                  </span>
                );
              }}
              renderOption={(option, isSelected) => {
                const member = memberByPrincipalKey.get(option.id);
                if (!member) return <span className="truncate">{option.label}</span>;
                const label = displayNameForMember(member);
                return (
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <Avatar size="sm">
                      {member.principalType === "agent" ? (
                        <AvatarFallback className="bg-muted text-foreground ring-1 ring-border">
                          <Bot className="size-[55%] opacity-95" aria-hidden />
                        </AvatarFallback>
                      ) : (
                        <AvatarFallback
                          className="text-xs font-bold tracking-tight text-white ring-1 ring-black/20"
                          style={{ backgroundColor: nameToAvatarColor(label) }}
                        >
                          {memberAvatarInitials(member)}
                        </AvatarFallback>
                      )}
                    </Avatar>
                    <span className="min-w-0 truncate">
                      {label}
                      {!isSelected ? (
                        <span className="ml-1 text-xs text-muted-foreground">({member.principalType})</span>
                      ) : null}
                    </span>
                  </span>
                );
              }}
              onChange={(value) => {
                const [principalType, principalId] = value.split(":") as ["user" | "agent", string];
                if (principalType !== "user" && principalType !== "agent") return;
                setSelected({ principalType, principalId });
              }}
              openOnFocus={false}
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border/80 bg-card/30 p-4 sm:p-5">
        <section className="rounded-lg border border-border/50 bg-background/80 px-2.5 py-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quick presets</Label>
              <p className="text-xs text-muted-foreground">
                Apply a template, then fine-tune individual checkboxes below.
              </p>
            </div>
            <div className="w-full sm:max-w-xs lg:w-72">
              <InlineEntitySelector
                value={pickPresetIdForKeys(draftKeys)}
                options={presetOptions}
                placeholder="Preset"
                noneLabel="No preset"
                includeNoneOption={false}
                searchPlaceholder="Search preset..."
                emptyMessage="No matching preset."
                className="h-9 w-full justify-between rounded-md border border-border/70 bg-background/90 px-2.5 py-2 text-sm font-normal"
                onChange={(v) => {
                  if (ownerSelected) return;
                  if (v === "custom") return;
                  applyPreset(v);
                }}
                openOnFocus={false}
              />
            </div>
          </div>
        </section>

        <div className="mt-4 space-y-2">
          {PROJECT_PERMISSION_UI_GROUPS.map((group) => (
            <section key={group.id} className="rounded-lg border border-border/50 bg-background/80 px-2.5 py-2">
              <header className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.title}
                  </h3>
                </div>
                <span className="rounded-full border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {group.keys.length}
                </span>
              </header>
              <ul className="ml-1 mt-2 space-y-1 border-l border-border/70 pl-2.5">
                {group.keys.map((key) => {
                  const sid = `project-perm-${group.id}-${key}`;
                  return (
                    <li
                      key={key}
                      className="group flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/35"
                    >
                      <span className="h-px w-2 shrink-0 bg-border/80" aria-hidden />
                      <Checkbox
                        id={sid}
                        checked={draftKeys.has(key)}
                        disabled={ownerSelected}
                        onCheckedChange={(v) => toggleKey(key, v === true)}
                        aria-label={projectPermissionLabel(key)}
                        className="h-3.5 w-3.5 border-border/90 bg-background data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=unchecked]:border-muted-foreground/70"
                      />
                      <Label
                        htmlFor={sid}
                        className="min-w-0 flex-1 cursor-pointer truncate text-xs font-medium leading-tight text-foreground"
                      >
                        {projectPermissionLabel(key)}
                      </Label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-6 flex flex-col gap-2 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {ownerSelected
              ? "Owner always has full project permissions."
              : saveMutation.isPending
                ? "Saving changes..."
                : "Changes are saved automatically."}
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {PROJECT_PERMISSION_KEYS.length} distinct capabilities are available per project. Instance administrators always
        bypass these checks.
      </p>
    </div>
  );
}
