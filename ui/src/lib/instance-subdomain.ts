/** True for hosts used for local dev (no tenant subdomain). */
export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}

/**
 * First DNS label when the host looks like a tenant subdomain (e.g. acme.app.example.com → acme).
 * Returns null for apex hosts, loopback, and raw IPs.
 */
export function instanceSubdomainFromBrowserHost(host: string): string | null {
  const hostname = host.split(":")[0]?.trim().toLowerCase() ?? "";
  if (!hostname) return null;
  if (isLoopbackHostname(hostname)) {
    return null;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return null;
  }
  const parts = hostname.split(".").filter((p) => p.length > 0);
  if (parts.length >= 3) {
    return parts[0] ?? null;
  }
  if (parts.length === 2 && parts[1] === "localhost") {
    return parts[0] ?? null;
  }
  return null;
}
