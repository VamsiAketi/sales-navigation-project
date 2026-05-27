/** Extract public profile slug from a linkedin.com/in/… URL. */
export function parseLinkedInProfileSlug(linkedinUrl: string): string | null {
  try {
    const parsed = new URL(linkedinUrl.trim());
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (host !== "linkedin.com") return null;
    const match = parsed.pathname.match(/\/in\/([^/]+)/i);
    const slug = match?.[1]?.replace(/\/$/, "").trim();
    return slug || null;
  } catch {
    return null;
  }
}

export function isAllowedLinkedInProfileUrl(linkedinUrl: string): boolean {
  return parseLinkedInProfileSlug(linkedinUrl) !== null;
}
