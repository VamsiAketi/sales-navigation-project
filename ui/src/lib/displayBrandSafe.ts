const BRAND_PATTERNS: Array<[RegExp, string]> = [
  [/PAPERCLIPAI/g, "AI-HARNESS"],
  [/PaperclipAI/g, "AI-Harness"],
  [/paperclipai/g, "ai-harness"],
  [/PAPERCLIP/g, "AI-HARNESS"],
  [/Paperclip/g, "AI-Harness"],
  [/paper-clip/g, "ai-harness"],
  [/paperclip/g, "ai-harness"],
];

function replaceBrandTokens(value: string): string {
  return BRAND_PATTERNS.reduce((next, [pattern, replacement]) => next.replace(pattern, replacement), value);
}

export function displayBrandSafe<T>(value: T): T {
  if (typeof value === "string") {
    return replaceBrandTokens(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => displayBrandSafe(item)) as T;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
      key,
      displayBrandSafe(entryValue),
    ]);
    return Object.fromEntries(entries) as T;
  }

  return value;
}
