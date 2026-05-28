import type { SalesNavContactLevel, SalesNavContactStatus } from "@paperclipai/shared";
import { SALES_NAV_CONTACT_STATUSES } from "@paperclipai/shared";

export function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function slugId(prefix: string, value: string, index: number): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${prefix}-${base || "row"}-${index}`;
}

export function stableAccountId(companyName: string): string {
  const base = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `acct-${base || "unknown"}`;
}

export function extractFirstLinkedInUrl(raw: string): string | null {
  const match = raw.match(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s)]+/i);
  return match ? match[0].replace(/[.,;]+$/, "") : null;
}

export function parseLevel(raw: string): SalesNavContactLevel {
  const n = raw.toLowerCase();
  if (n.includes("warm") || n.includes("intro")) return "warm_intro";
  if (n.includes("champion")) return "internal_champion";
  if (n.includes("influenc")) return "influencer";
  if (n.includes("technical") || n.includes("evaluat")) return "technical_evaluator";
  if (n.includes("decision") || n.includes("economic") || n.includes("buyer")) return "decision_maker";
  if (n.includes("procure") || n.includes("budget")) return "procurement";
  return "influencer";
}

export function parseLevelFromTitle(title: string): SalesNavContactLevel {
  const t = title.toLowerCase();
  if (t.includes("ceo") || t.includes("coo") || t.includes("president") || t.includes("founder")) {
    return "decision_maker";
  }
  if (
    t.includes("evp") ||
    (t.includes("vp") && (t.includes("strategy") || t.includes("development") || t.includes("construction")))
  ) {
    return "internal_champion";
  }
  if (t.includes("director") && (t.includes("construction") || t.includes("engineering") || t.includes("operat"))) {
    return "technical_evaluator";
  }
  if (t.includes("director")) return "influencer";
  if (t.includes("vp")) return "internal_champion";
  if (t.includes("architect") || t.includes("engineer")) return "technical_evaluator";
  return "influencer";
}

export function parseStatus(raw: string): SalesNavContactStatus {
  const n = raw.toLowerCase().replace(/\s+/g, "_");
  const hit = SALES_NAV_CONTACT_STATUSES.find((s) => n.includes(s.replace(/_/g, "")) || n === s);
  if (hit) return hit;
  if (n.includes("not_contact")) return "not_contacted";
  if (n.includes("outreach")) return "outreach_sent";
  if (n.includes("in_progress")) return "in_progress";
  if (n.includes("progress")) return "in_progress";
  if (n.includes("convert")) return "converted";
  if (n.includes("discussion") || n.includes("negotiat") || n.includes("pipeline")) return "in_discussion";
  if (n.includes("connect")) return "connected";
  if (n.includes("meeting")) return "meeting_scheduled";
  if (n.includes("contact")) return "contacted";
  if (n.includes("won")) return "closed_won";
  if (n.includes("lost")) return "closed_lost";
  if (n.includes("verify")) return "verified";
  if (n.includes("warm")) return "warm_intro_complete";
  return "not_contacted";
}

/** Parses 0–100, 0–10 scores, or strong/medium/weak labels. */
export function parseStrength(raw: string): number {
  const cleaned = raw.replace(/\r?\n/g, " ").trim();
  if (!cleaned) return 50;
  const n = Number.parseFloat(cleaned);
  if (!Number.isNaN(n)) {
    if (n <= 10) return Math.min(100, Math.max(0, Math.round(n * 10)));
    return Math.min(100, Math.max(0, Math.round(n)));
  }
  const lower = cleaned.toLowerCase();
  if (lower.includes("signing")) return 95;
  if (lower.includes("strong") || lower.includes("high") || lower.includes("hot")) return 85;
  if (lower.includes("medium") || lower.includes("med") || lower.includes("warm")) return 60;
  if (lower.includes("weak") || lower.includes("low") || lower.includes("cold")) return 30;
  return 50;
}

export function isSectionDividerRow(companyCell: string): boolean {
  const v = companyCell.trim();
  if (!v) return true;
  if (v.toLowerCase() === "company") return true;
  if (v.startsWith("──") || v.startsWith("--")) return true;
  if (v.toLowerCase().startsWith("podium")) return true;
  return false;
}
