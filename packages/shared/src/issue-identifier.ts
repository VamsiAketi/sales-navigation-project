/** Human-readable issue refs such as `PAP-39` or `PODIU3-2`. */
export const ISSUE_IDENTIFIER_RE = /^[A-Z0-9]+-\d+$/i;

export function isIssueIdentifierLike(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  return ISSUE_IDENTIFIER_RE.test(value.trim());
}
