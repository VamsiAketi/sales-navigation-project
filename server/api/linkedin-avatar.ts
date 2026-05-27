/** Extract public profile slug from a linkedin.com/in/… URL. */
function parseLinkedInProfileSlug(linkedinUrl: string): string | null {
  try {
    const parsed = new URL(linkedinUrl.trim());
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (host !== "linkedin.com") return null;
    const match = parsed.pathname.match(/\/in\/([^/]+)/i);
    const slug = match?.[1]?.replace(/\/$/, "").trim();
    return slug || null;
  } catch {
    return null;
  }
}

function unavatarUrls(slug: string, profileUrl: string): string[] {
  return [
    `https://unavatar.io/linkedin/${encodeURIComponent(slug)}?fallback=false`,
    `https://unavatar.io/${encodeURIComponent(profileUrl.trim())}?fallback=false`,
  ];
}

async function fetchAvatarFromProvider(
  url: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Paperclip-SalesNavigation/1.0",
        Accept: "image/*",
      },
      redirect: "follow",
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) return null;
    const arrayBuffer = await response.arrayBuffer();
    const body = Buffer.from(arrayBuffer);
    if (body.length < 128) return null;
    return { body, contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveLinkedInAvatar(profileUrl: string): Promise<{ body: Buffer; contentType: string } | null> {
  const slug = parseLinkedInProfileSlug(profileUrl);
  if (!slug) return null;

  for (const providerUrl of unavatarUrls(slug, profileUrl)) {
    const result = await fetchAvatarFromProvider(providerUrl);
    if (result) return result;
  }
  return null;
}

export default async function handler(req: { query?: { url?: string } }, res: any) {
  try {
    const profileUrl = typeof req.query?.url === "string" ? req.query.url.trim() : "";
    if (!profileUrl || !parseLinkedInProfileSlug(profileUrl)) {
      res.status(400).json({ error: "A valid linkedin.com/in/… profile URL is required." });
      return;
    }

    const avatar = await resolveLinkedInAvatar(profileUrl);
    if (!avatar) {
      res.status(404).end();
      return;
    }

    const maxAge = 60 * 60 * 24;
    res.setHeader("Content-Type", avatar.contentType);
    res.setHeader("Cache-Control", `public, max-age=${maxAge}, s-maxage=${maxAge}`);
    res.status(200).send(avatar.body);
  } catch {
    res.status(500).json({ error: "Failed to resolve LinkedIn avatar." });
  }
}
