import type { IssueAttachment } from "@paperclipai/shared";

/** Matches `/api/attachments/{uuid}/content` in markdown (relative or absolute URLs). */
const ATTACHMENT_CONTENT_ID_RE = /\/api\/attachments\/([a-f0-9-]{36})\/content/gi;

export function extractAttachmentIdsFromMarkdown(markdown: string | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!markdown) return ids;
  const re = new RegExp(ATTACHMENT_CONTENT_ID_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    if (m[1]) ids.add(m[1].toLowerCase());
  }
  return ids;
}

export type AttachmentOriginKind = "description" | "comment" | "issue_only";

export interface AttachmentOriginSummary {
  kind: AttachmentOriginKind;
  commentId?: string | null;
}

export function buildAttachmentOriginMap(
  description: string | null | undefined,
  comments: Array<{ id: string; body: string }> | null | undefined,
  attachments: IssueAttachment[] | null | undefined,
): Map<string, AttachmentOriginSummary> {
  const map = new Map<string, AttachmentOriginSummary>();
  for (const a of attachments ?? []) {
    map.set(a.id.toLowerCase(), { kind: "issue_only" });
  }
  for (const id of extractAttachmentIdsFromMarkdown(description)) {
    if (!map.has(id)) continue;
    map.set(id, { kind: "description" });
  }
  for (const c of comments ?? []) {
    for (const id of extractAttachmentIdsFromMarkdown(c.body)) {
      if (!map.has(id)) continue;
      map.set(id, { kind: "comment", commentId: c.id });
    }
  }
  return map;
}

export function resolveAttachmentsReferencedInMarkdown(
  markdown: string,
  attachments: IssueAttachment[],
): IssueAttachment[] {
  const order = [...extractAttachmentIdsFromMarkdown(markdown)];
  const byId = new Map(attachments.map((a) => [a.id.toLowerCase(), a]));
  const out: IssueAttachment[] = [];
  const seen = new Set<string>();
  for (const raw of order) {
    const att = byId.get(raw);
    if (!att || seen.has(att.id)) continue;
    seen.add(att.id);
    out.push(att);
  }
  return out;
}
