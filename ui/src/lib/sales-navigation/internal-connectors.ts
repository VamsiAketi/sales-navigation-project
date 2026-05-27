/** Bottom-tier internal connectors (climb start nodes), matched case-insensitively by display name. */
export const SALES_NAV_INTERNAL_CONNECTOR_NAMES = ["pankaj srivastava", "nav"] as const;

export function isSalesNavInternalConnector(name: string, linkedinUrl?: string | null): boolean {
  const display = name.trim().toLowerCase();
  if ((SALES_NAV_INTERNAL_CONNECTOR_NAMES as readonly string[]).includes(display)) return true;
  if (linkedinUrl?.includes("pankaj-srivastava")) return true;
  return false;
}
