import { asString, asNumber, parseObject, parseJson } from "@paperclipai/adapter-utils/server-utils";

/** Coerce JSON numeric fields that may arrive as strings (e.g. total_cost_usd). */
function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function readUsdFromTurnEvent(event: Record<string, unknown>): number {
  const direct =
    readFiniteNumber(event.total_cost_usd) ??
    readFiniteNumber(event.cost_usd) ??
    readFiniteNumber(event.cost);
  return direct ?? 0;
}

export function parseCodexJsonl(stdout: string) {
  let sessionId: string | null = null;
  let model = "";
  let totalCostUsd = 0;
  const messages: string[] = [];
  let errorMessage: string | null = null;
  const usage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  };

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const event = parseJson(line);
    if (!event) continue;

    const type = asString(event.type, "");
    if (type === "thread.started") {
      sessionId = asString(event.thread_id, sessionId ?? "") || sessionId;
      model = asString(event.model, model);
      continue;
    }

    if (type === "error") {
      const msg = asString(event.message, "").trim();
      if (msg) errorMessage = msg;
      continue;
    }

    if (type === "item.completed") {
      const item = parseObject(event.item);
      if (asString(item.type, "") === "agent_message") {
        const text = asString(item.text, "");
        if (text) messages.push(text);
      }
      continue;
    }

    if (type === "turn.completed") {
      const usageObj = parseObject(event.usage);
      usage.inputTokens = asNumber(usageObj.input_tokens, usage.inputTokens);
      usage.cachedInputTokens = asNumber(
        usageObj.cached_input_tokens,
        asNumber(usageObj.cache_read_input_tokens, usage.cachedInputTokens),
      );
      usage.outputTokens = asNumber(usageObj.output_tokens, usage.outputTokens);
      totalCostUsd += readUsdFromTurnEvent(event);
      continue;
    }

    if (type === "turn.failed") {
      const err = parseObject(event.error);
      const msg = asString(err.message, "").trim();
      if (msg) errorMessage = msg;
    }
  }

  return {
    sessionId,
    model,
    summary: messages.join("\n\n").trim(),
    usage,
    costUsd: totalCostUsd > 0 ? totalCostUsd : null,
    errorMessage,
  };
}

export function isCodexUnknownSessionError(stdout: string, stderr: string): boolean {
  const haystack = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return /unknown (session|thread)|session .* not found|thread .* not found|conversation .* not found|missing rollout path for thread|state db missing rollout path/i.test(
    haystack,
  );
}
