/**
 * Server-side fallback pricing table.
 * Used when an adapter reports token usage but not a costUsd figure.
 * Prices are in USD per 1M tokens (input / cached_input / output).
 * Sources: OpenAI pricing page (as of 2026-Q1), Anthropic pricing page.
 */

interface ModelPrice {
  /** USD per 1M input tokens */
  inputPer1M: number;
  /** USD per 1M cached input tokens (usually cheaper than uncached) */
  cachedInputPer1M: number;
  /** USD per 1M output tokens */
  outputPer1M: number;
}

// Keyed by lowercase model prefix — longest match wins.
const PRICING: Record<string, ModelPrice> = {
  // ── OpenAI ───────────────────────────────────────────────────────────────
  "o3-mini":       { inputPer1M: 1.10,  cachedInputPer1M: 0.55,  outputPer1M: 4.40  },
  "o3":            { inputPer1M: 10.00, cachedInputPer1M: 2.50,  outputPer1M: 40.00 },
  "o4-mini":       { inputPer1M: 1.10,  cachedInputPer1M: 0.275, outputPer1M: 4.40  },
  "o1-mini":       { inputPer1M: 1.10,  cachedInputPer1M: 0.55,  outputPer1M: 4.40  },
  "o1-preview":    { inputPer1M: 15.00, cachedInputPer1M: 7.50,  outputPer1M: 60.00 },
  "o1":            { inputPer1M: 15.00, cachedInputPer1M: 7.50,  outputPer1M: 60.00 },
  "gpt-4o-mini":   { inputPer1M: 0.15,  cachedInputPer1M: 0.075, outputPer1M: 0.60  },
  "gpt-4o":        { inputPer1M: 2.50,  cachedInputPer1M: 1.25,  outputPer1M: 10.00 },
  "gpt-4-turbo":   { inputPer1M: 10.00, cachedInputPer1M: 10.00, outputPer1M: 30.00 },
  "gpt-4":         { inputPer1M: 30.00, cachedInputPer1M: 30.00, outputPer1M: 60.00 },
  "gpt-3.5-turbo": { inputPer1M: 0.50,  cachedInputPer1M: 0.50,  outputPer1M: 1.50  },
  "codex-mini":    { inputPer1M: 1.50,  cachedInputPer1M: 0.375, outputPer1M: 6.00  },

  // ── Anthropic ────────────────────────────────────────────────────────────
  "claude-opus-4":       { inputPer1M: 15.00, cachedInputPer1M: 1.50,  outputPer1M: 75.00 },
  "claude-sonnet-4":     { inputPer1M: 3.00,  cachedInputPer1M: 0.30,  outputPer1M: 15.00 },
  "claude-3-7-sonnet":   { inputPer1M: 3.00,  cachedInputPer1M: 0.30,  outputPer1M: 15.00 },
  "claude-3-5-sonnet":   { inputPer1M: 3.00,  cachedInputPer1M: 0.30,  outputPer1M: 15.00 },
  "claude-3-5-haiku":    { inputPer1M: 0.80,  cachedInputPer1M: 0.08,  outputPer1M: 4.00  },
  "claude-haiku-4":      { inputPer1M: 0.80,  cachedInputPer1M: 0.08,  outputPer1M: 4.00  },
  "claude-3-opus":       { inputPer1M: 15.00, cachedInputPer1M: 1.50,  outputPer1M: 75.00 },
  "claude-3-sonnet":     { inputPer1M: 3.00,  cachedInputPer1M: 0.30,  outputPer1M: 15.00 },
  "claude-3-haiku":      { inputPer1M: 0.25,  cachedInputPer1M: 0.03,  outputPer1M: 1.25  },
};

function lookupPricing(model: string): ModelPrice | null {
  const lower = model.toLowerCase();
  // Longest matching prefix wins
  let best: ModelPrice | null = null;
  let bestLen = 0;
  for (const [prefix, price] of Object.entries(PRICING)) {
    if (lower.startsWith(prefix) && prefix.length > bestLen) {
      best = price;
      bestLen = prefix.length;
    }
  }
  return best;
}

/**
 * Calculate cost in cents from token counts using the built-in pricing table.
 * Returns 0 if the model is not recognised.
 */
export function calculateModelCostCents(
  model: string,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
): number {
  const price = lookupPricing(model);
  if (!price) return 0;
  const costUsd =
    (inputTokens * price.inputPer1M +
      cachedInputTokens * price.cachedInputPer1M +
      outputTokens * price.outputPer1M) /
    1_000_000;
  return Math.max(0, Math.round(costUsd * 100));
}
