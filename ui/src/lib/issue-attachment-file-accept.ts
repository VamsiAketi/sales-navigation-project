/**
 * Browser `<input accept>` hint for issue attachments. Keep aligned with
 * `server/src/attachment-types.ts` DEFAULT_ALLOWED_TYPES (plus common extensions).
 */
export const ISSUE_ATTACHMENT_FILE_INPUT_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "video/webm",
  "video/mp4",
  "video/ogg",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
  "audio/x-m4a",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
].join(",");

/** Escape `[]\` for use inside markdown `[]()` link or image labels. */
export function escapeMarkdownLabel(filename: string): string {
  return filename.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

export function fileShouldEmbedAsMarkdownImage(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test(file.name);
}

export function markdownTokenForUploadedIssueFile(file: File, url: string): string {
  const label = escapeMarkdownLabel(file.name);
  return fileShouldEmbedAsMarkdownImage(file) ? `![${label}](${url})` : `[${label}](${url})`;
}
