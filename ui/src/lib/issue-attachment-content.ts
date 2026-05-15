/** Path pattern for issue attachment bytes (see server issue routes). */
const ISSUE_ATTACHMENT_CONTENT_PATH = /^\/api\/attachments\/[^/]+\/content$/;

function pathnameOf(src: string): string {
  const noHash = src.split("#")[0] ?? "";
  const noQuery = noHash.split("?")[0] ?? "";
  if (noQuery.startsWith("http://") || noQuery.startsWith("https://")) {
    try {
      return new URL(noQuery).pathname;
    } catch {
      return noQuery;
    }
  }
  return noQuery.startsWith("/") ? noQuery : `/${noQuery}`;
}

export function isIssueAttachmentContentUrl(src: string | undefined | null): boolean {
  if (!src) return false;
  return ISSUE_ATTACHMENT_CONTENT_PATH.test(pathnameOf(src));
}

/** Same-origin relative URLs use a query param; absolute URLs use URLSearchParams. */
export function issueAttachmentDownloadUrl(src: string): string {
  if (src.startsWith("http://") || src.startsWith("https://")) {
    const u = new URL(src);
    u.searchParams.set("download", "1");
    return u.toString();
  }
  const base = src.split("?")[0].split("#")[0];
  return `${base}?download=1`;
}
