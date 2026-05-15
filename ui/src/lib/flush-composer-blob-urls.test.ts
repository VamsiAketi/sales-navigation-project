// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { flushComposerBlobUrls, revokeOrphanedComposerBlobs } from "./flush-composer-blob-urls";

describe("flushComposerBlobUrls", () => {
  it("replaces blob URLs with upload results and clears pending", async () => {
    const pending = new Map<string, File>();
    const f = new File([], "a.png", { type: "image/png" });
    const blobA = "blob:http://localhost/x1";
    const blobB = "blob:http://localhost/x2";
    pending.set(blobA, f);
    pending.set(blobB, f);
    const upload = vi.fn().mockResolvedValueOnce("/api/a").mockResolvedValueOnce("/api/b");
    const md = `![a](${blobA}) and [b](${blobB})`;
    const out = await flushComposerBlobUrls(md, pending, upload);
    expect(out).toBe("![a](/api/a) and [b](/api/b)");
    expect(upload).toHaveBeenCalledTimes(2);
    expect(pending.size).toBe(0);
  });

  it("dedupes the same blob URL (one upload, all occurrences replaced)", async () => {
    const pending = new Map<string, File>();
    const f = new File([], "a.png", { type: "image/png" });
    const blob = "blob:http://localhost/x";
    pending.set(blob, f);
    const upload = vi.fn().mockResolvedValue("/api/one");
    const md = `![](${blob}) ![](${blob})`;
    const out = await flushComposerBlobUrls(md, pending, upload);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(out).toBe("![](/api/one) ![](/api/one)");
    expect(pending.size).toBe(0);
  });
});

describe("revokeOrphanedComposerBlobs", () => {
  it("drops pending entries not referenced in markdown", () => {
    const pending = new Map<string, File>();
    const u = "blob:http://localhost/z";
    pending.set(u, new File([], "x"));
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    revokeOrphanedComposerBlobs("no blob here", pending);
    expect(revoke).toHaveBeenCalledWith(u);
    expect(pending.size).toBe(0);
    revoke.mockRestore();
  });
});
