/**
 * Microsoft Azure / Fluent semantic colors for the Agents list page
 * (portal-style command bar, resource rows, status pills).
 */

export const azureAgentStatusDot: Record<string, string> = {
  running: "bg-[#0078d4] animate-pulse",
  active: "bg-[#107c10]",
  paused: "bg-[#ca5010]",
  idle: "bg-[#ffb900]",
  pending_approval: "bg-[#8764b8]",
  error: "bg-[#a4262c]",
  archived: "bg-[#8a8886]",
  terminated: "bg-[#8a8886]",
};

export const azureAgentStatusDotDefault = "bg-[#8a8886]";

/** Fluent-style tinted pills (message bar / tag semantics). */
export const azureAgentStatusBadge: Record<string, string> = {
  active: "bg-[#dff6dd] text-[#107c10] dark:bg-[#107c10]/22 dark:text-[#6ccb6f]",
  running: "bg-[#deecf9] text-[#0078d4] dark:bg-[#0078d4]/22 dark:text-[#4cc2ff]",
  paused: "bg-[#fff4ce] text-[#323130] dark:bg-[#ca5010]/22 dark:text-[#ffa94d]",
  idle: "bg-[#fff4ce] text-[#605e5c] dark:bg-[#ffb900]/18 dark:text-[#ffe082]",
  archived: "bg-[#edebe9] text-[#605e5c] dark:bg-white/10 dark:text-[#c8c6c4]",
  error: "bg-[#fde7e9] text-[#a4262c] dark:bg-[#a4262c]/25 dark:text-[#ff9c9c]",
  terminated: "bg-[#fde7e9] text-[#a4262c] dark:bg-[#a4262c]/25 dark:text-[#ff9c9c]",
  pending_approval: "bg-[#f3f2f1] text-[#8764b8] dark:bg-[#8764b8]/22 dark:text-[#d8b4fe]",
};

export const azureAgentStatusBadgeDefault =
  "bg-[#edebe9] text-[#605e5c] dark:bg-white/10 dark:text-[#c8c6c4]";
