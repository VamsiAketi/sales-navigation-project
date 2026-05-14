import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { companiesApi } from "../api/companies";
import { accessApi } from "../api/access";
import { authApi } from "../api/auth";
import { assetsApi } from "../api/assets";
import { secretsApi } from "../api/secrets";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import type { CompanyProjectAccessMode } from "@paperclipai/shared";
import { Settings, Check, Download, Upload, Shield } from "lucide-react";
import { CompanyPatternIcon } from "../components/CompanyPatternIcon";
import { InlineEntitySelector, type InlineEntityOption } from "../components/InlineEntitySelector";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  ToggleField,
  HintIcon
} from "../components/agent-config-primitives";

type AgentSnippetInput = {
  onboardingTextUrl: string;
  connectionCandidates?: string[] | null;
  testResolutionUrl?: string | null;
};

export function CompanySettings() {
  const {
    companies,
    selectedCompany,
    selectedCompanyId,
    setSelectedCompanyId
  } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const { data: sidebarBadges } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.sidebarBadges(selectedCompanyId) : ["sidebar-badges", "none"],
    queryFn: () => sidebarBadgesApi.get(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    staleTime: 10_000,
  });
  const canReadCompanySettings = sidebarBadges?.canReadCompanySettings ?? true;
  const canManageCompanySettingsGeneral = sidebarBadges?.canManageCompanySettingsGeneral ?? true;
  const canManageCompanySettingsAppearance = sidebarBadges?.canManageCompanySettingsAppearance ?? true;
  const canManageCompanySettingsSecurityAccess = sidebarBadges?.canManageCompanySettingsSecurityAccess ?? true;
  const canManageCompanySettingsHiring = sidebarBadges?.canManageCompanySettingsHiring ?? true;
  const canManageCompanySettingsInvites = sidebarBadges?.canManageCompanySettingsInvites ?? true;
  const canManageCompanySettingsSecrets = sidebarBadges?.canManageCompanySettingsSecrets ?? true;
  const canManageCompanySettingsPackages = sidebarBadges?.canManageCompanySettingsPackages ?? true;
  // General settings local state
  const [companyName, setCompanyName] = useState("");
  const [description, setDescription] = useState("");
  const [brandColor, setBrandColor] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);

  // Sync local state from selected company
  useEffect(() => {
    if (!selectedCompany) return;
    setCompanyName(selectedCompany.name);
    setDescription(selectedCompany.description ?? "");
    setBrandColor(selectedCompany.brandColor ?? "");
    setLogoUrl(selectedCompany.logoUrl ?? "");
    setProjectAccessDraft(selectedCompany.projectAccessMode ?? "open");
  }, [selectedCompany]);

  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSnippet, setInviteSnippet] = useState<string | null>(null);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [snippetCopyDelightId, setSnippetCopyDelightId] = useState(0);
  const [newSecretName, setNewSecretName] = useState("");
  const [newSecretValue, setNewSecretValue] = useState("");
  const [newSecretDescription, setNewSecretDescription] = useState("");
  const [projectAccessDraft, setProjectAccessDraft] = useState<CompanyProjectAccessMode>("open");
  const [ownerTransferDialogOpen, setOwnerTransferDialogOpen] = useState(false);
  const [selectedNewOwnerMemberId, setSelectedNewOwnerMemberId] = useState("");
  const [selectedCurrentOwnerNextRole, setSelectedCurrentOwnerNextRole] = useState("admin");

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;

  const { data: companyMembers = [] } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.access.members(selectedCompanyId) : ["access-members", "none"],
    queryFn: () => accessApi.listMembers(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const activeHumanMembers = useMemo(
    () => companyMembers.filter((member) => member.principalType === "user" && member.status === "active"),
    [companyMembers],
  );
  const currentUserMember = useMemo(
    () => activeHumanMembers.find((member) => member.principalId === currentUserId) ?? null,
    [activeHumanMembers, currentUserId],
  );
  const isCurrentUserOwner = ((currentUserMember?.membershipRole ?? "").trim().toLowerCase() === "owner");
  const isCurrentUserReaderOrgRole = useMemo(
    () => (currentUserMember?.membershipRole ?? "").trim().toLowerCase() === "reader",
    [currentUserMember?.membershipRole],
  );
  const canUseCompanyPackagesActions = canManageCompanySettingsPackages && !isCurrentUserReaderOrgRole;
  const ownerTransferCandidates = useMemo(
    () => activeHumanMembers.filter((member) => member.id !== currentUserMember?.id),
    [activeHumanMembers, currentUserMember?.id],
  );
  const ownerTransferRoleOptions = ["admin", "operator", "viewer", "member"] as const;

  useEffect(() => {
    if (ownerTransferCandidates.length === 0) {
      setSelectedNewOwnerMemberId("");
      return;
    }
    if (!selectedNewOwnerMemberId || !ownerTransferCandidates.some((member) => member.id === selectedNewOwnerMemberId)) {
      setSelectedNewOwnerMemberId(ownerTransferCandidates[0]?.id ?? "");
    }
  }, [ownerTransferCandidates, selectedNewOwnerMemberId]);

  const generalDirty =
    !!selectedCompany &&
    (companyName !== selectedCompany.name ||
      description !== (selectedCompany.description ?? "") ||
      brandColor !== (selectedCompany.brandColor ?? ""));

  const generalMutation = useMutation({
    mutationFn: (data: {
      name?: string;
      description?: string | null;
      brandColor?: string | null;
    }) => companiesApi.update(selectedCompanyId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
  });

  const settingsMutation = useMutation({
    mutationFn: (requireApproval: boolean) =>
      companiesApi.update(selectedCompanyId!, {
        requireBoardApprovalForNewAgents: requireApproval
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
  });

  const projectAccessMutation = useMutation({
    mutationFn: (mode: CompanyProjectAccessMode) =>
      companiesApi.update(selectedCompanyId!, { projectAccessMode: mode }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      pushToast({ title: "Project access policy updated", tone: "success" });
    },
    onError: (err) => {
      pushToast({
        title: err instanceof Error ? err.message : "Could not update project access policy",
        tone: "error",
      });
    },
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      accessApi.createOpenClawInvitePrompt(selectedCompanyId!),
    onSuccess: async (invite) => {
      setInviteError(null);
      const base = window.location.origin.replace(/\/+$/, "");
      const onboardingTextLink =
        invite.onboardingTextUrl ??
        invite.onboardingTextPath ??
        `/api/invites/${invite.token}/onboarding.txt`;
      const absoluteUrl = onboardingTextLink.startsWith("http")
        ? onboardingTextLink
        : `${base}${onboardingTextLink}`;
      setSnippetCopied(false);
      setSnippetCopyDelightId(0);
      let snippet: string;
      try {
        const manifest = await accessApi.getInviteOnboarding(invite.token);
        snippet = buildAgentSnippet({
          onboardingTextUrl: absoluteUrl,
          connectionCandidates:
            manifest.onboarding.connectivity?.connectionCandidates ?? null,
          testResolutionUrl:
            manifest.onboarding.connectivity?.testResolutionEndpoint?.url ??
            null
        });
      } catch {
        snippet = buildAgentSnippet({
          onboardingTextUrl: absoluteUrl,
          connectionCandidates: null,
          testResolutionUrl: null
        });
      }
      setInviteSnippet(snippet);
      try {
        await navigator.clipboard.writeText(snippet);
        setSnippetCopied(true);
        setSnippetCopyDelightId((prev) => prev + 1);
        setTimeout(() => setSnippetCopied(false), 2000);
      } catch {
        /* clipboard may not be available */
      }
      queryClient.invalidateQueries({
        queryKey: queryKeys.sidebarBadges(selectedCompanyId!)
      });
    },
    onError: (err) => {
      setInviteError(
        err instanceof Error ? err.message : "Failed to create invite"
      );
    }
  });

  const syncLogoState = (nextLogoUrl: string | null) => {
    setLogoUrl(nextLogoUrl ?? "");
    void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
  };

  const logoUploadMutation = useMutation({
    mutationFn: (file: File) =>
      assetsApi
        .uploadCompanyLogo(selectedCompanyId!, file)
        .then((asset) => companiesApi.update(selectedCompanyId!, { logoAssetId: asset.assetId })),
    onSuccess: (company) => {
      syncLogoState(company.logoUrl);
      setLogoUploadError(null);
    }
  });

  const clearLogoMutation = useMutation({
    mutationFn: () => companiesApi.update(selectedCompanyId!, { logoAssetId: null }),
    onSuccess: (company) => {
      setLogoUploadError(null);
      syncLogoState(company.logoUrl);
    }
  });

  function handleLogoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;
    setLogoUploadError(null);
    logoUploadMutation.mutate(file);
  }

  function handleClearLogo() {
    clearLogoMutation.mutate();
  }

  useEffect(() => {
    setInviteError(null);
    setInviteSnippet(null);
    setSnippetCopied(false);
    setSnippetCopyDelightId(0);
  }, [selectedCompanyId]);

  const archiveMutation = useMutation({
    mutationFn: ({
      companyId,
      nextCompanyId
    }: {
      companyId: string;
      nextCompanyId: string | null;
    }) => companiesApi.archive(companyId).then(() => ({ nextCompanyId })),
    onSuccess: async ({ nextCompanyId }) => {
      if (nextCompanyId) {
        setSelectedCompanyId(nextCompanyId);
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.all
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.stats
      });
    }
  });

  const { data: companySecrets = [] } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.secrets.list(selectedCompanyId) : ["secrets", "none"],
    queryFn: () => secretsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const createSecretMutation = useMutation({
    mutationFn: (input: { name: string; value: string; description?: string | null }) =>
      secretsApi.create(selectedCompanyId!, input),
    onSuccess: () => {
      setNewSecretName("");
      setNewSecretValue("");
      setNewSecretDescription("");
      if (selectedCompanyId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.secrets.list(selectedCompanyId) });
      }
      pushToast({ title: "Secret created", tone: "success" });
    },
  });

  const deleteSecretMutation = useMutation({
    mutationFn: (secretId: string) => secretsApi.remove(secretId),
    onSuccess: () => {
      if (selectedCompanyId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.secrets.list(selectedCompanyId) });
      }
      pushToast({ title: "Secret deleted", tone: "success" });
    },
  });

  const transferOwnershipMutation = useMutation({
    mutationFn: (input: { targetMemberId: string; currentOwnerNextRole: string }) =>
      accessApi.transferOwnership(selectedCompanyId!, input),
    onSuccess: async () => {
      setOwnerTransferDialogOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.access.members(selectedCompanyId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(selectedCompanyId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.companies.all }),
      ]);
      pushToast({ title: "Ownership transferred successfully", tone: "success" });
    },
    onError: (err) => {
      pushToast({
        title: err instanceof Error ? err.message : "Failed to transfer ownership",
        tone: "error",
      });
    },
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Settings" }
    ]);
  }, [setBreadcrumbs, selectedCompany?.name]);

  if (!selectedCompany) {
    return (
      <div className="text-sm text-muted-foreground">
        No company selected. Select a company from the switcher above.
      </div>
    );
  }
  if (!canReadCompanySettings) {
    return (
      <div className="text-sm text-muted-foreground">
        Permission denied. You do not have access to Company Settings.
      </div>
    );
  }

  function handleSaveGeneral() {
    const payload: {
      name?: string;
      description?: string | null;
      brandColor?: string | null;
    } = {};
    if (canManageCompanySettingsGeneral) {
      payload.name = companyName.trim();
      payload.description = description.trim() || null;
    }
    if (canManageCompanySettingsAppearance) {
      payload.brandColor = brandColor || null;
    }
    if (Object.keys(payload).length === 0) return;
    generalMutation.mutate(payload);
  }

  const selectedNewOwnerMember =
    ownerTransferCandidates.find((member) => member.id === selectedNewOwnerMemberId) ?? null;
  const selectedNewOwnerLabel = selectedNewOwnerMember
    ? selectedNewOwnerMember.user?.name?.trim() ||
      selectedNewOwnerMember.user?.email ||
      selectedNewOwnerMember.principalId
    : "selected user";
  const ownerCandidateOptions = useMemo<InlineEntityOption[]>(
    () =>
      ownerTransferCandidates.map((member) => ({
        id: member.id,
        label: member.user?.name?.trim() || member.user?.email || member.principalId,
        searchText: `${member.user?.name ?? ""} ${member.user?.email ?? ""} ${member.principalId}`,
      })),
    [ownerTransferCandidates],
  );
  const ownerNextRoleOptions = useMemo<InlineEntityOption[]>(
    () =>
      ownerTransferRoleOptions.map((role) => ({
        id: role,
        label: role.charAt(0).toUpperCase() + role.slice(1),
      })),
    [ownerTransferRoleOptions],
  );

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Company Settings</h1>
      </div>

      {/* General */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          General
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <Field label="Company name" hint="The display name for your company.">
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={companyName}
              disabled={!canManageCompanySettingsGeneral}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </Field>
          <Field
            label="Description"
            hint="Optional description shown in the company profile."
          >
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={description}
              placeholder="Optional company description"
              disabled={!canManageCompanySettingsGeneral}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {/* Appearance */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Appearance
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <CompanyPatternIcon
                companyName={companyName || selectedCompany.name}
                logoUrl={logoUrl || null}
                brandColor={brandColor || null}
                className="rounded-[14px]"
              />
            </div>
            <div className="flex-1 space-y-3">
              <Field
                label="Logo"
                hint={
                  canManageCompanySettingsAppearance
                    ? "Upload a PNG, JPEG, WEBP, GIF, or SVG logo image."
                    : "Current logo for this company."
                }
              >
                {canManageCompanySettingsAppearance ? (
                  <div className="space-y-2">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                      onChange={handleLogoFileChange}
                      className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none file:mr-4 file:rounded-md file:border-0 file:bg-muted file:px-2.5 file:py-1 file:text-xs"
                    />
                    {logoUrl ? (
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleClearLogo}
                          disabled={clearLogoMutation.isPending}
                        >
                          {clearLogoMutation.isPending ? "Removing..." : "Remove logo"}
                        </Button>
                      </div>
                    ) : null}
                    {(logoUploadMutation.isError || logoUploadError) && (
                      <span className="text-xs text-destructive">
                        {logoUploadError ??
                          (logoUploadMutation.error instanceof Error
                            ? logoUploadMutation.error.message
                            : "Logo upload failed")}
                      </span>
                    )}
                    {clearLogoMutation.isError && (
                      <span className="text-xs text-destructive">
                        {clearLogoMutation.error.message}
                      </span>
                    )}
                    {logoUploadMutation.isPending && (
                      <span className="text-xs text-muted-foreground">Uploading logo...</span>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {logoUrl
                      ? "A custom logo is configured. The preview on the left reflects what the app uses."
                      : "No custom logo. The icon uses the generated pattern from the company name."}
                  </p>
                )}
              </Field>
              <Field
                label="Brand color"
                hint={
                  canManageCompanySettingsAppearance
                    ? "Sets the hue for the company icon. Leave empty for auto-generated color."
                    : "Brand color applied to the company icon."
                }
              >
                {canManageCompanySettingsAppearance ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={brandColor || "#6366f1"}
                      onChange={(e) => setBrandColor(e.target.value)}
                      className="h-8 w-8 cursor-pointer rounded border border-border bg-transparent p-0"
                    />
                    <input
                      type="text"
                      value={brandColor}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "" || /^#[0-9a-fA-F]{0,6}$/.test(v)) {
                          setBrandColor(v);
                        }
                      }}
                      placeholder="Auto"
                      className="w-28 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                    />
                    {brandColor ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setBrandColor("")}
                        className="text-xs text-muted-foreground"
                      >
                        Clear
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {brandColor ? (
                      <>
                        <span
                          className="h-7 w-7 shrink-0 rounded border border-border"
                          style={{ backgroundColor: brandColor }}
                          aria-hidden
                        />
                        <span className="font-mono text-foreground tabular-nums">{brandColor}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Auto (generated from company name)</span>
                    )}
                  </div>
                )}
              </Field>
            </div>
          </div>
        </div>
      </div>

      {/* Save button for General + Appearance */}
      {generalDirty && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSaveGeneral}
            disabled={
              generalMutation.isPending ||
              !companyName.trim() ||
              (!canManageCompanySettingsGeneral && !canManageCompanySettingsAppearance)
            }
          >
            {generalMutation.isPending ? "Saving..." : "Save changes"}
          </Button>
          {generalMutation.isSuccess && (
            <span className="text-xs text-muted-foreground">Saved</span>
          )}
          {generalMutation.isError && (
            <span className="text-xs text-destructive">
              {generalMutation.error instanceof Error
                  ? generalMutation.error.message
                  : "Failed to save"}
            </span>
          )}
        </div>
      )}

      {/* Hiring */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Secrets
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <p className="text-sm text-muted-foreground">
            Company-level secrets can be referenced by agents and project configuration.
          </p>
          <div className="grid gap-2">
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              placeholder="Secret name (e.g. github_pat)"
              value={newSecretName}
              onChange={(e) => setNewSecretName(e.target.value)}
            />
            <input
              type="password"
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              placeholder="Secret value"
              value={newSecretValue}
              onChange={(e) => setNewSecretValue(e.target.value)}
            />
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              placeholder="Description (optional)"
              value={newSecretDescription}
              onChange={(e) => setNewSecretDescription(e.target.value)}
            />
            <div>
              {canManageCompanySettingsSecrets ? (
                <Button
                  size="sm"
                  className="text-white hover:brightness-105 active:brightness-95 disabled:opacity-100"
                  style={{ backgroundColor: "#6569E1" }}
                  onClick={() =>
                    createSecretMutation.mutate({
                      name: newSecretName.trim(),
                      value: newSecretValue,
                      description: newSecretDescription.trim() || null,
                    })
                  }
                  disabled={
                    createSecretMutation.isPending ||
                    newSecretName.trim().length === 0 ||
                    newSecretValue.length === 0
                  }
                >
                  {createSecretMutation.isPending ? "Creating..." : "Create secret"}
                </Button>
              ) : null}
            </div>
            {createSecretMutation.isError && (
              <span className="text-xs text-destructive">
                {createSecretMutation.error instanceof Error
                  ? createSecretMutation.error.message
                  : "Failed to create secret"}
              </span>
            )}
          </div>

          <div className="space-y-2">
            {companySecrets.length === 0 ? (
              <p className="text-xs text-muted-foreground">No secrets yet.</p>
            ) : (
              companySecrets.map((secret) => (
                <div
                  key={secret.id}
                  className="flex items-center justify-between gap-3 rounded border border-border/70 px-2.5 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{secret.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {secret.description ?? "No description"}
                    </div>
                  </div>
                  {canManageCompanySettingsSecrets ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 text-destructive"
                      disabled={deleteSecretMutation.isPending}
                      onClick={() => {
                        const confirmed = window.confirm(`Delete secret "${secret.name}"?`);
                        if (!confirmed) return;
                        deleteSecretMutation.mutate(secret.id);
                      }}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Security & project access */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Security &amp; access
        </div>
        <div className="space-y-4 rounded-md border border-border px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30">
              <Shield className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 space-y-2">
              <div className="text-sm font-semibold text-foreground">Project-level permissions</div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">Open</span>, any active company member can open all
                projects (legacy behavior).{" "}
                <span className="font-medium text-foreground">Restricted</span>, each project has an explicit access
                matrix; configure grants under{" "}
                <span className="font-medium text-foreground">Project → Access control</span>. Requires the company
                permission <span className="font-mono text-xs">users:manage_permissions</span> to change this policy.
              </p>
            </div>
          </div>
          <Field
            label="Project access mode"
            hint={
              canManageCompanySettingsSecurityAccess
                ? "Applies to every project in this company. New projects still grant full access to their creator while restricted."
                : "Current policy for this company."
            }
          >
            {canManageCompanySettingsSecurityAccess ? (
              <select
                className="w-full max-w-md rounded-md border border-border bg-background px-2.5 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                value={projectAccessDraft}
                onChange={(e) => {
                  const nextMode = e.target.value as CompanyProjectAccessMode;
                  setProjectAccessDraft(nextMode);
                  if (!selectedCompanyId) return;
                  if (nextMode === (selectedCompany?.projectAccessMode ?? "open")) return;
                  projectAccessMutation.mutate(nextMode);
                }}
              >
                <option value="open">Open, all company members see all projects</option>
                <option value="restricted">Restricted, per-project grants required</option>
              </select>
            ) : (
              <p className="text-sm text-foreground">
                {(selectedCompany?.projectAccessMode ?? projectAccessDraft) === "restricted"
                  ? "Restricted, per-project grants are required."
                  : "Open, all company members see all projects."}
              </p>
            )}
          </Field>
          {projectAccessMutation.isPending ? (
            <span className="text-xs text-muted-foreground">Saving project access policy…</span>
          ) : null}
        </div>
      </div>

      {isCurrentUserOwner ? (
        <div className="space-y-4">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Ownership
          </div>
          <div className="space-y-3 rounded-md border border-border px-4 py-4">
            <p className="text-sm text-muted-foreground">
              Transfer ownership to another active member and choose your new role after transfer.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="New owner" hint="Choose who will become the Owner after confirmation.">
                <InlineEntitySelector
                  value={selectedNewOwnerMemberId}
                  options={ownerCandidateOptions}
                  placeholder="Select new owner"
                  noneLabel="No eligible members"
                  includeNoneOption={false}
                  searchPlaceholder="Search members..."
                  emptyMessage="No matching members."
                  onChange={setSelectedNewOwnerMemberId}
                  className="h-10 w-full justify-between rounded-md border-border/60 bg-background text-sm font-normal"
                />
              </Field>
              <Field label="Your role after transfer" hint="After transfer, your account will be reassigned to this role.">
                <InlineEntitySelector
                  value={selectedCurrentOwnerNextRole}
                  options={ownerNextRoleOptions}
                  placeholder="Select role"
                  noneLabel="No roles"
                  includeNoneOption={false}
                  searchPlaceholder="Search roles..."
                  emptyMessage="No roles found."
                  onChange={setSelectedCurrentOwnerNextRole}
                  className="h-10 w-full justify-between rounded-md border-border/60 bg-background text-sm font-normal"
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              Result: <span className="font-medium text-foreground">{selectedNewOwnerLabel}</span> becomes{" "}
              <span className="font-medium text-foreground">Owner</span>, and you become{" "}
              <span className="font-medium text-foreground">
                {selectedCurrentOwnerNextRole.charAt(0).toUpperCase() + selectedCurrentOwnerNextRole.slice(1)}
              </span>
              .
            </p>
            <div>
              <Button
                size="sm"
                variant="destructive"
                disabled={ownerTransferCandidates.length === 0 || !selectedNewOwnerMemberId}
                onClick={() => setOwnerTransferDialogOpen(true)}
              >
                Transfer ownership
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Hiring */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Hiring
        </div>
        <div className="rounded-md border border-border px-4 py-3">
          <ToggleField
            label="Require board approval for new hires"
            hint="New agent hires stay pending until approved by board."
            checked={!!selectedCompany.requireBoardApprovalForNewAgents}
            onChange={(v) => {
              if (!canManageCompanySettingsHiring) return;
              settingsMutation.mutate(v);
            }}
          />
        </div>
      </div>

      {/* Invites */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Invites
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">
              Generate an OpenClaw agent invite snippet.
            </span>
            <HintIcon text="Creates a short-lived OpenClaw agent invite and renders a copy-ready prompt." />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canManageCompanySettingsInvites ? (
              <Button
                size="sm"
                onClick={() => inviteMutation.mutate()}
                disabled={inviteMutation.isPending}
              >
                {inviteMutation.isPending
                  ? "Generating..."
                  : "Generate OpenClaw Invite Prompt"}
              </Button>
            ) : null}
          </div>
          {inviteError && (
            <p className="text-sm text-destructive">{inviteError}</p>
          )}
          {inviteSnippet && (
            <div className="rounded-md border border-border bg-muted/30 p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  OpenClaw Invite Prompt
                </div>
                {snippetCopied && (
                  <span
                    key={snippetCopyDelightId}
                    className="flex items-center gap-1 text-xs text-green-600 animate-pulse"
                  >
                    <Check className="h-3 w-3" />
                    Copied
                  </span>
                )}
              </div>
              <div className="mt-1 space-y-1.5">
                <textarea
                  className="h-[28rem] w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none"
                  value={inviteSnippet}
                  readOnly
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(inviteSnippet);
                        setSnippetCopied(true);
                        setSnippetCopyDelightId((prev) => prev + 1);
                        setTimeout(() => setSnippetCopied(false), 2000);
                      } catch {
                        /* clipboard may not be available */
                      }
                    }}
                  >
                    {snippetCopied ? "Copied snippet" : "Copy snippet"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Import / Export */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Company Packages
        </div>
        <div className="rounded-md border border-border px-4 py-4">
          <p className="text-sm text-muted-foreground">
            Import and export have moved to dedicated pages accessible from the{" "}
            <a href="/org" className="underline hover:text-foreground">Hybrid Org Chart</a> header.
          </p>
          <div className="mt-3 flex items-center gap-2">
            {canUseCompanyPackagesActions ? (
              <>
                <Button size="sm" variant="outline" asChild>
                  <a href="/company/export">
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    Export
                  </a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href="/company/import">
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    Import
                  </a>
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      {/*
      <div className="space-y-4">
        <div className="text-xs font-medium text-destructive uppercase tracking-wide">
          Danger Zone
        </div>
        <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-4">
          <p className="text-sm text-muted-foreground">
            Archive this company to hide it from the sidebar. This persists in
            the database.
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={
                archiveMutation.isPending ||
                selectedCompany.status === "archived"
              }
              onClick={() => {
                if (!selectedCompanyId) return;
                const confirmed = window.confirm(
                  `Archive company "${selectedCompany.name}"? It will be hidden from the sidebar.`
                );
                if (!confirmed) return;
                const nextCompanyId =
                  companies.find(
                    (company) =>
                      company.id !== selectedCompanyId &&
                      company.status !== "archived"
                  )?.id ?? null;
                archiveMutation.mutate({
                  companyId: selectedCompanyId,
                  nextCompanyId
                });
              }}
            >
              {archiveMutation.isPending
                ? "Archiving..."
                : selectedCompany.status === "archived"
                ? "Already archived"
                : "Archive company"}
            </Button>
            {archiveMutation.isError && (
              <span className="text-xs text-destructive">
                {archiveMutation.error instanceof Error
                  ? archiveMutation.error.message
                  : "Failed to archive company"}
              </span>
            )}
          </div>
        </div>
      </div>
      */}
      <Dialog open={ownerTransferDialogOpen} onOpenChange={setOwnerTransferDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm ownership transfer</DialogTitle>
            <DialogDescription>
              This action will make <span className="font-medium text-foreground">{selectedNewOwnerLabel}</span> the
              new Owner. Your role will change to{" "}
              <span className="font-medium text-foreground">
                {selectedCurrentOwnerNextRole.charAt(0).toUpperCase() + selectedCurrentOwnerNextRole.slice(1)}
              </span>
              .
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-amber-400/60 bg-amber-50/60 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-200">
            Warning: Ownership transfer changes company control immediately. Make sure the selected user is correct.
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOwnerTransferDialogOpen(false)}
              disabled={transferOwnershipMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!selectedNewOwnerMemberId || transferOwnershipMutation.isPending}
              onClick={() => {
                transferOwnershipMutation.mutate({
                  targetMemberId: selectedNewOwnerMemberId,
                  currentOwnerNextRole: selectedCurrentOwnerNextRole,
                });
              }}
            >
              {transferOwnershipMutation.isPending ? "Transferring..." : "Confirm transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function buildAgentSnippet(input: AgentSnippetInput) {
  const candidateUrls = buildCandidateOnboardingUrls(input);
  const resolutionTestUrl = buildResolutionTestUrl(input);

  const candidateList =
    candidateUrls.length > 0
      ? candidateUrls.map((u) => `- ${u}`).join("\n")
      : "- (No candidate URLs available yet.)";

  const connectivityBlock =
    candidateUrls.length === 0
      ? `No candidate URLs are available. Ask your user to configure a reachable hostname in Paperclip, then retry.
Suggested steps:
- choose a hostname that resolves to the Paperclip host from your runtime
- run: pnpm paperclipai allowed-hostname <host>
- restart Paperclip
- verify with: curl -fsS http://<host>:3100/api/health
- regenerate this invite snippet`
      : `If none are reachable, ask your user to add a reachable hostname in Paperclip, restart, and retry.
Suggested command:
- pnpm paperclipai allowed-hostname <host>
Then verify with: curl -fsS <base-url>/api/health`;

  const resolutionLine = resolutionTestUrl
    ? `\nYou MUST test Paperclip-to-gateway reachability, call: ${resolutionTestUrl}?url=<urlencoded-gateway-url> (using the hostname that worked above). Do not assume your 172.x is necessarily reachable from Paperclip. Test it. `
    : "";

  return `You're invited to join a Paperclip organization.

The URLs you should try are:
${candidateList}

Connectivity guidance:
If you are running on a different machine than Paperclip, Paperclip must be reachable at one of the hostnames used above.
Verify the hostname works from your runtime with: GET <base-url>/api/health

${connectivityBlock}

For your "agentName", just use your own agent name (OpenClaw or whatever your name is) and send it directly.
You also need to send a gateway URL that Paperclip can access. Check your config and include that URL.${resolutionLine}

---

This onboarding flow is for OpenClaw Gateway.
When you submit the join request, use:
- \`adapterType: "openclaw_gateway"\`
- \`agentDefaultsPayload.url\` as your \`ws://\` or \`wss://\` gateway URL
- \`agentDefaultsPayload.headers["x-openclaw-token"]\` with your gateway token
- (legacy accepted) \`agentDefaultsPayload.headers["x-openclaw-auth"]\`
- Keep device auth enabled (recommended). If \`devicePrivateKeyPem\` is omitted, Paperclip will generate and persist one during join so pairing approvals remain stable.
- Only use \`disableDeviceAuth=true\` for special environments where pairing cannot be completed.

Do NOT use \`/v1/responses\` or \`/hooks/*\` in this join flow.

Before you do anything, please respond to your user that you understand the instructions and you're going to work on them. Then do the step above in another session called "paperclip-onboarding" and then tell your user when you're done. Update your user in intermediate steps along the way so they know what's going on.

Then after you've connected to Paperclip (exchanged keys etc.) you MUST review and follow the onboarding instructions in onboarding.txt they give you.

`;
}

function buildCandidateOnboardingUrls(input: AgentSnippetInput): string[] {
  const candidates = (input.connectionCandidates ?? [])
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  const urls = new Set<string>();
  let onboardingUrl: URL | null = null;

  try {
    onboardingUrl = new URL(input.onboardingTextUrl);
    urls.add(onboardingUrl.toString());
  } catch {
    const trimmed = input.onboardingTextUrl.trim();
    if (trimmed) {
      urls.add(trimmed);
    }
  }

  if (!onboardingUrl) {
    for (const candidate of candidates) {
      urls.add(candidate);
    }
    return Array.from(urls);
  }

  const onboardingPath = `${onboardingUrl.pathname}${onboardingUrl.search}`;
  for (const candidate of candidates) {
    try {
      const base = new URL(candidate);
      urls.add(`${base.origin}${onboardingPath}`);
    } catch {
      urls.add(candidate);
    }
  }

  return Array.from(urls);
}

function buildResolutionTestUrl(input: AgentSnippetInput): string | null {
  const explicit = input.testResolutionUrl?.trim();
  if (explicit) return explicit;

  try {
    const onboardingUrl = new URL(input.onboardingTextUrl);
    const testPath = onboardingUrl.pathname.replace(
      /\/onboarding\.txt$/,
      "/test-resolution"
    );
    return `${onboardingUrl.origin}${testPath}`;
  } catch {
    return null;
  }
}
