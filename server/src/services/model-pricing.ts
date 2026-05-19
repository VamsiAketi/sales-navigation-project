/**
 * Server-side fallback pricing table.
 * Used when an adapter reports token usage but not a costUsd figure.
 * Prices are in USD per 1M tokens (input / cached_input / output).
 * Sources: OpenAI pricing page (as of 2026-Q1), Anthropic pricing page.
 *
 * Optional env `MARKUP_COST` (e.g. `1.1`, `1.5`): multiplier applied to the
 * computed model cost in cents before persistence. Unset or invalid → `1` (no markup).
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
  // ── OpenAI: current text/frontier models, Standard, short context ─────────
  // Source: OpenAI API pricing, prices per 1M tokens.
  "gpt-5.5":       { inputPer1M: 5.00,  cachedInputPer1M: 0.50,  outputPer1M: 30.00 },
  "gpt-5.5-pro":   { inputPer1M: 30.00, cachedInputPer1M: 30.00, outputPer1M: 180.00 }, // no cached price listed
  "gpt-5.4":       { inputPer1M: 2.50,  cachedInputPer1M: 0.25,  outputPer1M: 15.00 },
  "gpt-5.4-mini":  { inputPer1M: 0.75,  cachedInputPer1M: 0.075, outputPer1M: 4.50  },
  "gpt-5.4-nano":  { inputPer1M: 0.20,  cachedInputPer1M: 0.02,  outputPer1M: 1.25  },
  "gpt-5.4-pro":   { inputPer1M: 30.00, cachedInputPer1M: 30.00, outputPer1M: 180.00 }, // no cached price listed

  // ── OpenAI: long-context rates where listed ───────────────────────────────
  // Use these only if your request is in the long-context pricing band.
  "gpt-5.5:long":     { inputPer1M: 10.00, cachedInputPer1M: 1.00, outputPer1M: 45.00  },
  "gpt-5.5-pro:long": { inputPer1M: 60.00, cachedInputPer1M: 60.00, outputPer1M: 270.00 },
  "gpt-5.4:long":     { inputPer1M: 5.00,  cachedInputPer1M: 0.50, outputPer1M: 22.50  },
  "gpt-5.4-pro:long": { inputPer1M: 60.00, cachedInputPer1M: 60.00, outputPer1M: 270.00 },

  // ── OpenAI: Codex / specialized ───────────────────────────────────────────
  "gpt-5.3-codex": { inputPer1M: 1.75, cachedInputPer1M: 0.175, outputPer1M: 14.00 },
  // Cursor default model id — same rates as gpt-5.3-codex
  "auto": { inputPer1M: 1.75, cachedInputPer1M: 0.175, outputPer1M: 14.00 },

  // ── OpenAI: realtime text rates, if you meter text tokens there ───────────
  "gpt-realtime-2:text":    { inputPer1M: 4.00, cachedInputPer1M: 0.40, outputPer1M: 24.00 },
  "gpt-realtime-1.5:text":  { inputPer1M: 4.00, cachedInputPer1M: 0.40, outputPer1M: 16.00 },
  "gpt-realtime-mini:text": { inputPer1M: 0.60, cachedInputPer1M: 0.06, outputPer1M: 2.40 },

  // ── Anthropic: current Claude API base rates + cache hit/read rates ───────
  "claude-opus-4.7":     { inputPer1M: 5.00,  cachedInputPer1M: 0.50, outputPer1M: 25.00 },
  "claude-opus-4.6":     { inputPer1M: 5.00,  cachedInputPer1M: 0.50, outputPer1M: 25.00 },
  "claude-opus-4.5":     { inputPer1M: 5.00,  cachedInputPer1M: 0.50, outputPer1M: 25.00 },
  "claude-opus-4.1":     { inputPer1M: 15.00, cachedInputPer1M: 1.50, outputPer1M: 75.00 },
  "claude-opus-4":       { inputPer1M: 15.00, cachedInputPer1M: 1.50, outputPer1M: 75.00 },

  "claude-sonnet-4.6":   { inputPer1M: 3.00,  cachedInputPer1M: 0.30, outputPer1M: 15.00 },
  "claude-sonnet-4.5":   { inputPer1M: 3.00,  cachedInputPer1M: 0.30, outputPer1M: 15.00 },
  "claude-sonnet-4":     { inputPer1M: 3.00,  cachedInputPer1M: 0.30, outputPer1M: 15.00 },
  "claude-3-7-sonnet":   { inputPer1M: 3.00,  cachedInputPer1M: 0.30, outputPer1M: 15.00 }, // deprecated

  "claude-haiku-4.5":    { inputPer1M: 1.00,  cachedInputPer1M: 0.10, outputPer1M: 5.00  },
  "claude-3-5-haiku":    { inputPer1M: 0.80,  cachedInputPer1M: 0.08, outputPer1M: 4.00  },
  "claude-3-haiku":      { inputPer1M: 0.25,  cachedInputPer1M: 0.03, outputPer1M: 1.25  },
  "claude-3-opus":       { inputPer1M: 15.00, cachedInputPer1M: 1.50, outputPer1M: 75.00 }, // deprecated
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

function clampNonNegativeFinite(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/**
 * Multiplier from `MARKUP_COST` for stored `model_cost_cents`. Defaults to `1`.
 */
export function getModelCostMarkupMultiplier(): number {
  const raw = process.env.MARKUP_COST?.trim();
  if (raw === undefined || raw === "") return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return n;
}

/**
 * Calculate cost in cents from token counts using the built-in pricing table.
 * `inputTokens` is total prompt input (including cached); cached is billed at
 * `cachedInputPer1M` and only the remainder at `inputPer1M`.
 * Result is base cents × `MARKUP_COST` (rounded), then clamped to ≥ 0.
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

  let input = clampNonNegativeFinite(inputTokens);
  let cached = clampNonNegativeFinite(cachedInputTokens);
  const output = clampNonNegativeFinite(outputTokens);
  if (cached > input) cached = input;

  const uncachedInput = input - cached;
  const costUsd =
    (uncachedInput * price.inputPer1M +
      cached * price.cachedInputPer1M +
      output * price.outputPer1M) /
    1_000_000;
  const baseCents = Math.max(0, Math.round(costUsd * 100));
  const markedUp = Math.round(baseCents * getModelCostMarkupMultiplier());
  return Math.max(0, markedUp);
}
