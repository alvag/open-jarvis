import { readFileSync } from "node:fs";

let cachedSoul: string | null = null;

export function loadSoul(soulPath: string): string {
  if (cachedSoul) return cachedSoul;

  try {
    cachedSoul = readFileSync(soulPath, "utf-8");
    return cachedSoul;
  } catch {
    console.error(`Could not read soul file at: ${soulPath}`);
    process.exit(1);
  }
}
