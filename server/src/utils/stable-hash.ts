import { createHash } from "node:crypto";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    const result: Record<string, unknown> = {};
    for (const [key, nested] of entries) {
      result[key] = canonicalize(nested);
    }
    return result;
  }
  return value;
}

export function stableHash(value: unknown): string {
  const canonical = canonicalize(value);
  const payload = JSON.stringify(canonical);
  return createHash("sha256").update(payload).digest("hex");
}
