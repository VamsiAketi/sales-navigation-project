import { describe, expect, it } from "vitest";
import { calculateModelCostCents } from "../services/model-pricing.js";

describe("calculateModelCostCents", () => {
  it("resolves default Codex / GPT-5 style model ids used by codex_local", () => {
    const cents = calculateModelCostCents("gpt-5.3-codex", 1_000_000, 0, 1_000_000);
    expect(cents).toBeGreaterThan(0);
  });

  it("matches longer gpt-5.3-codex prefixes before generic gpt-5", () => {
    const codex = calculateModelCostCents("gpt-5.3-codex-high", 1_000_000, 0, 0);
    const generic = calculateModelCostCents("gpt-5-other", 1_000_000, 0, 0);
    expect(codex).toBeGreaterThan(0);
    expect(generic).toBeGreaterThan(0);
  });
});
