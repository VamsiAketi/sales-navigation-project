const LINKEDIN_PROFILE_RE = /^https?:\/\/(?:[a-z]+\.)?linkedin\.com\/in\/[^/?#]+\/?$/i;

function parseMetaImage(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    const value = match?.[1]?.trim();
    if (!value) continue;
    const decoded = value.replace(/&amp;/g, "&");
    if (/^https?:\/\//i.test(decoded)) return decoded;
  }
  return null;
}

function isValidLinkedInProfile(url: string): boolean {
  return LINKEDIN_PROFILE_RE.test(url.trim());
}

export default async function handler(req: any, res: any) {
  try {
    const raw = typeof req.query?.url === "string" ? req.query.url.trim() : "";
    if (!raw || !isValidLinkedInProfile(raw)) {
      res.status(400).json({ error: "A valid linkedin.com/in profile URL is required." });
      return;
    }

    const profileResp = await fetch(raw, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    if (!profileResp.ok) {
      res.status(404).json({ error: "LinkedIn profile not reachable." });
      return;
    }

    const html = await profileResp.text();
    const imageUrl = parseMetaImage(html);
    if (!imageUrl) {
      res.status(404).json({ error: "No avatar image found." });
      return;
    }

    const imageResp = await fetch(imageUrl, {
      headers: {
        referer: "https://www.linkedin.com/",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    });
    if (!imageResp.ok) {
      res.status(404).json({ error: "Avatar image could not be fetched." });
      return;
    }

    const contentType = imageResp.headers.get("content-type") || "image/jpeg";
    const maxAge = 60 * 60 * 24;
    const bytes = Buffer.from(await imageResp.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", `public, max-age=${maxAge}, s-maxage=${maxAge}`);
    res.status(200).send(bytes);
  } catch (_err) {
    res.status(500).json({ error: "Failed to resolve LinkedIn avatar." });
  }
}
