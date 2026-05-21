export interface AssigneeSelection {
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
}

export interface AssigneeOption {
  id: string;
  label: string;
  searchText?: string;
}

interface CommentAssigneeSuggestionInput {
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
}

interface CommentAssigneeSuggestionComment {
  authorAgentId?: string | null;
  authorUserId?: string | null;
}

export function assigneeValueFromSelection(selection: Partial<AssigneeSelection>): string {
  if (selection.assigneeAgentId) return `agent:${selection.assigneeAgentId}`;
  if (selection.assigneeUserId) return `user:${selection.assigneeUserId}`;
  return "";
}

export function suggestedCommentAssigneeValue(
  issue: CommentAssigneeSuggestionInput,
  comments: CommentAssigneeSuggestionComment[] | null | undefined,
  currentUserId: string | null | undefined,
  currentAgentId?: string | null | undefined,
): string {
  if (comments && comments.length > 0 && (currentUserId || currentAgentId)) {
    for (let i = comments.length - 1; i >= 0; i--) {
      const comment = comments[i];
      if (comment.authorAgentId && comment.authorAgentId !== currentAgentId) {
        return assigneeValueFromSelection({ assigneeAgentId: comment.authorAgentId });
      }
      if (comment.authorUserId && comment.authorUserId !== currentUserId) {
        return assigneeValueFromSelection({ assigneeUserId: comment.authorUserId });
      }
    }
  }

  return assigneeValueFromSelection(issue);
}

export function parseAssigneeValue(value: string): AssigneeSelection {
  if (!value) {
    return { assigneeAgentId: null, assigneeUserId: null };
  }
  if (value.startsWith("agent:")) {
    const assigneeAgentId = value.slice("agent:".length);
    return { assigneeAgentId: assigneeAgentId || null, assigneeUserId: null };
  }
  if (value.startsWith("user:")) {
    const assigneeUserId = value.slice("user:".length);
    return { assigneeAgentId: null, assigneeUserId: assigneeUserId || null };
  }
  // Backward compatibility for older drafts/defaults that stored a raw agent id.
  return { assigneeAgentId: value, assigneeUserId: null };
}

/** Humans in assignee/mention pickers: signed-in user first, then others A–Z. */
export function sortHumanMembersForPicker<T extends { id: string; name: string }>(
  members: readonly T[],
  currentUserId: string | null | undefined,
): T[] {
  const cur = currentUserId;
  return [...members].sort((a, b) => {
    if (cur) {
      const aSelf = a.id === cur;
      const bSelf = b.id === cur;
      if (aSelf !== bSelf) return aSelf ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

export function currentUserAssigneeOption(
  currentUserId: string | null | undefined,
  display?: { name?: string | null; email?: string | null },
): AssigneeOption[] {
  if (!currentUserId) return [];
  const label =
    (display?.name && display.name.trim()) ||
    (display?.email && display.email.trim()) ||
    (currentUserId === "local-board" ? "Board" : currentUserId.slice(0, 8));
  const searchParts = [label, display?.name, display?.email, currentUserId].filter(
    (p): p is string => Boolean(p && String(p).trim()),
  );
  return [{
    id: assigneeValueFromSelection({ assigneeUserId: currentUserId }),
    label,
    searchText: searchParts.join(" "),
  }];
}

export function formatAssigneeUserLabel(
  userId: string | null | undefined,
  currentUserId: string | null | undefined,
  options?: { currentUserDisplayName?: string | null },
): string | null {
  if (!userId) return null;
  if (userId === "local-board") return "Board";
  if (currentUserId && userId === currentUserId) {
    const n = options?.currentUserDisplayName?.trim();
    if (n) return n;
    return userId.slice(0, 5);
  }
  return userId.slice(0, 5);
}
