/** Captures the tenant slug from `{slug}.app.ai-harness.com` in PAPERCLIP_PUBLIC_URL. */
const PUBLIC_URL_INSTANCE_ID_RE =
  /^https?:\/\/([a-z0-9]+(?:-[a-z0-9]+)*)\.app\.ai-harness\.com(?:[/:?#]|$)/i;

function instanceIdFromPublicUrl(publicUrl: string): string | null {
  const match = PUBLIC_URL_INSTANCE_ID_RE.exec(publicUrl.trim());
  const slug = match?.[1]?.trim().toLowerCase();
  if (!slug || slug === "www") return null;
  return slug;
}

/** Primary: PAPERCLIP_INSTANCE_ID. Fallback: instance id parsed from PAPERCLIP_PUBLIC_URL. */
export function resolveControlPlaneTenantName(): string {
  const instanceId = process.env.PAPERCLIP_INSTANCE_ID?.trim();
  if (instanceId) return instanceId;

  const publicUrl = process.env.PAPERCLIP_PUBLIC_URL?.trim();
  if (publicUrl) {
    const slug = instanceIdFromPublicUrl(publicUrl);
    if (slug) return slug;
  }

  return "default";
}
