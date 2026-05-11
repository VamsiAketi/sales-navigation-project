const APP_HOST_SUFFIX = ".app.ai-harness.com";

/**
 * When the UI is served on `{slug}.app.ai-harness.com`, returns `slug` (e.g. `dev-test`).
 * Returns null for localhost, bare `app.ai-harness.com`, `www`, or other hosts.
 */
export function getInstanceSlugFromAppHostname(hostname: string): string | null {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized || normalized === "localhost") return null;
  if (!normalized.endsWith(APP_HOST_SUFFIX)) return null;

  const slug = normalized.slice(0, -APP_HOST_SUFFIX.length);
  if (!slug || slug === "www") return null;

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug)) return null;

  return slug;
}
