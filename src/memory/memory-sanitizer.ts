import { createEngine } from "@secretlint/node";

// Lazy-initialized singleton engine (avoids repeated setup cost)
let _engine: Awaited<ReturnType<typeof createEngine>> | null = null;

async function getEngine() {
  if (!_engine) {
    _engine = await createEngine({
      configFileJSON: {
        rules: [{ id: "@secretlint/secretlint-rule-preset-recommend" }],
      },
      formatter: "json",
      color: false,
    });
  }
  return _engine;
}

export class SensitiveDataError extends Error {
  constructor(message = "sensitive data detected") {
    super(message);
    this.name = "SensitiveDataError";
  }
}

export async function containsSensitiveData(text: string): Promise<boolean> {
  if (!text || !text.trim()) return false;
  const engine = await getEngine();
  const result = await engine.executeOnContent({
    content: text,
    filePath: "memory-content.txt",
  });
  return !result.ok;
}

export async function detectSensitiveData(
  text: string,
): Promise<{ found: boolean; types: string[] }> {
  if (!text || !text.trim()) return { found: false, types: [] };
  const engine = await getEngine();
  const result = await engine.executeOnContent({
    content: text,
    filePath: "memory-content.txt",
  });
  const types = !result.ok ? parseRuleIds(result.output) : [];
  return { found: !result.ok, types };
}

function parseRuleIds(output: string): string[] {
  try {
    const parsed = JSON.parse(output) as Array<{ messages: Array<{ ruleId: string }> }>;
    const ids = parsed.flatMap((f) => f.messages.map((m) => m.ruleId)).filter(Boolean);
    return [...new Set(ids)];
  } catch {
    // Fallback: extract ruleId patterns from raw string
    const matches = output.match(/@secretlint\/secretlint-rule-[\w-]+/g) ?? [];
    return [...new Set(matches)];
  }
}
