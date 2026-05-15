import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PermissionKey } from "@paperclipai/shared";
import { accessApi, type CompanyMember } from "../api/access";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";

function activeHumanMember(
  members: CompanyMember[] | undefined,
  userId: string | null,
): CompanyMember | null {
  if (!userId || !members) return null;
  return (
    members.find(
      (member) =>
        member.principalType === "user" &&
        member.principalId === userId &&
        (member.status === "active" || member.status === "suspended"),
    ) ?? null
  );
}

/** Resolved company grants for the signed-in human; grants override org role labels (e.g. Reader). */
export function useCurrentUserCompanyPermissions(companyId: string | null | undefined) {
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: authApi.getSession,
    staleTime: 10_000,
  });
  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;

  const membersQuery = useQuery({
    queryKey: companyId ? queryKeys.access.members(companyId) : ["access", "members", "none"],
    queryFn: () => accessApi.listMembers(companyId!),
    enabled: Boolean(companyId),
    staleTime: 15_000,
  });

  const currentUserMember = useMemo(
    () => activeHumanMember(membersQuery.data, currentUserId),
    [membersQuery.data, currentUserId],
  );

  const permissionSet = useMemo(
    () =>
      new Set(
        (currentUserMember?.grants ?? []).map((grant) => grant.permissionKey as PermissionKey),
      ),
    [currentUserMember?.grants],
  );

  function hasPermission(key: PermissionKey): boolean {
    return permissionSet.has(key);
  }

  const canEditAgents =
    hasPermission("agents.edit") || hasPermission("agents:create");
  const canAssignTasks =
    hasPermission("tasks:assign") || hasPermission("tasks.create");
  const canManageUserPermissions = hasPermission("users:manage_permissions");
  const canMutateAttentionQueue = canEditAgents || canAssignTasks;

  return {
    currentUserId,
    currentUserMember,
    permissionSet,
    hasPermission,
    canEditAgents,
    canAssignTasks,
    canManageUserPermissions,
    canMutateAttentionQueue,
    membersQuery,
  };
}
