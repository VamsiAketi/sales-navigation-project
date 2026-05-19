import type { LucideIcon } from "lucide-react";
import { Cable, Cloud, Inbox, Mail } from "lucide-react";

export function iconForConnectorCatalogKey(key: string): LucideIcon {
  if (key === "gmail") return Mail;
  if (key === "outlook") return Cloud;
  if (key === "email") return Inbox;
  return Cable;
}
