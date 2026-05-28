import type { SalesNavContactLevel } from "@paperclipai/shared";
import { extractFirstLinkedInUrl } from "./parse-common";
import { isVercelStaticMode } from "../vercel-static/config";

/** Climb order for avatar prefetch (bottom row first). */
export const SALES_NAV_AVATAR_PREFETCH_LEVEL_ORDER: Record<SalesNavContactLevel, number> = {
  warm_intro: 0,
  internal_champion: 1,
  influencer: 2,
  technical_evaluator: 3,
  decision_maker: 4,
  procurement: 5,
};

/**
 * Guess a linkedin.com/in/… URL when PODIUM lists a mutual as a name or slug only.
 * Used for bottom-tier mutual connections that lack an explicit profile URL in Excel.
 */
export function salesNavInferLinkedInProfileUrl(name: string): string | null {
  const display = salesNavDisplayName(name).trim();
  if (!display) return null;

  const embedded = extractFirstLinkedInUrl(display);
  if (embedded) return embedded;

  const withoutTrailing = display.replace(/\s+\d+[\w.-]*$/, "").trim();
  const slugCandidate = !/\s/.test(withoutTrailing)
    ? withoutTrailing
    : withoutTrailing
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

  if (!slugCandidate || slugCandidate.length < 3) return null;
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slugCandidate)) return null;

  return `https://www.linkedin.com/in/${slugCandidate.toLowerCase()}`;
}

export function salesNavResolveLinkedInUrl(
  name: string,
  linkedinUrl?: string | null,
): string | null {
  const explicit = linkedinUrl?.trim();
  if (explicit) return explicit;
  return salesNavInferLinkedInProfileUrl(name);
}

/** Same-origin avatar proxy (resolves LinkedIn photo server-side). */
export function salesNavLinkedInAvatarSrc(companyId: string, linkedinUrl: string | null | undefined): string | null {
  if (!companyId || !linkedinUrl?.trim()) return null;
  const params = new URLSearchParams({ url: linkedinUrl.trim() });
  if (isVercelStaticMode) {
    return `/api/linkedin-avatar?${params}`;
  }
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
