import * as XLSX from "xlsx";
import type { SalesNavContact, SalesNavContactStatus, SalesNavGraph } from "@paperclipai/shared";
import {
  extractFirstLinkedInUrl,
  isSectionDividerRow,
  normalizeHeader,
  parseStrength,
  slugId,
  stableAccountId,
} from "./parse-common";

const PODIUM_SHEET_NAME = "lead intelligence";
const PANKAJ_LINKEDIN_URL = "https://www.linkedin.com/in/pankaj-srivastava-71b751/?skipRedirect=true";

type PodiumRow = Record<string, string>;
type AccountMeta = { name: string; maxScore: number; maxIntent: number; region: string };
type ParsedMutual = { name: string; linkedinUrl: string | null };
type ParserEdge = {
  from: string;
  to: string;
  strength: number;
  label: string;
  type?: "strong" | "medium" | "weak";
};

function cellAt(row: unknown[], index: number): string {
  const v = row[index];
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function findHeaderRowIndex(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i] ?? [];
    const normalized = row.map((c) => normalizeHeader(c));
    if (normalized.includes("company") && normalized.includes("point_of_contact")) {
      return i;
    }
  }
  return -1;
}

function buildRowRecords(rows: unknown[][], headerRowIndex: number): PodiumRow[] {
  const headerRow = rows[headerRowIndex] ?? [];
  const keys = headerRow.map((h) => normalizeHeader(h));
  const records: PodiumRow[] = [];

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const raw = rows[i] ?? [];
    const record: PodiumRow = {};
    keys.forEach((key, col) => {
      if (key) record[key] = cellAt(raw, col);
    });
    records.push(record);
  }
  return records;
}

function pick(row: PodiumRow, ...keys: string[]): string {
  for (const key of keys) {
    const v = row[key];
    if (v) return v;
  }
  return "";
}

function parsePodiumPipelineStatus(raw: string): SalesNavContactStatus {
  const n = raw.toLowerCase().trim();
  if (n === "signing" || n.includes("signing")) return "converted";
  if (n === "hot") return "in_progress";
  if (n === "warm") return "not_contacted";
  return "not_contacted";
}

function parsePodiumRelationshipStatus(raw: string, pipeline: string): SalesNavContactStatus {
  const n = raw.toLowerCase();
  if (n.includes("signing") || n.includes("existing customer")) return "verified";
  if (n.includes("warm")) return "warm_intro_complete";
  if (n.includes("cold")) return "unverified";
  if (pipeline.toLowerCase() === "signing") return "verified";
  return parsePodiumPipelineStatus(pipeline);
}

function pipelineIntentScore(pipeline: string): number {
  const n = pipeline.toLowerCase();
  if (n === "signing") return 95;
  if (n === "hot") return 82;
  if (n === "warm") return 62;
  return 50;
}

function buildOutreachNotes(row: PodiumRow): string | null {
  const parts = [
    pick(row, "strategic_fit") && `Fit: ${pick(row, "strategic_fit")}`,
    pick(row, "primary_hook") && `Hook: ${pick(row, "primary_hook")}`,
    pick(row, "buying_signal") && `Signal: ${pick(row, "buying_signal")}`,
    pick(row, "feasibility_workflow") && `Feasibility: ${pick(row, "feasibility_workflow")}`,
    pick(row, "consulting_partners") && `Partners: ${pick(row, "consulting_partners")}`,
    pick(row, "approach_strategy") && `Approach: ${pick(row, "approach_strategy")}`,
    pick(row, "reason_for_inclusion") && pick(row, "reason_for_inclusion"),
  ].filter(Boolean) as string[];

  if (parts.length === 0) return null;
  const text = parts.join("\n\n");
  return text.length > 4000 ? `${text.slice(0, 3997)}…` : text;
}

