export function normalizeCursorStreamLine(rawLine: string): {
  stream: "stdout" | "stderr" | null;
  line: string;
} {
  const trimmed = rawLine.trim();
  if (!trimmed) return { stream: null, line: "" };

  const prefixed = trimmed.match(/^(stdout|stderr)\s*[:=]?\s*([\[{].*)$/i);
  if (!prefixed) {
    return { stream: null, line: trimmed };
  }

  const stream = prefixed[1]?.toLowerCase() === "stderr" ? "stderr" : "stdout";
  const line = (prefixed[2] ?? "").trim();
  return { stream, line };
}

export type CursorStreamLogBatch = {
  stream: "stdout" | "stderr";
  text: string;
};

function collectNormalizedCursorStreamLine(
  rawLine: string,
  stdoutLines: string[],
  stderrLines: string[],
) {
  const normalized = normalizeCursorStreamLine(rawLine);
  if (!normalized.line) return;
  if (normalized.stream === "stderr") {
    stderrLines.push(normalized.line);
  } else {
    stdoutLines.push(normalized.line);
  }
}

/** Normalize stream-json stdout incrementally and batch complete lines for logging. */
export function appendCursorStreamChunk(
  lineBuffer: string,
  chunk: string,
  finalize = false,
): { lineBuffer: string; batches: CursorStreamLogBatch[] } {
  const combined = `${lineBuffer}${chunk}`;
  const lines = combined.split(/\r?\n/);
  let nextBuffer = lines.pop() ?? "";

  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  for (const line of lines) {
    collectNormalizedCursorStreamLine(line, stdoutLines, stderrLines);
  }

  if (finalize) {
    const trailing = nextBuffer.trim();
    nextBuffer = "";
    if (trailing) {
      collectNormalizedCursorStreamLine(trailing, stdoutLines, stderrLines);
    }
  }

  const batches: CursorStreamLogBatch[] = [];
  if (stdoutLines.length > 0) {
    batches.push({ stream: "stdout", text: `${stdoutLines.join("\n")}\n` });
  }
  if (stderrLines.length > 0) {
    batches.push({ stream: "stderr", text: `${stderrLines.join("\n")}\n` });
  }

  return { lineBuffer: nextBuffer, batches };
}
