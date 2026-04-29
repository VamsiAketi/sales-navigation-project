import type {
  AgentAdapterType,
  JoinRequest,
  PermissionKey,
  PrincipalType,
  ProjectPermissionKey,
  ProjectPrincipalGrant,
} from "@paperclipai/shared";
import { api } from "./client";

type InviteSummary = {
  id: string;
  companyId: string | null;
  companyName?: string | null;
  inviteType: "company_join" | "bootstrap_ceo";
  allowedJoinTypes: "human" | "agent" | "both";
  expiresAt: string;
  onboardingPath?: string;
  onboardingUrl?: string;
  onboardingTextPath?: string;
  onboardingTextUrl?: string;
  skillIndexPath?: string;
  skillIndexUrl?: string;
  inviteMessage?: string | null;
};

type AcceptInviteInput =
  | { requestType: "human" }
  | {
    requestType: "agent";
    agentName: string;
    adapterType?: AgentAdapterType;
    capabilities?: string | null;
    agentDefaultsPayload?: Record<string, unknown> | null;
  };

type AgentJoinRequestAccepted = JoinRequest & {
  claimSecret: string;
  claimApiKeyPath: string;
  onboarding?: Record<string, unknown>;
  diagnostics?: Array<{
    code: string;
    level: "info" | "warn";
    message: string;
    hint?: string;
  }>;
};

type InviteOnboardingManifest = {
  invite: InviteSummary;
  onboarding: {
    inviteMessage?: string | null;
    connectivity?: {
      guidance?: string;
      connectionCandidates?: string[];
      testResolutionEndpoint?: {
        method?: string;
        path?: string;
        url?: string;
      };
    };
    textInstructions?: {
      url?: string;
    };
  };
};

type BoardClaimStatus = {
  status: "available" | "claimed" | "expired";
  requiresSignIn: boolean;
  expiresAt: string | null;
  claimedByUserId: string | null;
};

type CliAuthChallengeStatus = {
  id: string;
  status: "pending" | "approved" | "cancelled" | "expired";
  command: string;
  clientName: string | null;
  requestedAccess: "board" | "instance_admin_required";
  requestedCompanyId: string | null;
  requestedCompanyName: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  expiresAt: string;
  approvedByUser: { id: string; name: string; email: string } | null;
  requiresSignIn: boolean;
  canApprove: boolean;
  currentUserId: string | null;
};

type CompanyInviteCreated = {
  id: string;
  token: string;
  inviteUrl: string;
  expiresAt: string;
  allowedJoinTypes: "human" | "agent" | "both";
  companyName?: string | null;
  onboardingTextPath?: string;
  onboardingTextUrl?: string;
  inviteMessage?: string | null;
};

type HumanInviteCreated = {
  userId: string;
  email: string;
  name: string;
  temporaryUsername: string;
  temporaryPassword: string;
  emailDelivery?: {
    status: "sent" | "skipped" | "failed";
    message: string;
  };
};

export type CompanyMember = {
  id: string;
  companyId: string;
  principalType: "agent" | "user";
  principalId: string;
  status: "pending" | "active" | "suspended";
  membershipRole: string | null;
  membershipRoleLabel?: string | null;
  title: string | null;
  reportsToMembershipId: string | null;
  createdAt: string;
  updatedAt: string;
  grants: Array<{
    permissionKey: PermissionKey;
    scope: Record<string, unknown> | null;
  }>;
  user: { id: string; name: string; email: string; image?: string | null } | null;
  agent: { id: string; name: string; role: string } | null;
};

