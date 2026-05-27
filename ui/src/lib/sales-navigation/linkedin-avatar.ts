/** Same-origin avatar proxy (resolves LinkedIn photo server-side). */
export function salesNavLinkedInAvatarSrc(companyId: string, linkedinUrl: string | null | undefined): string | null {
  if (!companyId || !linkedinUrl?.trim()) return null;
  const params = new URLSearchParams({ url: linkedinUrl.trim() });
  return `/api/companies/${encodeURIComponent(companyId)}/sales-navigation/linkedin-avatar?${params}`;
}

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function nameFromLinkedInUrl(url: string): string {
  const clean = url.trim().replace(/[?#].*$/, "");
  const slug = clean.split("/").filter(Boolean).pop() ?? "";
  const normalized = slug
    .replace(/^in\//i, "")
    .replace(/[-_]+/g, " ")
    .replace(/[0-9]+$/g, "")
    .trim();
  return normalized ? titleCaseWords(normalized) : "Mutual connection";
}

export function salesNavDisplayName(name: string, linkedinUrl?: string | null): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return linkedinUrl ? nameFromLinkedInUrl(linkedinUrl) : "Unknown";
  const directUrl = /^https?:\/\/(?:www\.)?linkedin\.com\//i.test(trimmed);
  if (directUrl) return nameFromLinkedInUrl(trimmed);
  return trimmed;
}

export function salesNavCleanWarmIntroText(text: string): string {
  return text.replace(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s,)]+/gi, (url) => nameFromLinkedInUrl(url));
}

export function salesNavContactInitials(name: string): string {
  const parts = salesNavDisplayName(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}
