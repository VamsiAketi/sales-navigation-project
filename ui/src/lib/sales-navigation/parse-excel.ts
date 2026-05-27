import * as XLSX from "xlsx";
import type {
  SalesNavContact,
  SalesNavContactLevel,
  SalesNavContactStatus,
  SalesNavGraph,
} from "@paperclipai/shared";
import {
  normalizeHeader,
  parseLevel,
  parseStatus,
  parseStrength,
  slugId,
  stableAccountId,
} from "./parse-common";
import { isPodiumLeadIntelligenceWorkbook, parsePodiumLeadIntelligenceWorkbook } from "./parse-podium-excel";

function cell(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = row[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function parseGenericSalesNavWorkbook(workbook: XLSX.WorkBook): SalesNavGraph {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { accounts: [], contacts: [], edges: [], outreachHistory: [] };
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (rows.length === 0) {
    return { accounts: [], contacts: [], edges: [], outreachHistory: [] };
  }

  const headerMap = new Map<string, string>();
  for (const key of Object.keys(rows[0] ?? {})) {
    headerMap.set(normalizeHeader(key), key);
  }

  const pick = (row: Record<string, unknown>, ...candidates: string[]) => {
    for (const c of candidates) {
      const original = headerMap.get(c);
      if (original) return cell(row, original);
    }
    return "";
  };

  const accountNames = new Map<string, string>();
  const contacts: SalesNavContact[] = [];
  const nameToId = new Map<string, string>();
  const parsedRows: Array<{ row: Record<string, unknown>; contactId: string }> = [];

  rows.forEach((row, index) => {
    const name =
      pick(row, "name", "contact", "contact_name", "full_name", "linkedin_name", "point_of_contact") ||
      pick(row, "profile");
    if (!name) return;

    const accountName =
      pick(row, "account", "company", "target_company", "organization", "account_name") || "Strategic Account";
    const accountId = stableAccountId(accountName);
    if (!accountNames.has(accountId)) accountNames.set(accountId, accountName);

    const level = parseLevel(pick(row, "level", "buying_role", "role_type", "committee_level", "tier"));
    const status = parseStatus(pick(row, "status", "engagement_status", "outreach_status", "relationship_status"));
    const strength = parseStrength(
      pick(row, "relationship_strength", "strength", "relationship", "score", "score_10"),
    );
    const verified =
      pick(row, "verified", "verified_contact").toLowerCase() === "yes" ||
      pick(row, "verified", "verified_contact").toLowerCase() === "true" ||
      status === "verified";

    const contactId = slugId("contact", name, index);
    nameToId.set(name.toLowerCase(), contactId);

    parsedRows.push({ row, contactId });

    contacts.push({
      id: contactId,
      accountId,
      name,
      title: pick(row, "title", "job_title", "position") || null,
      company: accountName,
      linkedinUrl: pick(row, "linkedin", "linkedin_url", "profile_url") || null,
      level,
      status: verified && status === "unverified" ? "verified" : status,
      relationshipStrength: strength,
      verified,
      outreachNotes: pick(row, "notes", "outreach_notes", "comment") || null,
      warmIntroPath: pick(row, "warm_intro", "warm_intro_path", "intro_path") || null,
      reportsToContactId: null,
      teamOwner: pick(row, "owner", "team_owner", "assigned_to") || null,
    });
  });

  for (const { row, contactId } of parsedRows) {
    const contact = contacts.find((c) => c.id === contactId);
    if (!contact) continue;
    const reportsTo = pick(row, "reports_to", "manager", "reports_to_contact");
    if (reportsTo) {
      const targetId = nameToId.get(reportsTo.toLowerCase());
      if (targetId) contact.reportsToContactId = targetId;
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
      label: "Reports to",
    }));

  const accounts = [...accountNames.entries()].map(([id, name], i) => ({
    id,
    name,
    priorityScore: Math.max(40, 90 - i * 8),
    intentScore: Math.max(35, 80 - i * 6),
    ownerLabel: null,
    notes: null,
  }));

  return { accounts, contacts, edges, outreachHistory: [] };
}

export function parseSalesNavExcelBuffer(buffer: ArrayBuffer): SalesNavGraph {
  const workbook = XLSX.read(buffer, { type: "array" });
  if (isPodiumLeadIntelligenceWorkbook(workbook)) {
    return parsePodiumLeadIntelligenceWorkbook(workbook);
  }
  return parseGenericSalesNavWorkbook(workbook);
}
