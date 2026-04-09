type IssueDetailBreadcrumb = {
  label: string;
  href: string;
};

type IssueDetailLocationState = {
  issueDetailBreadcrumb?: IssueDetailBreadcrumb;
  issueDetailBreadcrumbs?: IssueDetailBreadcrumb[];
  issueSource?: string;
  armInboxQuickArchive?: boolean;
};

function isIssueDetailBreadcrumb(value: unknown): value is IssueDetailBreadcrumb {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<IssueDetailBreadcrumb>;
  return typeof candidate.label === "string" && typeof candidate.href === "string";
}

function labelForSource(source: string | null): string | null {
  if (!source) return null;
  if (source === "inbox") return "Inbox";
  if (source === "issues") return "Issues";
  return source.charAt(0).toUpperCase() + source.slice(1);
}

function readSourceFromSearch(search: string | null | undefined): { source: string | null; fromHref: string | null } {
  const params = new URLSearchParams(search ?? "");
  const source = params.get("from");
  const fromHref = params.get("fromHref");
  return {
    source: source && source.trim().length > 0 ? source.trim() : null,
    fromHref: fromHref && fromHref.trim().length > 0 ? fromHref : null,
  };
}

export function createIssueDetailLocationState(
  label: string,
  href: string,
  source?: string,
): IssueDetailLocationState {
  return {
    issueDetailBreadcrumb: { label, href },
    ...(source ? { issueSource: source } : {}),
  };
}

export function readIssueDetailBreadcrumb(
  state: unknown,
  search?: string | null,
): IssueDetailBreadcrumb | null {
  if (typeof state === "object" && state !== null) {
    const candidate = (state as IssueDetailLocationState).issueDetailBreadcrumb;
    if (isIssueDetailBreadcrumb(candidate)) return candidate;
  }
  const { source, fromHref } = readSourceFromSearch(search);
  const label = labelForSource(source);
  if (!label) return null;
  return {
    label,
    href: fromHref ?? `/${source}`,
  };
}

export function createIssueDetailBreadcrumbChain(crumbs: { label: string; href: string }[]): IssueDetailLocationState {
  return { issueDetailBreadcrumbs: crumbs };
}

export function readIssueDetailBreadcrumbChain(state: unknown): IssueDetailBreadcrumb[] | null {
  if (typeof state !== "object" || state === null) return null;
  const candidate = (state as IssueDetailLocationState).issueDetailBreadcrumbs;
  if (!Array.isArray(candidate) || candidate.length === 0) return null;
  return candidate.every(isIssueDetailBreadcrumb) ? candidate : null;
}

export function createIssueDetailPath(
  issuePathId: string,
  state?: unknown,
  search?: string | null,
): string {
  const params = new URLSearchParams();
  const typedState = typeof state === "object" && state !== null ? (state as IssueDetailLocationState) : null;
  const stateSource =
    typedState?.issueSource && typedState.issueSource.trim().length > 0 ? typedState.issueSource.trim() : null;
  const stateHref = isIssueDetailBreadcrumb(typedState?.issueDetailBreadcrumb ?? null)
    ? typedState?.issueDetailBreadcrumb?.href ?? null
    : null;
  const searchSource = readSourceFromSearch(search).source;
  const searchHref = readSourceFromSearch(search).fromHref;
  const source = stateSource ?? searchSource;
  const fromHref = stateHref ?? searchHref;
  if (source) params.set("from", source);
  if (fromHref) params.set("fromHref", fromHref);
  const query = params.toString();
  return query.length > 0 ? `/issues/${issuePathId}?${query}` : `/issues/${issuePathId}`;
}

export function armIssueDetailInboxQuickArchive(state: unknown): IssueDetailLocationState {
  const typedState = typeof state === "object" && state !== null ? (state as IssueDetailLocationState) : {};
  return {
    ...typedState,
    armInboxQuickArchive: true,
  };
}

export function shouldArmIssueDetailInboxQuickArchive(state: unknown): boolean {
  if (typeof state !== "object" || state === null) return false;
  return (state as IssueDetailLocationState).armInboxQuickArchive === true;
}
