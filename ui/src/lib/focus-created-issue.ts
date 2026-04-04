const STORAGE_KEY = "paperclip:focusAfterIssueCreate";
const MAX_AGE_MS = 120_000;

export type FocusAfterIssueCreatePayload = {
  companyId: string;
  issueId: string;
  identifier: string | null;
  status: string;
  title?: string;
  createdAt: number;
};

export function setFocusAfterIssueCreate(
  companyId: string,
  payload: Omit<FocusAfterIssueCreatePayload, "companyId" | "createdAt">,
): void {
  try {
    const data: FocusAfterIssueCreatePayload = {
      companyId,
      ...payload,
      createdAt: Date.now(),
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore quota / private mode */
  }
}

export function readFocusAfterIssueCreate(): FocusAfterIssueCreatePayload | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<FocusAfterIssueCreatePayload>;
    if (typeof p.companyId !== "string" || typeof p.issueId !== "string" || typeof p.status !== "string") {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    const createdAt = typeof p.createdAt === "number" ? p.createdAt : 0;
    if (Date.now() - createdAt > MAX_AGE_MS) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return {
      companyId: p.companyId,
      issueId: p.issueId,
      identifier: typeof p.identifier === "string" ? p.identifier : null,
      status: p.status,
      title: typeof p.title === "string" ? p.title : undefined,
      createdAt,
    };
  } catch {
    return null;
  }
}

export function clearFocusAfterIssueCreate(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function issueRowGroupKey(issue: {
  status: string;
  priority: string;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
}): string {
  return (
    issue.assigneeAgentId ??
    (issue.assigneeUserId ? `__user:${issue.assigneeUserId}` : "__unassigned")
  );
}
