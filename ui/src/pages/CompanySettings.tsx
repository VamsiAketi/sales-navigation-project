import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { companiesApi } from "../api/companies";
import { accessApi, type CompanyMember } from "../api/access";
import { secretsApi } from "../api/secrets";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Settings, Check, EyeOff, Trash2 } from "lucide-react";
import { CompanyPatternIcon } from "../components/CompanyPatternIcon";
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
  const queryClient = useQueryClient();

  // General settings local state
  const [companyName, setCompanyName] = useState("");
  const [description, setDescription] = useState("");
  const [brandColor, setBrandColor] = useState("");

  // Sync local state from selected company
  useEffect(() => {
    if (!selectedCompany) return;
    setCompanyName(selectedCompany.name);
    setDescription(selectedCompany.description ?? "");
    setBrandColor(selectedCompany.brandColor ?? "");
  }, [selectedCompany]);

  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSnippet, setInviteSnippet] = useState<string | null>(null);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [snippetCopyDelightId, setSnippetCopyDelightId] = useState(0);
  const [humanInviteName, setHumanInviteName] = useState("");
  const [humanInviteEmail, setHumanInviteEmail] = useState("");
  const [humanInviteError, setHumanInviteError] = useState<string | null>(null);
  const [humanInviteCredentials, setHumanInviteCredentials] = useState<{
    name: string;
    email: string;
    temporaryUsername: string;
    temporaryPassword: string;
  } | null>(null);

  const [newSecretName, setNewSecretName] = useState("");
  const [newSecretValue, setNewSecretValue] = useState("");
  const [newSecretDescription, setNewSecretDescription] = useState("");

  const generalDirty =
    !!selectedCompany &&
    (companyName !== selectedCompany.name ||
      description !== (selectedCompany.description ?? "") ||
      brandColor !== (selectedCompany.brandColor ?? ""));

  const generalMutation = useMutation({
    mutationFn: (data: {
      name: string;
      description: string | null;
      brandColor: string | null;
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

  const humanInviteMutation = useMutation({
    mutationFn: () =>
      accessApi.createHumanInvite(selectedCompanyId!, {
        email: humanInviteEmail.trim(),
        name: humanInviteName.trim() || undefined
      }),
    onSuccess: async (created) => {
      setHumanInviteError(null);
      setHumanInviteCredentials({
        name: created.name,
        email: created.email,
        temporaryUsername: created.temporaryUsername,
        temporaryPassword: created.temporaryPassword
      });
      setHumanInviteName("");
      setHumanInviteEmail("");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sidebarBadges(selectedCompanyId!)
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.access.members(selectedCompanyId!)
      });
    },
    onError: (err) => {
      setHumanInviteCredentials(null);
      setHumanInviteError(
        err instanceof Error ? err.message : "Failed to create human invite"
      );
    }
  });

  useEffect(() => {
    setInviteError(null);
    setInviteSnippet(null);
    setSnippetCopied(false);
    setSnippetCopyDelightId(0);
    setHumanInviteError(null);
    setHumanInviteCredentials(null);
    setHumanInviteName("");
    setHumanInviteEmail("");
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

  const { data: companySecrets = [], isLoading: secretsLoading } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.secrets.list(selectedCompanyId) : ["secrets", "none"],
    queryFn: () => secretsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId
  });

  const { data: companyMembers = [], isLoading: membersLoading } = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.access.members(selectedCompanyId)
      : ["access", "members", "none"],
    queryFn: () => accessApi.listMembers(selectedCompanyId!),
    enabled: !!selectedCompanyId
  });

  const activeHumanMembers = companyMembers.filter(
    (member: CompanyMember) =>
      member.principalType === "user" && member.status === "active"
  );

  const createSecretMutation = useMutation({
    mutationFn: () =>
      secretsApi.create(selectedCompanyId!, {
        name: newSecretName.trim(),
        value: newSecretValue,
        description: newSecretDescription.trim() || null
      }),
    onSuccess: async () => {
      setNewSecretName("");
      setNewSecretValue("");
      setNewSecretDescription("");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.secrets.list(selectedCompanyId!)
      });
    }
  });

  const deleteSecretMutation = useMutation({
    mutationFn: (secretId: string) => secretsApi.remove(secretId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.secrets.list(selectedCompanyId!)
      });
    }
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

  function handleSaveGeneral() {
    generalMutation.mutate({
      name: companyName.trim(),
      description: description.trim() || null,
      brandColor: brandColor || null
    });
  }

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
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {/* Secrets */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Secrets
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <p className="text-xs text-muted-foreground">
            Company secrets are encrypted values (API keys, tokens, credentials) that can be
            referenced from agents and projects. Values are write-only and never shown after
            creation.
          </p>

          {/* New secret form */}
          <div className="space-y-2 rounded-md border border-border/60 bg-muted/10 px-3 py-3">
            <div className="flex flex-col gap-2 md:flex-row">
              <div className="flex-1 space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground">
                  Name
                </label>
                <input
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none"
                  placeholder="github_repo_pat"
                  value={newSecretName}
                  onChange={(e) => setNewSecretName(e.target.value)}
                />
              </div>
              <div className="flex-[2] space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                  Value
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    <EyeOff className="h-3 w-3" />
                    Hidden after save
                  </span>
                </label>
                <input
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none font-mono"
                  type="password"
                  placeholder="Paste token or secret value"
                  value={newSecretValue}
                  onChange={(e) => setNewSecretValue(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">
                Description (optional)
              </label>
              <input
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none"
                placeholder="What is this secret used for?"
                value={newSecretDescription}
                onChange={(e) => setNewSecretDescription(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => createSecretMutation.mutate()}
                disabled={
                  !newSecretName.trim() ||
                  !newSecretValue ||
                  createSecretMutation.isPending ||
                  !selectedCompanyId
                }
              >
                {createSecretMutation.isPending ? "Creating..." : "Create secret"}
              </Button>
              {createSecretMutation.isError && (
                <span className="text-xs text-destructive">
                  {createSecretMutation.error instanceof Error
                    ? createSecretMutation.error.message
                    : "Failed to create secret"}
                </span>
              )}
            </div>
          </div>

          {/* Existing secrets list */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Existing secrets
              </span>
              {secretsLoading && (
                <span className="text-[11px] text-muted-foreground">Loading…</span>
              )}
            </div>
            {companySecrets.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No secrets created yet. Use the form above to add one.
              </p>
            ) : (
              <div className="max-h-60 space-y-1 overflow-y-auto rounded-md border border-border/60 bg-muted/5 p-1">
                {companySecrets.map((secret) => (
                  <div
                    key={secret.id}
                    className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent/40"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono truncate">{secret.name}</span>
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {secret.provider}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground/80">
                        {secret.description || "No description"}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        const confirmed = window.confirm(
                          `Delete secret "${secret.name}"? This cannot be undone and may break adapters or projects that reference it.`,
                        );
                        if (!confirmed) return;
                        deleteSecretMutation.mutate(secret.id);
                      }}
                      aria-label={`Delete secret ${secret.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
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
                brandColor={brandColor || null}
                className="rounded-[14px]"
              />
            </div>
            <div className="flex-1 space-y-2">
              <Field
                label="Brand color"
                hint="Sets the hue for the company icon. Leave empty for auto-generated color."
              >
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
                  {brandColor && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setBrandColor("")}
                      className="text-xs text-muted-foreground"
                    >
                      Clear
                    </Button>
                  )}
                </div>
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
            disabled={generalMutation.isPending || !companyName.trim()}
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
          Hiring
        </div>
        <div className="rounded-md border border-border px-4 py-3">
          <ToggleField
            label="Require board approval for new hires"
            hint="New agent hires stay pending until approved by board."
            checked={!!selectedCompany.requireBoardApprovalForNewAgents}
            onChange={(v) => settingsMutation.mutate(v)}
          />
        </div>
      </div>

      {/* Invites */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Invites
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <div className="space-y-2 rounded-md border border-border/60 bg-muted/10 px-3 py-3">
            <div className="text-xs font-medium text-muted-foreground">
              Invite human user
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <input
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none"
                type="text"
                placeholder="Name (optional)"
                value={humanInviteName}
                onChange={(e) => setHumanInviteName(e.target.value)}
              />
              <input
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none"
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
                  humanInviteMutation.isPending ||
                  !humanInviteEmail.trim() ||
                  !selectedCompanyId
                }
              >
                {humanInviteMutation.isPending
                  ? "Creating..."
                  : "Create Human Invite"}
              </Button>
              {humanInviteError && (
                <span className="text-xs text-destructive">
                  {humanInviteError}
                </span>
              )}
            </div>
            {humanInviteCredentials && (
              <div className="space-y-1 rounded-md border border-border bg-background px-2.5 py-2 text-xs">
                <p className="font-medium text-foreground">
                  Temporary credentials (share securely)
                </p>
                <p>
                  Name:{" "}
                  <span className="font-mono">{humanInviteCredentials.name}</span>
                </p>
                <p>
                  Email:{" "}
                  <span className="font-mono">{humanInviteCredentials.email}</span>
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
                        `Password: ${humanInviteCredentials.temporaryPassword}`
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
            <div className="rounded-md border border-border bg-background px-2.5 py-2 text-xs">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-medium text-foreground">Active users</p>
                <span className="text-muted-foreground">
                  {membersLoading ? "Loading..." : `${activeHumanMembers.length}`}
                </span>
              </div>
              {!membersLoading && activeHumanMembers.length === 0 && (
                <p className="text-muted-foreground">
                  No active human users yet.
                </p>
              )}
              {activeHumanMembers.length > 0 && (
                <div className="space-y-1">
                  {activeHumanMembers.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between gap-2 rounded border border-border/70 px-2 py-1"
                    >
                      <span className="font-mono">
                        {member.user?.name || member.user?.email || member.principalId}
                      </span>
                      <span className="text-muted-foreground">
                        {member.user?.email ?? "unknown email"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">
              Generate an OpenClaw agent invite snippet.
            </span>
            <HintIcon text="Creates a short-lived OpenClaw agent invite and renders a copy-ready prompt." />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => inviteMutation.mutate()}
              disabled={inviteMutation.isPending}
            >
              {inviteMutation.isPending
                ? "Generating..."
                : "Generate OpenClaw Invite Prompt"}
            </Button>
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

      {/* Danger Zone */}
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
