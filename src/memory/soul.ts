import { readFileSync } from "node:fs";

export interface SoulContent {
  soul: string;
  agentRules?: string;
}

let cachedSoul: SoulContent | null = null;

export function loadSoul(soulPath: string): SoulContent {
  if (cachedSoul) return cachedSoul;

  let soul: string;
  try {
    soul = readFileSync(soulPath, "utf-8");
  } catch {
    console.error(`Could not read soul file at: ${soulPath}`);
    process.exit(1);
  }

  let agentRules: string | undefined;
  try {
    agentRules = readFileSync("./AGENTS.md", "utf-8");
  } catch {
    // AGENTS.md es opcional
  }

  cachedSoul = { soul, agentRules };
  return cachedSoul;
}
