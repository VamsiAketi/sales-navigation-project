import { describe, expect, it } from "vitest";
import {
  buildAttachmentOriginMap,
  extractAttachmentIdsFromMarkdown,
  resolveAttachmentsReferencedInMarkdown,
} from "./issue-attachment-markdown-refs";
import type { IssueAttachment } from "@paperclipai/shared";

function mockAttachment(id: string, overrides: Partial<IssueAttachment> = {}): IssueAttachment {
  const now = new Date();
  return {
    id,
    companyId: "c1",
    issueId: "i1",
    issueCommentId: null,
    assetId: "a1",
    provider: "local",
    objectKey: "k",
    contentType: "image/png",
    byteSize: 1,
    sha256: "x",
    originalFilename: "x.png",
    createdByAgentId: null,
    createdByUserId: null,
    createdAt: now,
    updatedAt: now,
    contentPath: `/api/attachments/${id}/content`,
    ...overrides,
  };
}

describe("extractAttachmentIdsFromMarkdown", () => {
  it("collects ids from image and link markdown", () => {
    const md = "![](/api/attachments/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/content) and [x](/api/attachments/11111111-2222-3333-4444-555555555555/content?q=1)";
    const ids = extractAttachmentIdsFromMarkdown(md);
    expect(ids.size).toBe(2);
    expect(ids.has("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBe(true);
    expect(ids.has("11111111-2222-3333-4444-555555555555")).toBe(true);
  });

  it("returns empty set for empty input", () => {
    expect(extractAttachmentIdsFromMarkdown("").size).toBe(0);
    expect(extractAttachmentIdsFromMarkdown(undefined).size).toBe(0);
  });
});

describe("buildAttachmentOriginMap", () => {
  it("prefers comment over description when both reference the same attachment", () => {
    const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const att = mockAttachment(id);
    const map = buildAttachmentOriginMap(
      `![](/api/attachments/${id}/content)`,
      [{ id: "c1", body: `[](/api/attachments/${id}/content)` }],
      [att],
    );
    expect(map.get(id.toLowerCase())).toEqual({ kind: "comment", commentId: "c1" });
  });

  it("marks issue_only when not referenced in markdown", () => {
    const id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const map = buildAttachmentOriginMap("hello", [], [mockAttachment(id)]);
    expect(map.get(id.toLowerCase())).toEqual({ kind: "issue_only" });
  });
});

describe("resolveAttachmentsReferencedInMarkdown", () => {
  it("preserves first-seen order and dedupes", () => {
    const a = mockAttachment("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    const b = mockAttachment("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    const md = `![](${a.contentPath}) then ![](${b.contentPath}) again ![](${a.contentPath})`;
    expect(resolveAttachmentsReferencedInMarkdown(md, [a, b])).toEqual([a, b]);
  });
});