export const accessApi = {
  createCompanyInvite: (
    companyId: string,
    input: {
      allowedJoinTypes?: "human" | "agent" | "both";
      defaultsPayload?: Record<string, unknown> | null;
      agentMessage?: string | null;
    } = {},
  ) =>
    api.post<CompanyInviteCreated>(`/companies/${companyId}/invites`, input),

  createOpenClawInvitePrompt: (
    companyId: string,
    input: {
      agentMessage?: string | null;
    } = {},
  ) =>
    api.post<CompanyInviteCreated>(
      `/companies/${companyId}/openclaw/invite-prompt`,
      input,
    ),

  createHumanInvite: (
    companyId: string,
    input: {
      email: string;
      name?: string;
      grants?: Array<{ permissionKey: PermissionKey; scope: Record<string, unknown> | null }>;
    },
  ) =>
    api.post<HumanInviteCreated>(
      `/companies/${companyId}/human-invites`,
      input,
    ),

  listMembers: (companyId: string) =>
    api.get<CompanyMember[]>(`/companies/${companyId}/members`),

  patchMemberProfilePhoto: (companyId: string, memberId: string, assetId: string) =>
    api.patch<{ ok: true; image: string }>(
      `/companies/${companyId}/members/${encodeURIComponent(memberId)}/profile-photo`,
      { assetId },
    ),

  updateMemberOrgConfig: (
    companyId: string,
    memberId: string,
    input: {
      membershipRole?: string | null;
      title?: string | null;
      reportsToMembershipId?: string | null;
      managedAgentMemberIds?: string[];
    },
  ) =>
    api.patch<CompanyMember>(
      `/companies/${companyId}/members/${encodeURIComponent(memberId)}/org-config`,
      input,
    ),

  updateMemberStatus: (
    companyId: string,
    memberId: string,
    status: "active" | "suspended",
  ) =>
    api.patch<CompanyMember>(
      `/companies/${companyId}/members/${encodeURIComponent(memberId)}/status`,
      { status },
    ),

  updateMemberPermissions: (
    companyId: string,
    memberId: string,
    grants: Array<{ permissionKey: PermissionKey; scope: Record<string, unknown> | null }>,
  ) =>
    api.patch<CompanyMember>(
      `/companies/${companyId}/members/${encodeURIComponent(memberId)}/permissions`,
      { grants },
    ),

  /**
   * Omit body or pass `{}` for a random invite-style password. Pass `{ newPassword }` to set explicitly.
   */
  setMemberPassword: (
    companyId: string,
    memberId: string,
    body?: { newPassword?: string },
  ) =>
    api.post<{ ok: true; temporaryPassword?: string }>(
      `/companies/${companyId}/members/${encodeURIComponent(memberId)}/set-password`,
      body ?? {},
    ),

  removeMember: (companyId: string, memberId: string) =>
    api.delete<CompanyMember>(
      `/companies/${companyId}/members/${encodeURIComponent(memberId)}`,
    ),

  getInvite: (token: string) => api.get<InviteSummary>(`/invites/${token}`),
  getInviteOnboarding: (token: string) =>
    api.get<InviteOnboardingManifest>(`/invites/${token}/onboarding`),

  acceptInvite: (token: string, input: AcceptInviteInput) =>
    api.post<AgentJoinRequestAccepted | JoinRequest | { bootstrapAccepted: true; userId: string }>(
      `/invites/${token}/accept`,
      input,
    ),

  listJoinRequests: (companyId: string, status: "pending_approval" | "approved" | "rejected" = "pending_approval") =>
    api.get<JoinRequest[]>(`/companies/${companyId}/join-requests?status=${status}`),

  approveJoinRequest: (companyId: string, requestId: string) =>
    api.post<JoinRequest>(`/companies/${companyId}/join-requests/${requestId}/approve`, {}),

  rejectJoinRequest: (companyId: string, requestId: string) =>
    api.post<JoinRequest>(`/companies/${companyId}/join-requests/${requestId}/reject`, {}),

  claimJoinRequestApiKey: (requestId: string, claimSecret: string) =>
    api.post<{ keyId: string; token: string; agentId: string; createdAt: string }>(
      `/join-requests/${requestId}/claim-api-key`,
      { claimSecret },
    ),

  getBoardClaimStatus: (token: string, code: string) =>
    api.get<BoardClaimStatus>(`/board-claim/${token}?code=${encodeURIComponent(code)}`),

  claimBoard: (token: string, code: string) =>
    api.post<{ claimed: true; userId: string }>(`/board-claim/${token}/claim`, { code }),

  getCliAuthChallenge: (id: string, token: string) =>
    api.get<CliAuthChallengeStatus>(`/cli-auth/challenges/${id}?token=${encodeURIComponent(token)}`),

  approveCliAuthChallenge: (id: string, token: string) =>
    api.post<{ approved: boolean; status: string; userId: string; keyId: string | null; expiresAt: string }>(
      `/cli-auth/challenges/${id}/approve`,
      { token },
    ),

  cancelCliAuthChallenge: (id: string, token: string) =>
    api.post<{ cancelled: boolean; status: string }>(`/cli-auth/challenges/${id}/cancel`, { token }),

  listProjectPrincipalGrants: (companyId: string, projectId: string) =>
    api.get<ProjectPrincipalGrant[]>(
      `/companies/${companyId}/projects/${encodeURIComponent(projectId)}/principal-permissions`,
    ),

  updateProjectPrincipalGrants: (
    companyId: string,
    projectId: string,
    input: {
      principalType: PrincipalType;
      principalId: string;
      permissionKeys: ProjectPermissionKey[];
    },
  ) =>
    api.patch<{ ok: true }>(
      `/companies/${companyId}/projects/${encodeURIComponent(projectId)}/principal-permissions`,
      input,
    ),
};
