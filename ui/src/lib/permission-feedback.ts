import {
  PERMISSION_KEYS,
  PROJECT_PERMISSION_KEYS,
  type PermissionKey,
  type ProjectPermissionKey,
} from "@paperclipai/shared";
import { ApiError } from "../api/client";
import { companyPermissionTitle } from "./company-permission-labels";
import { projectPermissionLabel } from "./project-permission-ui";

export function isPermissionDeniedError(error: unknown) {
  return error instanceof ApiError && error.status === 403;
}

const COMPANY_KEY_SET = new Set<string>(PERMISSION_KEYS);
const PROJECT_KEY_SET = new Set<string>(PROJECT_PERMISSION_KEYS);

/** Parses `Missing permission: …` / `Missing project permission: …` from API error text. */
export function parsePermissionRequirementMessage(message: string | undefined | null): {
  scope: "company" | "project";
  key: string;
} | null {
  const raw = (message ?? "").trim();
  if (!raw) return null;
  const projectMatch = raw.match(/^Missing project permission:\s*(.+)$/i);
  if (projectMatch?.[1]) {
    return { scope: "project", key: projectMatch[1].trim() };
  }
  const companyMatch = raw.match(/^Missing permission:\s*(.+)$/i);
  if (companyMatch?.[1]) {
    return { scope: "company", key: companyMatch[1].trim() };
  }
  return null;
}

function titleCaseFallback(segment: string): string {
  const cleaned = segment
    .replace(/[:._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return segment;
  return cleaned
    .split(" ")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function joinWithOr(phrases: string[]): string {
  if (phrases.length === 1) return phrases[0]!;
  if (phrases.length === 2) return `${phrases[0]!} or ${phrases[1]!}`;
  return `${phrases.slice(0, -1).join(", ")}, or ${phrases[phrases.length - 1]!}`;
}

type Classified = { scope: "company" | "project"; label: string };

function classifySegment(segment: string, impliedScope: "company" | "project"): Classified {
  const s = segment.trim();
  if (!s) {
    return { scope: impliedScope, label: "additional access" };
  }
  if (s === "project members:manage") {
    return { scope: "project", label: projectPermissionLabel("members:manage") };
  }
  if (s === "issue:read") {
    return { scope: "project", label: "View tasks" };
  }
  if (s === "issue:write") {
    return { scope: "project", label: "Edit tasks" };
  }
  if (COMPANY_KEY_SET.has(s)) {
    return { scope: "company", label: companyPermissionTitle(s as PermissionKey) };
  }
  if (PROJECT_KEY_SET.has(s)) {
    return { scope: "project", label: projectPermissionLabel(s as ProjectPermissionKey) };
  }
  return { scope: impliedScope, label: titleCaseFallback(s) };
}

/** Readable explanation for structured permission denials (toasts, inline errors). */
export function humanReadablePermissionRequirement(parsed: { scope: "company" | "project"; key: string }): string {
  const segments = parsed.key.split(/\s+or\s+/i).map((x) => x.trim()).filter(Boolean);
  if (segments.length === 0) {
    return parsed.scope === "project"
      ? "You do not have the project permission needed for this action."
      : "You do not have the company permission needed for this action.";
  }

  const items = segments.map((seg) => classifySegment(seg, parsed.scope));
  const scopeSet = new Set(items.map((i) => i.scope));

  if (items.length === 1) {
    const { scope, label } = items[0]!;
    return scope === "company"
      ? `You need this company permission: ${label}.`
      : `You need this project permission: ${label}.`;
  }

  if (scopeSet.size === 1) {
    const scope = items[0]!.scope;
    const realm = scope === "company" ? "company" : "project";
    return `You need one of these ${realm} permissions: ${joinWithOr(items.map((i) => i.label))}.`;
  }

  const parts = items.map(({ scope, label }) =>
    scope === "company" ? `${label} (company-wide)` : `${label} (on this project)`,
  );
  return `You need one of the following: ${joinWithOr(parts)}.`;
}

/** Copy for global 403 toasts (non-GET requests dispatch `PERMISSION_DENIED_EVENT`). */
export function permissionDeniedToastFromServerMessage(message: string | undefined | null): {
  title: string;
  body: string;
} {
  const trimmed = (message ?? "").trim();
  const parsed = parsePermissionRequirementMessage(trimmed);
  if (parsed) {
    return {
      title: "Action blocked",
      body: humanReadablePermissionRequirement(parsed),
    };
  }
  if (trimmed.length > 0) {
    const lower = trimmed.toLowerCase();
    if (lower !== "forbidden") {
      return { title: "Permission denied", body: trimmed };
    }
  }
  return {
    title: "Permission denied",
    body: "You do not have permission to perform this action. Ask a company admin if you need access.",
  };
}

export function assigneeUpdateErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) {
    const parsed = parsePermissionRequirementMessage(error.message);
    if (parsed) {
      return `You do not have permission to reassign this issue. ${humanReadablePermissionRequirement(parsed)}`;
    }
    return error.message.trim() || "You do not have permission to reassign this issue.";
  }
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Failed to update assignee.";
}
