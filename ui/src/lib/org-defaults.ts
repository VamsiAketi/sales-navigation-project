import type { Agent } from "@paperclipai/shared";
import type { CompanyMember } from "../api/access";

function createdAtMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  }
  return Number.MAX_SAFE_INTEGER;
}

export function pickFirstCreatedOwnerMemberId(members: CompanyMember[]): string | null {
  const owners = members
    .filter(
      (member) =>
        member.principalType === "user" &&
        member.status === "active" &&
        (member.membershipRole ?? "").trim().toLowerCase() === "owner",
    )
    .slice()
    .sort((a, b) => createdAtMs(a.createdAt) - createdAtMs(b.createdAt));
  return owners[0]?.id ?? null;
}

export function pickFirstCreatedHumanMemberId(members: CompanyMember[]): string | null {
  const humans = members
    .filter((member) => member.principalType === "user" && member.status === "active")
    .slice()
    .sort((a, b) => createdAtMs(a.createdAt) - createdAtMs(b.createdAt));
  return humans[0]?.id ?? null;
}

export function pickFirstCreatedAgentId(agents: Agent[]): string | null {
  const sorted = agents
    .slice()
    .sort((a, b) => createdAtMs(a.createdAt) - createdAtMs(b.createdAt));
  return sorted[0]?.id ?? null;
}

