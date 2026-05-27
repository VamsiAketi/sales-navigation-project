import { parseLinkedInProfileSlug } from "../lib/linkedin-profile.js";

type CachedAvatar = {
  body: Buffer;
  contentType: string;
  expiresAt: number;
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, CachedAvatar>();

function avatarCacheKey(slug: string): string {
  return slug.toLowerCase();
}

function unavatarUrls(slug: string, profileUrl: string): string[] {
  return [
    `https://unavatar.io/linkedin/${encodeURIComponent(slug)}?fallback=false`,
    `https://unavatar.io/${encodeURIComponent(profileUrl)}?fallback=false`,
  ];
}

async function fetchAvatarFromProvider(url: string): Promise<CachedAvatar | null> {
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
    return {
      body,
      contentType,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveLinkedInAvatar(profileUrl: string): Promise<CachedAvatar | null> {
  const slug = parseLinkedInProfileSlug(profileUrl);
  if (!slug) return null;

  const key = avatarCacheKey(slug);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  for (const providerUrl of unavatarUrls(slug, profileUrl)) {
    const result = await fetchAvatarFromProvider(providerUrl);
    if (result) {
      cache.set(key, result);
      return result;
    }
  }

  return null;
}
