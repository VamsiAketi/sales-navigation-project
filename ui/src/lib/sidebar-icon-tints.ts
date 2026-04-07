/**
 * Microsoft Azure / Fluent-style accent colors for sidebar and rail icons
 * (saturated hues on the light gray nav rail; brighter variants in dark mode).
 */
export const azureSidebarIcon = {
  dashboard: "text-[#0078d4] dark:text-[#4cc2ff]",
  org: "text-[#8764b8] dark:text-[#b794f6]",
  skills: "text-[#ca5010] dark:text-[#ffa94d]",
  costs: "text-[#107c10] dark:text-[#54b054]",
  goals: "text-[#d13438] dark:text-[#ff7a83]",
  inbox: "text-[#0078d4] dark:text-[#4cc2ff]",
  routines: "text-[#8661c5] dark:text-[#c4b5fd]",
  audit: "text-[#d83b01] dark:text-[#ff9c5b]",
  team: "text-[#038387] dark:text-[#4dbbbc]",
  settings: "text-[#5c2d91] dark:text-[#d8b4fe]",
  projects: "text-[#00bcf2] dark:text-[#69d4ff]",
  agents: "text-[#8764b8] dark:text-[#b794f6]",
  human: "text-[#334b75] dark:text-[#7eb0ff]",
  search: "text-[#0078d4] dark:text-[#4cc2ff]",
  layers: "text-[#0078d4] dark:text-[#4cc2ff]",
  /** Azure "Create resource" green */
  addResource: "text-[#107c10] dark:text-[#6ccb6f]",
  general: "text-[#605e5c] dark:text-[#c8c6c4]",
  users: "text-[#038387] dark:text-[#4dbbbc]",
  heartbeats: "text-[#ca5010] dark:text-[#ffa94d]",
  experimental: "text-[#8764b8] dark:text-[#b794f6]",
  plugins: "text-[#8661c5] dark:text-[#c4b5fd]",
  issues: "text-[#0078d4] dark:text-[#4cc2ff]",
  home: "text-[#0078d4] dark:text-[#4cc2ff]",
  newAction: "text-[#107c10] dark:text-[#6ccb6f]",
  book: "text-[#ca5010] dark:text-[#ffa94d]",
  /** Footer chrome: collapse rail, theme, etc. */
  chrome: "text-[#605e5c] dark:text-[#c8c6c4]",
} as const;

const AGENT_ICON_TINTS = [
  azureSidebarIcon.dashboard,
  azureSidebarIcon.costs,
  azureSidebarIcon.org,
  azureSidebarIcon.skills,
  azureSidebarIcon.goals,
  azureSidebarIcon.inbox,
  azureSidebarIcon.team,
  azureSidebarIcon.projects,
  azureSidebarIcon.agents,
] as const;

/** Stable per-agent hue so each AI teammate reads as a distinct "service" icon. */
export function azureAgentSidebarIconTint(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AGENT_ICON_TINTS[h % AGENT_ICON_TINTS.length]!;
}
