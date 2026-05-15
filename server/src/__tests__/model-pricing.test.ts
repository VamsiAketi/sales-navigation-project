import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  calculateModelCostCents,
  getModelCostMarkupMultiplier,
} from "../services/model-pricing.js";

describe("calculateModelCostCents", () => {
  beforeEach(() => {
    delete process.env.MARKUP_COST;
  });

  it("resolves default Codex / GPT-5 style model ids used by codex_local", () => {
    const cents = calculateModelCostCents("gpt-5.3-codex", 1_000_000, 0, 1_000_000);
    expect(cents).toBeGreaterThan(0);
  });

  it("matches longer gpt-5.3-codex prefixes before generic gpt-5", () => {
    const codex = calculateModelCostCents("gpt-5.3-codex-high", 1_000_000, 0, 0);
    const generic = calculateModelCostCents("gpt-5.4-unknown", 1_000_000, 0, 0);
    expect(codex).toBeGreaterThan(0);
    expect(generic).toBeGreaterThan(0);
  });

  it("does not double-charge cached tokens when they are included in input total", () => {
    // gpt-5.3-codex: inputPer1M 1.75, cachedInputPer1M 0.175 — 1M total in, 400k cached
    // => 600k @ input + 400k @ cached; not 1M @ input + 400k @ cached
    const withCache = calculateModelCostCents("gpt-5.3-codex", 1_000_000, 400_000, 0);
    expect(withCache).toBe(112);
    const doubleCountedBug = Math.round(
      ((1_000_000 * 1.75 + 400_000 * 0.175) / 1_000_000) * 100,
    );
    expect(withCache).toBeLessThan(doubleCountedBug);
  });

  it("clamps cached input to input and ignores invalid token counts", () => {
    expect(calculateModelCostCents("gpt-5.3-codex", 100, 500, 0)).toBe(
      calculateModelCostCents("gpt-5.3-codex", 100, 100, 0),
    );
    expect(calculateModelCostCents("gpt-5.3-codex", -10, 100, 0)).toBe(0);
    expect(calculateModelCostCents("gpt-5.3-codex", 100, NaN, 0)).toBe(
      calculateModelCostCents("gpt-5.3-codex", 100, 0, 0),
    );
  });
});

describe("MARKUP_COST", () => {
  const markupCostAtLoad = process.env.MARKUP_COST;

  afterEach(() => {
    if (markupCostAtLoad === undefined) delete process.env.MARKUP_COST;
    else process.env.MARKUP_COST = markupCostAtLoad;
  });

  it("getModelCostMarkupMultiplier defaults to 1 when unset", () => {
    delete process.env.MARKUP_COST;
    expect(getModelCostMarkupMultiplier()).toBe(1);
  });

  it("getModelCostMarkupMultiplier reads MARKUP_COST and rejects invalid values", () => {
    process.env.MARKUP_COST = "1.25";
    expect(getModelCostMarkupMultiplier()).toBe(1.25);
    process.env.MARKUP_COST = "0";
    expect(getModelCostMarkupMultiplier()).toBe(1);
    process.env.MARKUP_COST = "-2";
    expect(getModelCostMarkupMultiplier()).toBe(1);
    process.env.MARKUP_COST = "nope";
    expect(getModelCostMarkupMultiplier()).toBe(1);
  });

  it("calculateModelCostCents multiplies base cents by MARKUP_COST", () => {
    delete process.env.MARKUP_COST;
    const base = calculateModelCostCents("gpt-5.3-codex", 1_000_000, 0, 1_000_000);
    process.env.MARKUP_COST = "1.5";
    const markedUp = calculateModelCostCents("gpt-5.3-codex", 1_000_000, 0, 1_000_000);
    expect(markedUp).toBe(Math.round(base * 1.5));
  });
});