function extractViaContactName(warmIntroPath: string): string | null {
  const via = warmIntroPath.match(/\bvia\s+([^,(]+)/i);
  if (via?.[1]) return via[1].trim();
  return null;
}

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function mutualNameFromLinkedInUrl(url: string): string {
  const clean = url.trim().replace(/[?#].*$/, "");
  const slug = clean.split("/").filter(Boolean).pop() ?? "Mutual connection";
  const normalized = slug
    .replace(/^in\//i, "")
    .replace(/[-_]+/g, " ")
    .replace(/[0-9]+$/g, "")
    .trim();
  return normalized ? titleCaseWords(normalized) : "Mutual connection";
}

function normalizePersonName(raw: string): string {
  const trimmed = raw.trim();
  const url = extractFirstLinkedInUrl(trimmed);
  if (url) return mutualNameFromLinkedInUrl(url);
  return trimmed;
}

function parseLinkedInConnections(raw: string): ParsedMutual[] {
  const cleaned = raw
    .replace(/\r?\n/g, ",")
    .replace(/\band\b/gi, ",")
    .trim();
  if (!cleaned || cleaned.toLowerCase().includes("no connections")) return [];
  const urlMatches = [...cleaned.matchAll(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s,;]+/gi)]
    .map((m) => m[0]?.trim())
    .filter((u): u is string => Boolean(u));
  if (urlMatches.length > 0) {
    const uniqueUrls = [...new Set(urlMatches)];
    return uniqueUrls.map((linkedinUrl) => ({
      name: mutualNameFromLinkedInUrl(linkedinUrl),
      linkedinUrl,
    }));
  }
  return cleaned
    .split(/[;,]/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^\d+[\).\s-]*/, "").trim())
    .filter((part) => part.length >= 2)
    .filter((part) => !/^no\s*connections?$/i.test(part))
    .map((part) => {
      const linkedinUrl = extractFirstLinkedInUrl(part);
      const name = linkedinUrl ? mutualNameFromLinkedInUrl(linkedinUrl) : part;
      return { name, linkedinUrl };
    });
}

function ensurePankajStartNode(
  contacts: SalesNavContact[],
  accountId: string,
  company: string,
  nameToId: Map<string, string>,
): string {
  const existing = contacts.find(
    (c) => c.accountId === accountId && c.name.toLowerCase() === "pankaj srivastava",
  );
  if (existing) return existing.id;

  const contactId = slugId("contact", `${company}-pankaj-srivastava`, contacts.length);
  contacts.push({
    id: contactId,
    accountId,
    name: "Pankaj Srivastava",
    title: "Internal connector",
    company,
    linkedinUrl: PANKAJ_LINKEDIN_URL,
    level: "warm_intro",
    status: "in_progress",
    relationshipStrength: 100,
    verified: true,
    outreachNotes: "Auto-generated climb start node from PODIUM import.",
    warmIntroPath: null,
    reportsToContactId: null,
    teamOwner: null,
  });
  nameToId.set("pankaj srivastava", contactId);
  nameToId.set(`${company.toLowerCase()}::pankaj srivastava`, contactId);
  return contactId;
}

function ensureMutualContact(
  contacts: SalesNavContact[],
  accountId: string,
  company: string,
  nameToId: Map<string, string>,
  name: string,
  linkedinUrl: string | null,
): string {
  const scopedKey = `${company.toLowerCase()}::${name.toLowerCase()}`;
  const existingId = nameToId.get(scopedKey) ?? nameToId.get(name.toLowerCase());
  if (existingId) return existingId;

  const contactId = slugId("contact", `${company}-${name}`, contacts.length);
  contacts.push({
    id: contactId,
    accountId,
    name,
    title: "Mutual connection",
    company,
    linkedinUrl,
    level: "internal_champion",
    status: "connected",
    relationshipStrength: 90,
    verified: true,
    outreachNotes: "Imported from LinkedIn Connections - PS.",
    warmIntroPath: `Via ${name}`,
    reportsToContactId: null,
    teamOwner: null,
  });
  nameToId.set(name.toLowerCase(), contactId);
  nameToId.set(scopedKey, contactId);
  return contactId;
}

export function isPodiumLeadIntelligenceWorkbook(workbook: XLSX.WorkBook): boolean {
  const sheetName = workbook.SheetNames.find((n) => normalizeHeader(n) === PODIUM_SHEET_NAME);
  if (sheetName) return true;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    if (findHeaderRowIndex(rows) >= 0) return true;
  }
  return false;
}

