// @vitest-environment node

import { describe, expect, it } from "vitest";
import { escapeMarkdownLabel, fileShouldEmbedAsMarkdownImage, markdownTokenForUploadedIssueFile } from "./issue-attachment-file-accept";

describe("issue-attachment-file-accept", () => {
  it("escapes markdown label brackets and backslashes", () => {
    expect(escapeMarkdownLabel("a[b]c\\d")).toBe("a\\[b\\]c\\\\d");
  });

  it("embeds images as markdown image syntax", () => {
    const f = new File([], "x.png", { type: "image/png" });
    expect(markdownTokenForUploadedIssueFile(f, "/api/attachments/u1/content")).toBe(
      "![x.png](/api/attachments/u1/content)",
    );
  });

  it("uses link syntax for non-images", () => {
    const f = new File([], "q.pdf", { type: "application/pdf" });
    expect(markdownTokenForUploadedIssueFile(f, "/api/attachments/u2/content")).toBe(
      "[q.pdf](/api/attachments/u2/content)",
    );
  });

  it("detects image by extension when type is empty", () => {
    const f = new File([], "z.JPEG", { type: "" });
    expect(fileShouldEmbedAsMarkdownImage(f)).toBe(true);
  });
});
