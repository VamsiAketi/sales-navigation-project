import type { Agent } from "@paperclipai/shared";
import type { UserNotification } from "@/api/notifications";

const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const AGENT_PREFIX_UUID_RE = new RegExp(`\\bAgent\\s+(${UUID_PATTERN})\\b`, "gi");

export function buildAgentsByCompanyId(
  companyIds: string[],
  agentsPerCompany: Array<Agent[] | undefined>,
): Map<string, Map<string, string>> {
  const map = new Map<string, Map<string, string>>();
  companyIds.forEach((companyId, index) => {
    const byId = new Map<string, string>();
    for (const agent of agentsPerCompany[index] ?? []) {
      if (agent.name?.trim()) {
        byId.set(agent.id, agent.name.trim());
      }
    }
    map.set(companyId, byId);
  });
  return map;
}

function taskNameFromPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const title = payload.issueTitle;
  if (typeof title === "string" && title.trim()) return title.trim();
  const identifier = payload.issueIdentifier;
  if (typeof identifier === "string" && identifier.trim()) return identifier.trim();
  return null;
}

/** Prefer task title over stored identifier in notification titles (existing rows). */
export function formatNotificationTitle(item: UserNotification): string {
  const taskName = taskNameFromPayload(item.payload);
  if (!taskName) return item.title;

  const prefixMatch = item.title.match(/^(\[[^\]]+\])\s*/);
  const prefix = prefixMatch?.[1];
  if (!prefix) return taskName;

  const remainder = item.title.slice(prefix.length).trim();
  if (remainder.startsWith("Mentioned in ")) {
    return `${prefix} Mentioned in ${taskName}`;
  }
  if (remainder.startsWith("Human Approval Required:")) {
    return `${prefix} Human Approval Required: ${taskName}`;
  }
  return `${prefix} ${taskName}`;
}

/** Replace legacy `Agent <uuid>` labels with agent display names. */
export function formatNotificationActorText(
  text: string,
  companyId: string | null,
  agentsByCompanyId: Map<string, Map<string, string>>,
): string {
  if (!text) return text;
  return text.replace(AGENT_PREFIX_UUID_RE, (_match, agentId: string) => {
    const name =
      (companyId ? agentsByCompanyId.get(companyId)?.get(agentId) : null) ??
      [...agentsByCompanyId.values()].map((byId) => byId.get(agentId)).find(Boolean);
    return name ?? `Agent ${agentId.slice(0, 8)}`;
  });
}
