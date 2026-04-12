import type { ComponentProps } from "react";
import { Link, useLocation } from "@/lib/router";
import { createIssueDetailPath, mergeIssueModalLocationState } from "@/lib/issueDetailBreadcrumb";

type Props = Omit<ComponentProps<typeof Link>, "to" | "state"> & {
  issuePathId: string;
  issueLinkState?: unknown;
};

/** Navigates to issue detail using the same modal overlay as the board (`IssueDetailModal`). */
export function IssueLink({ issuePathId, issueLinkState, ...props }: Props) {
  const location = useLocation();
  const to = createIssueDetailPath(issuePathId, issueLinkState);
  const state = mergeIssueModalLocationState(issueLinkState, location);
  return <Link to={to} state={state} {...props} />;
}
