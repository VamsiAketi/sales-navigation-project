import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root (works from both `server/src` and `server/dist`). */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function readConnectorActionsGuideMarkdown(connectorTypeKey: string): string | null {
  const filePath = path.join(repoRoot, "doc/connectors", `${connectorTypeKey}.md`);
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