export function parsePodiumLeadIntelligenceWorkbook(workbook: XLSX.WorkBook): SalesNavGraph {
  const sheetName =
    workbook.SheetNames.find((n) => normalizeHeader(n) === PODIUM_SHEET_NAME) ?? workbook.SheetNames[0];
  if (!sheetName) {
    return { accounts: [], contacts: [], edges: [], outreachHistory: [] };
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  const headerRowIndex = findHeaderRowIndex(rows);
  if (headerRowIndex < 0) {
    return { accounts: [], contacts: [], edges: [], outreachHistory: [] };
  }

  const dataRows = buildRowRecords(rows, headerRowIndex);
  const accountMeta = new Map<string, AccountMeta>();
  const contacts: SalesNavContact[] = [];
  const nameToId = new Map<string, string>();
  const parserEdges: ParserEdge[] = [];
  let rowIndex = 0;

  for (const row of dataRows) {
    const company = pick(row, "company");
    if (isSectionDividerRow(company)) continue;

    const rawName = pick(row, "point_of_contact", "contact_name", "name");
    const name = normalizePersonName(rawName);
    if (!name) continue;

    const accountId = stableAccountId(company);
    const pipelineStatus = pick(row, "status");
    const relationshipStatus = pick(row, "relationship_status");
    const scoreRaw = pick(row, "score_10", "score");
    const strength = parseStrength(scoreRaw || pipelineStatus);
    const status = parsePodiumRelationshipStatus(relationshipStatus, pipelineStatus);
    const title = pick(row, "title", "job_title") || null;
    const linkedinRaw = pick(row, "linkedin", "linkedin_url");
    const linkedinUrl = extractFirstLinkedInUrl(linkedinRaw) ?? (linkedinRaw.startsWith("http") ? linkedinRaw : null);
    const warmIntroPath = pick(row, "warm_intro_path", "warm_intro") || null;

    const verified =
      status === "verified" ||
      status === "closed_won" ||
      pipelineStatus.toLowerCase() === "signing" ||
      (warmIntroPath?.toLowerCase().includes("existing customer") ?? false);

    const contactId = slugId("contact", `${company}-${name}`, rowIndex);
    rowIndex += 1;
    nameToId.set(name.toLowerCase(), contactId);
    nameToId.set(`${company.toLowerCase()}::${name.toLowerCase()}`, contactId);

    const intent = pipelineIntentScore(pipelineStatus);
    const existing = accountMeta.get(accountId);
    if (!existing) {
      accountMeta.set(accountId, {
        name: company,
        maxScore: strength,
        maxIntent: intent,
        region: pick(row, "region"),
      });
    } else {
      existing.maxScore = Math.max(existing.maxScore, strength);
      existing.maxIntent = Math.max(existing.maxIntent, intent);
      if (!existing.region) existing.region = pick(row, "region");
    }

    contacts.push({
      id: contactId,
      accountId,
      name,
      title,
      company,
      linkedinUrl,
      level: "decision_maker",
      status: verified && status === "unverified" ? "verified" : status,
      relationshipStrength: strength,
      verified,
      outreachNotes: buildOutreachNotes(row),
      warmIntroPath,
      reportsToContactId: null,
      teamOwner: pick(row, "source") || pick(row, "consultant_in_podium_list") || null,
    });

    const psConnectionsRaw = pick(row, "linkedin_connections_ps", "linkedin_connections", "linkedin_connections_-_ps");
    const psConnections = parseLinkedInConnections(psConnectionsRaw);
    const pankajId = ensurePankajStartNode(contacts, accountId, company, nameToId);
    if (psConnections.length > 0) {
      for (const mutual of psConnections) {
        if (mutual.name.toLowerCase() === "pankaj srivastava") continue;
        const mutualId = ensureMutualContact(contacts, accountId, company, nameToId, mutual.name, mutual.linkedinUrl);
        parserEdges.push({ from: pankajId, to: mutualId, strength: 95, label: "PS mutual route" });
        parserEdges.push({ from: mutualId, to: contactId, strength: Math.max(60, strength), label: "Mutual to target" });
      }
    }
  }

  for (const contact of contacts) {
    if (!contact.warmIntroPath) continue;
    const viaName = extractViaContactName(contact.warmIntroPath);
    if (!viaName) continue;
    const targetId =
      nameToId.get(`${contact.company?.toLowerCase() ?? ""}::${viaName.toLowerCase()}`) ??
      nameToId.get(viaName.toLowerCase());
    if (targetId && targetId !== contact.id) {
      contact.reportsToContactId = targetId;
    }
  }

  const edges = contacts
    .filter((c) => c.reportsToContactId)
    .map((c, i) => ({
      id: `edge-${i}`,
      fromContactId: c.id,
      toContactId: c.reportsToContactId!,
      type:
        c.relationshipStrength >= 70
          ? ("strong" as const)
          : c.relationshipStrength >= 45
            ? ("medium" as const)
            : ("weak" as const),
      strength: c.relationshipStrength,
      label: "Warm intro path",
    }));

  const existingEdgeKeys = new Set(edges.map((e) => `${e.fromContactId}->${e.toContactId}`));
  for (const [i, edge] of parserEdges.entries()) {
    const key = `${edge.from}->${edge.to}`;
    if (existingEdgeKeys.has(key)) continue;
    existingEdgeKeys.add(key);
    edges.push({
      id: `podium-edge-${i}`,
      fromContactId: edge.from,
      toContactId: edge.to,
      type: edge.type ?? (edge.strength >= 75 ? "strong" : edge.strength >= 50 ? "medium" : "weak"),
      strength: edge.strength,
      label: edge.label,
    });
  }

  const accounts = [...accountMeta.entries()]
    .map(([id, meta]) => ({
      id,
      name: meta.name,
      priorityScore: meta.maxScore,
      intentScore: meta.maxIntent,
      ownerLabel: meta.region || null,
      notes: null,
    }))
    .sort((a, b) => b.priorityScore - a.priorityScore);

  return { accounts, contacts, edges, outreachHistory: [] };
}
