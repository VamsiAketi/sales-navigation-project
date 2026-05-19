const BLOB_URL_IN_MARKDOWN = /\bblob:[^\s)]+/g;

/**
 * Replace each unique `blob:…` URL in markdown with `await upload(file)` for the
 * matching entry in `pending`, then revoke the blob URL and delete the map entry.
 */
export async function flushComposerBlobUrls(
  markdown: string,
  pending: Map<string, File>,
  upload: (file: File) => Promise<string>,
): Promise<string> {
  let out = markdown;
  const seen = new Set<string>();
  const matches = markdown.match(BLOB_URL_IN_MARKDOWN) ?? [];
  for (const blobUrl of matches) {
    if (seen.has(blobUrl)) continue;
    seen.add(blobUrl);
    const file = pending.get(blobUrl);
    if (!file) continue;
    const path = await upload(file);
    out = out.split(blobUrl).join(path);
    URL.revokeObjectURL(blobUrl);
    pending.delete(blobUrl);
  }
  return out;
}

/** Revoke staged blob URLs that no longer appear in the composer markdown. */
export function revokeOrphanedComposerBlobs(markdown: string, pending: Map<string, File>): void {
  for (const url of [...pending.keys()]) {
    if (!markdown.includes(url)) {
      URL.revokeObjectURL(url);
      pending.delete(url);
    }
  }
}
