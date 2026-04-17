import { describe, expect, it } from "vitest";
import { parseCodexJsonl } from "@paperclipai/adapter-codex-local/server";

describe("parseCodexJsonl cost fields", () => {
  it("reads total_cost_usd when emitted as a string", () => {
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "t1", model: "gpt-5.3-codex" }),
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 10, output_tokens: 5, cached_input_tokens: 0 },
        total_cost_usd: "0.0042",
      }),
    ].join("\n");

    const parsed = parseCodexJsonl(stdout);
    expect(parsed.costUsd).toBeCloseTo(0.0042, 6);
    expect(parsed.model).toBe("gpt-5.3-codex");
  });

  it("sums numeric total_cost_usd across turns", () => {
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "t1" }),
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 0 },
        total_cost_usd: 0.01,
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 0 },
        total_cost_usd: 0.02,
      }),
    ].join("\n");

    const parsed = parseCodexJsonl(stdout);
    expect(parsed.costUsd).toBeCloseTo(0.03, 6);
  });
});
