/**
 * Human-invite → org-line bootstrap (Managers without users:manage_permissions).
 *
 * After POST /human-invites succeeds, the UI PATCHes org-config to set membershipRole
 * and reportsToMembershipId. That would otherwise require users:manage_permissions only,
 * which Managers lack — causing 403 and a global permission-denied toast despite a
 * successful invite. This gate defines when users:invite is sufficient instead.
 *
 * **Product contract:** keep this behavior unless invite + org UX is redesigned together.
 * Do not drop without an alternative for inviters who cannot manage all permissions.
 */
export const MEMBER_INVITE_ORG_BOOTSTRAP_MAX_AGE_MS = 30 * 60 * 1000;

export type InviteOrgBootstrapInput = {
  needsOrgPower: boolean;
  canManageOrgConfig: boolean;
  canInviteHumans: boolean;
  managerTargetsUpdateRequested: boolean;
  memberPrincipalType: string;
  membershipCreatedAt: Date;
  nowMs: number;
  hasMustChangePasswordRole: boolean;
};

export function mayApplyInviteOrgBootstrapPower(input: InviteOrgBootstrapInput): boolean {
  if (!input.needsOrgPower) return false;
  if (input.canManageOrgConfig) return false;
  if (!input.canInviteHumans) return false;
  if (input.memberPrincipalType !== "user") return false;
  if (input.managerTargetsUpdateRequested) return false;

  const created = input.membershipCreatedAt;
  if (!Number.isFinite(created.getTime())) return false;
  if (input.nowMs - created.getTime() > MEMBER_INVITE_ORG_BOOTSTRAP_MAX_AGE_MS) return false;

  return input.hasMustChangePasswordRole;
}
