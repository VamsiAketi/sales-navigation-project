// @vitest-environment node

import { describe, expect, it } from "vitest";
import { isIssueAttachmentContentUrl, issueAttachmentDownloadUrl } from "./issue-attachment-content";

describe("issue-attachment-content", () => {
  it("detects relative attachment content paths", () => {
    expect(isIssueAttachmentContentUrl("/api/attachments/abc/content")).toBe(true);
    expect(isIssueAttachmentContentUrl("/api/attachments/abc/content?x=1")).toBe(true);
  });

  it("detects absolute attachment URLs", () => {
    expect(isIssueAttachmentContentUrl("https://app.example/api/attachments/abc/content")).toBe(true);
  });

  it("rejects non-attachment paths", () => {
    expect(isIssueAttachmentContentUrl("/api/assets/x/content")).toBe(false);
    expect(isIssueAttachmentContentUrl("/api/attachments/x")).toBe(false);
  });

  it("appends download query for relative paths", () => {
    expect(issueAttachmentDownloadUrl("/api/attachments/x/content")).toBe("/api/attachments/x/content?download=1");
  });

  it("merges download query for absolute URLs", () => {
    const out = issueAttachmentDownloadUrl("https://h/api/attachments/x/content?foo=1");
    const u = new URL(out);
    expect(u.searchParams.get("download")).toBe("1");
    expect(u.searchParams.get("foo")).toBe("1");
  });
});
